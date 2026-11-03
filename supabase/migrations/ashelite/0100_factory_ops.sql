-- 0100 (Ash Elite only): raw materials, production batches, finished blocks, COGS, equipment & maintenance.

create sequence public.batch_seq;

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique, name text not null, unit text not null default 'kg',
  stock_qty numeric(18,3) not null default 0 check (stock_qty >= 0),
  avg_cost numeric(20,4) not null default 0,
  reorder_level numeric(18,3) not null default 0,
  is_active boolean not null default true
);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique, name text not null, unit text not null default 'block',
  unit_price numeric(20,4) not null default 0,
  stock_qty numeric(18,3) not null default 0 check (stock_qty >= 0),
  damaged_qty numeric(18,3) not null default 0,
  avg_cost numeric(20,4) not null default 0,
  is_active boolean not null default true
);
create table public.material_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  move_date date not null,
  move_type text not null check (move_type in ('receipt','consumption','waste')),
  qty numeric(18,3) not null,                   -- signed: + in, - out
  unit_cost numeric(20,4) not null default 0,
  batch_id uuid, bill_id uuid references public.bills(id), note text,
  created_at timestamptz not null default now()
);
create table public.production_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null unique default ('B-' || lpad(nextval('public.batch_seq')::text, 5, '0')),
  product_id uuid not null references public.products(id),
  batch_date date not null,
  qty_produced numeric(18,3) not null check (qty_produced > 0),
  qty_good numeric(18,3) not null check (qty_good >= 0),
  qty_damaged numeric(18,3) not null default 0 check (qty_damaged >= 0),
  labour_cost numeric(20,4) not null default 0 check (labour_cost >= 0),
  overhead_cost numeric(20,4) not null default 0 check (overhead_cost >= 0),
  material_cost numeric(20,4) not null default 0,
  cost_per_good numeric(20,4),
  status text not null default 'draft' check (status in ('draft','completed')),
  journal_id uuid references public.journals(id),
  created_at timestamptz not null default now(),
  check (qty_good + qty_damaged <= qty_produced)
);
create table public.batch_materials (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty numeric(18,3) not null check (qty > 0),
  unique (batch_id, material_id)
);
create table public.product_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  move_date date not null,
  move_type text not null check (move_type in ('production','sale','damaged')),
  qty numeric(18,3) not null, unit_cost numeric(20,4) not null default 0, ref_id uuid,
  created_at timestamptz not null default now()
);
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique, name text not null,
  status text not null default 'operational' check (status in ('operational','under_maintenance','retired')),
  fixed_asset_id uuid references public.fixed_assets(id)
);
create table public.maintenance_logs (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment(id),
  log_date date not null, description text not null,
  cost numeric(20,4) not null default 0, bill_id uuid references public.bills(id), next_due date
);

alter table public.invoice_lines add column product_id uuid references public.products(id);
alter table public.invoices add column cogs_journal_id uuid references public.journals(id);

create or replace function public.batch_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then raise exception 'Completed batches cannot be deleted'; end if;
    return old;
  end if;
  if old.status = 'completed' and current_setting('fms.batch_internal', true) <> 'on' then raise exception 'Completed batch % is immutable', old.batch_no; end if;
  return new;
end $$;
create trigger trg_batch_guard before update or delete on public.production_batches for each row execute function public.batch_guard();

create or replace function public.batch_materials_guard() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from public.production_batches where id = coalesce(new.batch_id, old.batch_id);
  if st = 'completed' then raise exception 'Batch is completed; materials are frozen'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_bm_guard before insert or update or delete on public.batch_materials for each row execute function public.batch_materials_guard();

-- Goods received (the purchase is booked via a supplier bill coded to raw-materials inventory); updates quantity and weighted-average cost.
create or replace function public.receive_material(p_material uuid, p_qty numeric, p_unit_cost numeric, p_date date, p_bill uuid default null) returns void language plpgsql as $$
declare m public.materials;
begin
  if p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  select * into m from public.materials where id = p_material for update;
  update public.materials set stock_qty = m.stock_qty + p_qty,
         avg_cost = round((m.stock_qty * m.avg_cost + p_qty * p_unit_cost) / (m.stock_qty + p_qty), 4) where id = p_material;
  insert into public.material_movements(material_id, move_date, move_type, qty, unit_cost, bill_id) values (p_material, p_date, 'receipt', p_qty, p_unit_cost, p_bill);
