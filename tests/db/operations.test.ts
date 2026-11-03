import { describe, it, expect } from 'vitest';
import { freshDb, asUser, q, expectError, acct, ACCOUNTANT } from './harness';
const num = async (db: Awaited<ReturnType<typeof freshDb>>, sql: string, p: unknown[] = []) => Number((await q<{ v: string }>(db, sql, p))[0].v);

describe('Resilience Estate operations', () => {
  it('books a property sale with revenue, cost of sale, project profitability, and rent invoices', async () => {
    const db = await freshDb('resilience'); await asUser(db, ACCOUNTANT);
    const prj = (await q<{ id: string }>(db, `select public.create_project('PCR','Parkchester Residence', 1000000, '2026-01-01') id`))[0].id;
    const prop = (await q<{ id: string }>(db, `insert into public.properties(code, name, project_id, list_price, cost_basis) values ('PR-01','Unit 1', $1, 500000, 300000) returning id`, [prj]))[0].id;
    const cust = (await q<{ id: string }>(db, `insert into public.customers(name) values ('Buyer') returning id`))[0].id;
    await db.query(`select public.book_property_sale($1,$2,'2026-02-01',500000,'2026-03-01')`, [prop, cust]);
    await expectError(db.query(`select public.book_property_sale($1,$2,'2026-02-01',500000,'2026-03-01')`, [prop, cust]), /already sold/);
    const p = (await q<{ revenue: string; costs: string; profit: string }>(db, `select * from public.rpt_project_profitability('2026-01-01','2026-12-31')`))[0];
    expect(Number(p.revenue)).toBe(500000); expect(Number(p.costs)).toBe(300000); expect(Number(p.profit)).toBe(200000);
    // contractor bill coded to the project cost centre shows up as a project cost
    const sup = (await q<{ id: string }>(db, `insert into public.suppliers(name) values ('Contractor') returning id`))[0].id;
    const b = (await q<{ id: string }>(db, `insert into public.bills(supplier_id, issue_date, due_date) values ($1,'2026-02-10','2026-03-10') returning id`, [sup]))[0].id;
    await db.query(`insert into public.bill_lines(bill_id, description, quantity, unit_price, expense_account_id, cost_centre_id) values ($1,'Roofing',1,40000,(select id from public.accounts where code='5200'),(select cost_centre_id from public.projects where id=$2))`, [b, prj]);
    await db.query('select public.approve_bill($1)', [b]);
    expect(Number((await q<{ budget_used_pct: string }>(db, `select * from public.rpt_project_profitability('2026-01-01','2026-12-31')`))[0].budget_used_pct)).toBe(34);
    const tenant = (await q<{ id: string }>(db, `insert into public.customers(name) values ('Tenant') returning id`))[0].id;
    const prop2 = (await q<{ id: string }>(db, `insert into public.properties(code, name, project_id) values ('PR-02','Unit 2',$1) returning id`, [prj]))[0].id;
    const ag = (await q<{ id: string }>(db, `insert into public.rental_agreements(property_id, customer_id, rent_amount, start_date) values ($1,$2,2500,'2026-01-01') returning id`, [prop2, tenant]))[0].id;
    await db.query(`select public.generate_rent_invoice($1,'2026-03-15')`, [ag]);
    await expectError(db.query(`select public.generate_rent_invoice($1,'2026-03-20')`, [ag]), /duplicate key/);
    expect(Number((await q<{ outstanding: string }>(db, `select * from public.rpt_rental_roll('2026-12-31')`))[0].outstanding)).toBe(2500);
    expect((await q(db, `select * from public.rpt_property_sales('2026-01-01','2026-12-31')`)).length).toBe(1);
  }, 60000);
  it('does not contain factory tables', async () => {
    const db = await freshDb('resilience');
    expect(await q(db, `select 1 from information_schema.tables where table_name in ('materials','production_batches')`)).toHaveLength(0);
  }, 60000);
});

describe('Ash Elite factory operations', () => {
  it('costs a batch (weighted-average materials + labour + overhead), tracks stock, posts COGS, blocks overdrawing', async () => {
    const db = await freshDb('ashelite'); await asUser(db, ACCOUNTANT);
    const cement = (await q<{ id: string }>(db, `insert into public.materials(sku, name, unit) values ('CEM','Cement','bag') returning id`))[0].id;
    const sand = (await q<{ id: string }>(db, `insert into public.materials(sku, name, unit) values ('SND','Sand','tonne') returning id`))[0].id;
    // purchase through a supplier bill coded to raw-materials inventory, then receive stock
    const sup = (await q<{ id: string }>(db, `insert into public.suppliers(name) values ('Cement Co') returning id`))[0].id;
    const bill = (await q<{ id: string }>(db, `insert into public.bills(supplier_id, issue_date, due_date) values ($1,'2026-01-05','2026-02-05') returning id`, [sup]))[0].id;
    await db.query(`insert into public.bill_lines(bill_id, description, quantity, unit_price, expense_account_id) values ($1,'Cement',100,80,(select id from public.accounts where code='1210')), ($1,'Cement',100,100,(select id from public.accounts where code='1210')), ($1,'Sand',50,40,(select id from public.accounts where code='1210'))`, [bill]);
    await db.query('select public.approve_bill($1)', [bill]);
    await db.query(`select public.receive_material($1,100,80,'2026-01-05',$2)`, [cement, bill]);
    await db.query(`select public.receive_material($1,100,100,'2026-01-20',$2)`, [cement, bill]);   // avg = 90
    await db.query(`select public.receive_material($1,50,40,'2026-01-05',$2)`, [sand, bill]);
    expect(await num(db, 'select avg_cost v from public.materials where id = $1', [cement])).toBe(90);
    const prod = (await q<{ id: string }>(db, `insert into public.products(sku, name, unit_price) values ('BLK6','6-inch block', 12) returning id`))[0].id;
    const batch = (await q<{ id: string }>(db, `insert into public.production_batches(product_id, batch_date, qty_produced, qty_good, qty_damaged, labour_cost, overhead_cost) values ($1,'2026-02-02',1000,950,50,300,200) returning id`, [prod]))[0].id;
    await db.query(`insert into public.batch_materials(batch_id, material_id, qty) values ($1,$2,50), ($1,$3,20)`, [batch, cement, sand]);
    await db.query('select public.complete_batch($1)', [batch]);
    // materials 50*90 + 20*40 = 5300; total = 5800; per good = 6.1053
    const b = (await q<{ material_cost: string; cost_per_good: string; status: string }>(db, 'select * from public.production_batches where id = $1', [batch]))[0];
    expect(Number(b.material_cost)).toBe(5300); expect(Number(b.cost_per_good)).toBeCloseTo(6.1053, 4);
    expect(await num(db, 'select stock_qty v from public.materials where id = $1', [cement])).toBe(150);
    expect(await num(db, 'select stock_qty v from public.products where id = $1', [prod])).toBe(950);
    expect(await num(db, 'select damaged_qty v from public.products where id = $1', [prod])).toBe(50);
    await expectError(db.query(`update public.production_batches set labour_cost = 1 where id = $1`, [batch]), /immutable/);
    await expectError(db.query('select public.complete_batch($1)', [batch]), /already completed/);
    expect(await num(db, `select sum(base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code='1220')`)).toBe(5800);
    // sale of blocks, then COGS
    const cust = (await q<{ id: string }>(db, `insert into public.customers(name) values ('BuildPro') returning id`))[0].id;
    const inv = (await q<{ id: string }>(db, `insert into public.invoices(customer_id, issue_date, due_date) values ($1,'2026-02-10','2026-03-10') returning id`, [cust]))[0].id;
    await db.query(`insert into public.invoice_lines(invoice_id, description, quantity, unit_price, revenue_account_id, product_id) values ($1,'6-inch block',400,12,(select id from public.accounts where code='4100'),$2)`, [inv, prod]);
    await db.query('select public.issue_invoice($1)', [inv]);
    await db.query('select public.post_invoice_cogs($1)', [inv]);
    await expectError(db.query('select public.post_invoice_cogs($1)', [inv]), /already posted/);
    expect(await num(db, 'select stock_qty v from public.products where id = $1', [prod])).toBe(550);
    const cogs = await num(db, `select sum(base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code='5000')`);
    expect(cogs).toBeCloseTo(400 * 6.1053, 1);
    const inv2 = (await q<{ id: string }>(db, `insert into public.invoices(customer_id, issue_date, due_date) values ($1,'2026-02-11','2026-03-10') returning id`, [cust]))[0].id;
    await db.query(`insert into public.invoice_lines(invoice_id, description, quantity, unit_price, revenue_account_id, product_id) values ($1,'6-inch block',9999,12,(select id from public.accounts where code='4100'),$2)`, [inv2, prod]);
    await db.query('select public.issue_invoice($1)', [inv2]);
    await expectError(db.query('select public.post_invoice_cogs($1)', [inv2]), /Insufficient finished stock/);
    // overdrawing materials is blocked
    const b2 = (await q<{ id: string }>(db, `insert into public.production_batches(product_id, batch_date, qty_produced, qty_good) values ($1,'2026-02-12',10,10) returning id`, [prod]))[0].id;
    await db.query(`insert into public.batch_materials(batch_id, material_id, qty) values ($1,$2,9999)`, [b2, cement]);
    await expectError(db.query('select public.complete_batch($1)', [b2]), /Insufficient stock/);
    await db.query(`select public.write_off_material($1, 10, '2026-02-15', 'Wet bags')`, [cement]);
    expect(await num(db, `select sum(base_debit) v from public.journal_lines where account_id = (select id from public.accounts where code='5150')`)).toBe(900);
    expect((await q(db, `select * from public.rpt_cost_per_block('2026-01-01','2026-12-31')`)).length).toBe(1);
    expect((await q(db, `select * from public.rpt_inventory_valuation()`)).length).toBeGreaterThan(3);
    expect((await q(db, `select * from public.rpt_material_usage('2026-01-01','2026-12-31')`)).length).toBe(2);
    const ledgerRM = await num(db, `select sum(base_debit - base_credit) v from public.journal_lines where account_id = (select id from public.accounts where code='1210')`);
    const stockRM = await num(db, `select sum(stock_qty * avg_cost) v from public.materials`);
    expect(stockRM).toBeCloseTo(ledgerRM, 1);     // perpetual inventory sub-ledger agrees with GL
  }, 60000);
});