end $$;

create or replace function public.write_off_material(p_material uuid, p_qty numeric, p_date date, p_reason text) returns uuid language plpgsql as $$
declare m public.materials; amt numeric; jid uuid;
begin
  select * into m from public.materials where id = p_material for update;
  if p_qty <= 0 or p_qty > m.stock_qty then raise exception 'Invalid write-off quantity'; end if;
  amt := round(p_qty * m.avg_cost, 2);
  update public.materials set stock_qty = stock_qty - p_qty where id = p_material;
  insert into public.material_movements(material_id, move_date, move_type, qty, unit_cost, note) values (p_material, p_date, 'waste', -p_qty, m.avg_cost, p_reason);
  if amt = 0 then return null; end if;
  jid := public.create_journal(p_date, 'Material write-off ' || m.sku || ': ' || p_reason,
    jsonb_build_array(jsonb_build_object('account_id', public.map_account('MATERIAL_WASTE'), 'debit', amt), jsonb_build_object('account_id', public.map_account('RM_INVENTORY'), 'credit', amt)),
    m.sku, null, null, true, 'material_waste', p_material);
  return jid;
end $$;

create or replace function public.complete_batch(p_batch uuid) returns uuid language plpgsql as $$
declare b public.production_batches; bm record; mc numeric := 0; line numeric; total numeric; cpg numeric; p public.products; lines jsonb; jid uuid;
begin
  select * into b from public.production_batches where id = p_batch for update;
  if b.status <> 'draft' then raise exception 'Batch % is already %', b.batch_no, b.status; end if;
  if b.qty_good = 0 then raise exception 'A batch needs at least one good unit to carry its cost'; end if;
  if not exists (select 1 from public.batch_materials where batch_id = p_batch) then raise exception 'Batch has no materials recorded'; end if;
  for bm in select x.*, m.stock_qty, m.avg_cost, m.sku from public.batch_materials x join public.materials m on m.id = x.material_id where x.batch_id = p_batch for update of m loop
    if bm.qty > bm.stock_qty then raise exception 'Insufficient stock of %: need %, have %', bm.sku, bm.qty, bm.stock_qty; end if;
    line := round(bm.qty * bm.avg_cost, 2); mc := mc + line;
    update public.materials set stock_qty = stock_qty - bm.qty where id = bm.material_id;
    insert into public.material_movements(material_id, move_date, move_type, qty, unit_cost, batch_id) values (bm.material_id, b.batch_date, 'consumption', -bm.qty, bm.avg_cost, p_batch);
  end loop;
  total := mc + b.labour_cost + b.overhead_cost;
  cpg := round(total / b.qty_good, 4);
  select * into p from public.products where id = b.product_id for update;
  update public.products set stock_qty = p.stock_qty + b.qty_good, damaged_qty = p.damaged_qty + b.qty_damaged,
         avg_cost = round((p.stock_qty * p.avg_cost + total) / (p.stock_qty + b.qty_good), 4) where id = b.product_id;
  insert into public.product_movements(product_id, move_date, move_type, qty, unit_cost, ref_id) values (b.product_id, b.batch_date, 'production', b.qty_good, cpg, p_batch);
  if b.qty_damaged > 0 then insert into public.product_movements(product_id, move_date, move_type, qty, unit_cost, ref_id) values (b.product_id, b.batch_date, 'damaged', b.qty_damaged, 0, p_batch); end if;
  lines := jsonb_build_array(jsonb_build_object('account_id', public.map_account('FG_INVENTORY'), 'debit', total, 'description', 'Batch ' || b.batch_no));
  if mc > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('RM_INVENTORY'), 'credit', mc, 'description', 'Materials consumed'); end if;
  if b.labour_cost > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('LABOUR_ABSORBED'), 'credit', b.labour_cost, 'description', 'Labour absorbed'); end if;
  if b.overhead_cost > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('OVERHEAD_ABSORBED'), 'credit', b.overhead_cost, 'description', 'Overhead absorbed'); end if;
  jid := public.create_journal(b.batch_date, 'Production batch ' || b.batch_no, lines, b.batch_no, null, null, true, 'production', p_batch);
  perform set_config('fms.batch_internal', 'on', true);
  update public.production_batches set status = 'completed', material_cost = mc, cost_per_good = cpg, journal_id = jid where id = p_batch;
  perform set_config('fms.batch_internal', 'off', true);
  return jid;