describe('company extras', () => {
  it('Resilience: instalment plan FIFO schedule, customer deposit application, commission bill, cost allocation', async () => {
    const db = await freshDb('resilience'); await asUser(db, ACCOUNTANT);
    const prj = (await q<{ id: string }>(db, `select public.create_project('PCR','Parkchester',1000000,'2026-01-01') id`))[0].id;
    const cust = (await q<{ id: string }>(db, `insert into public.customers(name) values ('Buyer') returning id`))[0].id;
    const p1 = (await q<{ id: string }>(db, `insert into public.properties(code,name,project_id,list_price) values ('U1','Unit 1',$1,600000) returning id`, [prj]))[0].id;
    await q(db, `insert into public.properties(code,name,project_id,list_price) values ('U2','Unit 2',$1,400000)`, [prj]);
    // capitalised development cost 500,000 held in property inventory against the project
    const cc = (await q<{ cost_centre_id: string }>(db, `select cost_centre_id from public.projects where id = $1`, [prj]))[0].cost_centre_id;
    await db.query(`select public.create_journal('2026-02-01','Dev cost',$1::jsonb)`, [JSON.stringify([{ account_id: await acct(db, '1200'), debit: 500000, cost_centre_id: cc }, { account_id: await acct(db, '1010'), credit: 500000 }])]);
    expect(await num(db, `select public.allocate_project_costs($1,'list_price') v`, [prj])).toBe(500000);
    expect(await num(db, `select cost_basis v from public.properties where id = $1`, [p1])).toBe(300000);
    const sale = (await q<{ id: string }>(db, `select public.book_property_sale($1,$2,'2026-03-01',600000,'2026-04-01') id`, [p1, cust]))[0].id;
    await db.query(`select public.create_payment_plan($1, 120000, 4, '2026-04-01')`, [sale]);
    const bank = (await q<{ id: string }>(db, `select id from public.bank_accounts limit 1`))[0].id;
    const inv = (await q<{ invoice_id: string }>(db, `select invoice_id from public.property_sales where id = $1`, [sale]))[0].invoice_id;
    await db.query(`select public.record_payment('in',$1,'2026-03-05',200000,'GHS',$2,$3::jsonb)`, [cust, bank, JSON.stringify([{ invoice_id: inv, amount: 200000 }])]);
    const sched = await q<{ seq: number; amount: string; settled: string; status: string }>(db, `select * from public.rpt_instalment_schedule('2026-06-01')`);
    expect(sched.map((r) => Number(r.amount))).toEqual([120000, 120000, 120000, 120000, 120000]);
    expect(sched.map((r) => Number(r.settled))).toEqual([120000, 80000, 0, 0, 0]);
    expect(sched.map((r) => r.status)).toEqual(['paid', 'overdue', 'overdue', 'upcoming', 'upcoming']);
    // deposits
    const dep = (await q<{ id: string }>(db, `select public.record_customer_deposit($1,null,'2026-05-01',50000,$2,'DEP-1') id`, [cust, bank]))[0].id;
    expect(await num(db, `select sum(base_credit - base_debit) v from public.journal_lines where account_id = $1`, [await acct(db, '2300')])).toBe(50000);
    await db.query(`select public.apply_customer_deposit($1,$2,50000,'2026-05-10')`, [dep, inv]);
    await expectError(db.query(`select public.apply_customer_deposit($1,$2,1,'2026-05-10')`, [dep, inv]), /unapplied deposit balance/);
    expect(await num(db, `select total - public.invoice_paid(id) v from public.invoices where id = $1`, [inv])).toBe(350000);
    expect(Number((await q<{ total: string }>(db, `select coalesce(sum(total),0) total from public.rpt_ar_aging('2026-06-30')`))[0].total)).toBe(350000);
    // commission
    const agent = (await q<{ id: string }>(db, `insert into public.suppliers(name) values ('Agent Ama') returning id`))[0].id;
    const cb = (await q<{ id: string }>(db, `select public.create_commission_bill($1,$2,2.5,'2026-03-10') id`, [sale, agent]))[0].id;
    expect(await num(db, `select total v from public.bills where id = $1`, [cb])).toBe(15000);
  }, 60000);

  it('Ash Elite: credit limit, price list, recipe, stock count and sales return', async () => {
    const db = await freshDb('ashelite'); await asUser(db, ACCOUNTANT);
    const cem = (await q<{ id: string }>(db, `insert into public.materials(sku,name) values ('CEM','Cement') returning id`))[0].id;
    const blk = (await q<{ id: string }>(db, `insert into public.products(sku,name,unit_price) values ('BLK','Block',10) returning id`))[0].id;
    const cust = (await q<{ id: string }>(db, `insert into public.customers(name, credit_limit) values ('BuildPro', 5000) returning id`))[0].id;
    await db.query(`insert into public.price_list(customer_id, product_id, unit_price, effective_from) values ($1,$2,9,'2026-01-01'), (null,$2,11,'2026-01-01')`, [cust, blk]);
    expect(await num(db, `select public.unit_price_for($1,$2,'2026-05-01') v`, [cust, blk])).toBe(9);
    expect(await num(db, `select public.unit_price_for(null,$1,'2026-05-01') v`, [blk])).toBe(11);
    // stock: materials via a bill, a recipe-based batch
    const sup = (await q<{ id: string }>(db, `insert into public.suppliers(name) values ('S') returning id`))[0].id;
    const bill = (await q<{ id: string }>(db, `insert into public.bills(supplier_id, issue_date, due_date) values ($1,'2026-01-05','2026-02-05') returning id`, [sup]))[0].id;
    await db.query(`insert into public.bill_lines(bill_id, description, quantity, unit_price, expense_account_id) values ($1,'Cement',100,80,$2)`, [bill, await acct(db, '1210')]);
    await db.query('select public.approve_bill($1)', [bill]); await db.query(`select public.receive_material($1,100,80,'2026-01-05',$2)`, [cem, bill]);
    const rec = (await q<{ id: string }>(db, `insert into public.recipes(product_id,name) values ($1,'Std 6in') returning id`, [blk]))[0].id;
    await db.query(`insert into public.recipe_materials(recipe_id, material_id, qty_per_unit) values ($1,$2,0.02)`, [rec, cem]);
    const batch = (await q<{ id: string }>(db, `insert into public.production_batches(product_id,batch_date,qty_produced,qty_good) values ($1,'2026-02-01',1000,1000) returning id`, [blk]))[0].id;
    expect(await num(db, `select public.apply_recipe($1,$2) v`, [batch, rec])).toBe(1);
    expect(await num(db, `select qty v from public.batch_materials where batch_id = $1`, [batch])).toBe(20);
    await db.query('select public.complete_batch($1)', [batch]);
    // invoice within / over credit limit
    const mk = async (qty: number) => { const id = (await q<{ id: string }>(db, `insert into public.invoices(customer_id, issue_date, due_date) values ($1,'2026-02-10','2026-03-10') returning id`, [cust]))[0].id;
      await db.query(`insert into public.invoice_lines(invoice_id, description, quantity, unit_price, revenue_account_id, product_id) values ($1,'Block',$2,9,$3,$4)`, [id, qty, await acct(db, '4100'), blk]); return id; };
    const i1 = await mk(400); await db.query('select public.issue_invoice($1)', [i1]);            // 3,600 within 5,000
    const i2 = await mk(200); await expectError(db.query('select public.issue_invoice($1)', [i2]), /Credit limit exceeded/);   // would reach 5,400
    await db.query('select public.post_invoice_cogs($1)', [i1]);
    // sales return of 100 blocks
    await expectError(db.query(`select public.record_sales_return($1,$2,500,'2026-02-15','x')`, [i1, blk]), /exceeds what is still returnable/);
    await db.query(`select public.record_sales_return($1,$2,100,'2026-02-15','Cracked')`, [i1, blk]);
    expect(await num(db, `select stock_qty v from public.products where id = $1`, [blk])).toBe(700);
    expect(await num(db, `select total - public.invoice_paid(id) v from public.invoices where id = $1`, [i1])).toBe(2700);
    // stock count with a shortage of 5 bags of cement
    const sc = (await q<{ id: string }>(db, `select public.start_stock_count('2026-02-28') id`))[0].id;
    await db.query(`update public.stock_count_lines set counted_qty = system_qty - 5 where count_id = $1 and material_id = $2`, [sc, cem]);
    await db.query('select public.post_stock_count($1)', [sc]);
    expect(await num(db, `select stock_qty v from public.materials where id = $1`, [cem])).toBe(75);
    expect(await num(db, `select sum(base_debit - base_credit) v from public.journal_lines where account_id = $1`, [await acct(db, '5160')])).toBe(400);
    await expectError(db.query(`update public.stock_count_lines set counted_qty = 1 where count_id = $1`, [sc]), /frozen/);
    const rm = await num(db, `select sum(base_debit - base_credit) v from public.journal_lines where account_id = $1`, [await acct(db, '1210')]);
    expect(Number((await q<{ v: string }>(db, `select sum(stock_qty * avg_cost) v from public.materials`))[0].v)).toBeCloseTo(rm, 1);
  }, 60000);
});