end $$;

create or replace function public.post_invoice_cogs(p_invoice uuid) returns uuid language plpgsql as $$
declare inv public.invoices; l record; cost numeric := 0; c numeric; jid uuid; cc record;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.status <> 'issued' then raise exception 'Invoice must be issued before COGS is posted'; end if;
  if inv.cogs_journal_id is not null then raise exception 'COGS already posted for %', inv.number; end if;
  for l in select il.*, p.stock_qty, p.avg_cost, p.sku from public.invoice_lines il join public.products p on p.id = il.product_id where il.invoice_id = p_invoice for update of p loop
    if l.quantity > l.stock_qty then raise exception 'Insufficient finished stock of %: need %, have %', l.sku, l.quantity, l.stock_qty; end if;
    c := round(l.quantity * l.avg_cost, 2); cost := cost + c;
    update public.products set stock_qty = stock_qty - l.quantity where id = l.product_id;
    insert into public.product_movements(product_id, move_date, move_type, qty, unit_cost, ref_id) values (l.product_id, inv.issue_date, 'sale', -l.quantity, l.avg_cost, p_invoice);
  end loop;
  if cost = 0 then raise exception 'Invoice has no stock-tracked lines with a cost'; end if;
  jid := public.create_journal(inv.issue_date, 'Cost of goods sold ' || inv.number,
    jsonb_build_array(jsonb_build_object('account_id', public.map_account('COGS'), 'debit', cost), jsonb_build_object('account_id', public.map_account('FG_INVENTORY'), 'credit', cost)),
    inv.number, null, null, true, 'cogs', p_invoice);
  perform set_config('fms.doc_internal', 'on', true);
  update public.invoices set cogs_journal_id = jid where id = p_invoice;
  perform set_config('fms.doc_internal', 'off', true);
  return jid;
end $$;

create or replace function public.rpt_cost_per_block(p_from date, p_to date)
returns table(batch_no text, batch_date date, product text, qty_good numeric, qty_damaged numeric, material_cost numeric, labour_cost numeric, overhead_cost numeric, total_cost numeric, cost_per_good numeric)
language sql stable as $$
  select b.batch_no, b.batch_date, p.name, b.qty_good, b.qty_damaged, b.material_cost, b.labour_cost, b.overhead_cost, b.material_cost + b.labour_cost + b.overhead_cost, b.cost_per_good
  from public.production_batches b join public.products p on p.id = b.product_id where b.status = 'completed' and b.batch_date between p_from and p_to order by b.batch_date, b.batch_no $$;

create or replace function public.rpt_inventory_valuation()
returns table(kind text, sku text, name text, qty numeric, avg_cost numeric, value numeric)
language sql stable as $$
  select 'raw material', sku, name, stock_qty, avg_cost, round(stock_qty * avg_cost, 2) from public.materials
  union all select 'finished', sku, name, stock_qty, avg_cost, round(stock_qty * avg_cost, 2) from public.products
  union all select 'damaged/rejected (units, no value)', sku, name, damaged_qty, 0, 0 from public.products where damaged_qty > 0 order by 1, 2 $$;

create or replace function public.rpt_material_usage(p_from date, p_to date)
returns table(sku text, name text, received numeric, consumed numeric, wasted numeric, closing numeric)
language sql stable as $$
  select m.sku, m.name,
    coalesce(sum(mm.qty) filter (where mm.move_type = 'receipt'),0), coalesce(-sum(mm.qty) filter (where mm.move_type = 'consumption'),0),
    coalesce(-sum(mm.qty) filter (where mm.move_type = 'waste'),0), m.stock_qty
  from public.materials m left join public.material_movements mm on mm.material_id = m.id and mm.move_date between p_from and p_to group by m.id order by m.sku $$;

select public._secure_tables(array['materials','products','material_movements','production_batches','batch_materials','product_movements','equipment','maintenance_logs']);
select public._audit_tables(array['materials','products','material_movements','production_batches','batch_materials','product_movements','equipment','maintenance_logs']);

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
