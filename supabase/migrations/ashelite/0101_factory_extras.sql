-- 0101 (Ash Elite only): delivery notes, price lists and credit limits, recipes, stock counts, sales returns.

insert into public.accounts (code, name, type, subtype, cash_flow_category, is_system) values ('5160','Inventory Adjustments','expense',null,'operating',true) on conflict (code) do nothing;
insert into public.account_mappings(key, account_id) select 'INVENTORY_ADJUSTMENT', id from public.accounts where code = '5160' on conflict (key) do nothing;

alter table public.customers add column credit_limit numeric(20,4) not null default 0 check (credit_limit >= 0);
alter table public.material_movements drop constraint material_movements_move_type_check;
alter table public.material_movements add constraint material_movements_move_type_check check (move_type in ('receipt','consumption','waste','adjustment'));
alter table public.product_movements drop constraint product_movements_move_type_check;
alter table public.product_movements add constraint product_movements_move_type_check check (move_type in ('production','sale','damaged','adjustment','return'));

create sequence public.delivery_note_seq;
create table public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('DN-' || lpad(nextval('public.delivery_note_seq')::text, 6, '0')),
  invoice_id uuid references public.invoices(id),
  customer_id uuid not null references public.customers(id),
  delivery_date date not null default current_date,
  delivery_address text, vehicle text, driver text, notes text,
  status text not null default 'draft' check (status in ('draft','dispatched','delivered')),
  created_at timestamptz not null default now()
);
create table public.delivery_note_lines (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.delivery_notes(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(18,3) not null check (quantity > 0)
);
create or replace function public.dn_lines_guard() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from public.delivery_notes where id = coalesce(new.note_id, old.note_id);
  if st <> 'draft' then raise exception 'Delivery note is %; its lines are frozen', st; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_dnl_guard before insert or update or delete on public.delivery_note_lines for each row execute function public.dn_lines_guard();

create table public.price_list (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),            -- null = default price for everyone
  product_id uuid not null references public.products(id),
  unit_price numeric(20,4) not null check (unit_price >= 0),
  effective_from date not null default current_date
);
create unique index price_list_unique on public.price_list (coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), product_id, effective_from);

create or replace function public.unit_price_for(p_customer uuid, p_product uuid, p_date date default current_date) returns numeric language sql stable as $$
  select coalesce(
    (select unit_price from public.price_list where customer_id = p_customer and product_id = p_product and effective_from <= p_date order by effective_from desc limit 1),
    (select unit_price from public.price_list where customer_id is null and product_id = p_product and effective_from <= p_date order by effective_from desc limit 1),
    (select unit_price from public.products where id = p_product)) $$;

-- Replaces the no-op hook from the common schema: blocks issuing an invoice that would take the customer over their credit limit
create or replace function public.invoice_hook_before_issue(p_customer uuid, p_total numeric, p_currency char) returns void language plpgsql as $$
declare lim numeric; owed numeric; nm text; new_base numeric;
begin
  select credit_limit, name into lim, nm from public.customers where id = p_customer;
  if coalesce(lim, 0) <= 0 then return; end if;
  select coalesce(sum((i.total - public.invoice_paid(i.id)) * case when i.currency = public.base_currency() then 1 else i.fx_rate end), 0) into owed from public.invoices i where i.customer_id = p_customer and i.status = 'issued';
  new_base := p_total * case when p_currency = public.base_currency() then 1 else public.get_fx_rate(p_currency, public.base_currency(), current_date) end;
  if owed + new_base > lim then
    raise exception 'Credit limit exceeded for %: limit %, owed %, this invoice %', nm, lim, owed, p_total;
  end if;
end $$;

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  name text not null, unique (product_id, name)
);
create table public.recipe_materials (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  qty_per_unit numeric(18,6) not null check (qty_per_unit > 0),
  unique (recipe_id, material_id)
);
create or replace function public.apply_recipe(p_batch uuid, p_recipe uuid) returns int language plpgsql as $$
declare b public.production_batches; n int;
begin
  select * into b from public.production_batches where id = p_batch;
  if b.id is null or b.status <> 'draft' then raise exception 'Choose a draft batch'; end if;
  if not exists (select 1 from public.recipes where id = p_recipe and product_id = b.product_id) then raise exception 'Recipe belongs to a different product'; end if;
  delete from public.batch_materials where batch_id = p_batch;
  insert into public.batch_materials(batch_id, material_id, qty) select p_batch, material_id, round(qty_per_unit * b.qty_produced, 3) from public.recipe_materials where recipe_id = p_recipe;
  get diagnostics n = row_count; return n;
end $$;

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  count_date date not null, status text not null default 'draft' check (status in ('draft','posted')), notes text,
  created_at timestamptz not null default now()
);
create table public.stock_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.stock_counts(id) on delete cascade,
  material_id uuid references public.materials(id), product_id uuid references public.products(id),
  system_qty numeric(18,3) not null, counted_qty numeric(18,3) check (counted_qty >= 0), unit_cost numeric(20,4) not null default 0,
  check ((material_id is not null) <> (product_id is not null))
);
create or replace function public.sc_lines_guard() returns trigger language plpgsql as $$
declare st text;
begin
  select status into st from public.stock_counts where id = coalesce(new.count_id, old.count_id);
  if st <> 'draft' and current_setting('fms.sc_internal', true) <> 'on' then raise exception 'Stock count is posted; lines are frozen'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_scl_guard before update or delete on public.stock_count_lines for each row execute function public.sc_lines_guard();

create or replace function public.start_stock_count(p_date date, p_notes text default null) returns uuid language plpgsql as $$
declare cid uuid;
begin
  insert into public.stock_counts(count_date, notes) values (p_date, p_notes) returning id into cid;
  insert into public.stock_count_lines(count_id, material_id, system_qty, counted_qty, unit_cost) select cid, id, stock_qty, stock_qty, avg_cost from public.materials where is_active;
  insert into public.stock_count_lines(count_id, product_id, system_qty, counted_qty, unit_cost) select cid, id, stock_qty, stock_qty, avg_cost from public.products where is_active;
  return cid;
end $$;

create or replace function public.post_stock_count(p_count uuid) returns uuid language plpgsql as $$
declare c public.stock_counts; l record; rm numeric := 0; fg numeric := 0; lines jsonb := '[]'::jsonb; jid uuid; v numeric; amt numeric;
begin
  select * into c from public.stock_counts where id = p_count for update;
  if c.id is null or c.status <> 'draft' then raise exception 'Stock count not found or already posted'; end if;
  for l in select * from public.stock_count_lines where count_id = p_count and counted_qty is not null loop
    v := l.counted_qty - l.system_qty; continue when v = 0;
    amt := round(v * l.unit_cost, 2);
    if l.material_id is not null then
      update public.materials set stock_qty = l.counted_qty where id = l.material_id;
      insert into public.material_movements(material_id, move_date, move_type, qty, unit_cost, note) values (l.material_id, c.count_date, 'adjustment', v, l.unit_cost, 'Stock count');
      rm := rm + amt;
    else
      update public.products set stock_qty = l.counted_qty where id = l.product_id;
      insert into public.product_movements(product_id, move_date, move_type, qty, unit_cost, ref_id) values (l.product_id, c.count_date, 'adjustment', v, l.unit_cost, p_count);
      fg := fg + amt;
    end if;
  end loop;
  if rm <> 0 then lines := lines || jsonb_build_object('account_id', public.map_account('RM_INVENTORY'), case when rm > 0 then 'debit' else 'credit' end, abs(rm), 'description', 'Stock count variance'); end if;
  if fg <> 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FG_INVENTORY'), case when fg > 0 then 'debit' else 'credit' end, abs(fg), 'description', 'Stock count variance'); end if;
  if rm + fg <> 0 then lines := lines || jsonb_build_object('account_id', public.map_account('INVENTORY_ADJUSTMENT'), case when rm + fg > 0 then 'credit' else 'debit' end, abs(rm + fg), 'description', 'Stock count variance');
    jid := public.create_journal(c.count_date, 'Stock count ' || c.count_date, lines, 'COUNT-' || c.count_date, null, null, true, 'stock_count', p_count); end if;
  perform set_config('fms.sc_internal', 'on', true);
  update public.stock_counts set status = 'posted' where id = p_count;
  perform set_config('fms.sc_internal', 'off', true);
  return jid;
end $$;

-- Returned blocks: credits the customer (credit note) and puts the goods back into finished stock at their original cost
create or replace function public.record_sales_return(p_invoice uuid, p_product uuid, p_qty numeric, p_date date, p_reason text) returns uuid language plpgsql as $$
declare inv public.invoices; il public.invoice_lines; sold numeric; returned numeric; ucost numeric; cn uuid; amt numeric;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.status <> 'issued' then raise exception 'Only an issued invoice can have returns'; end if;
  if inv.cogs_journal_id is null then raise exception 'Cost of sales has not been posted for this invoice; use a credit note or void it instead'; end if;
  select * into il from public.invoice_lines where invoice_id = p_invoice and product_id = p_product limit 1;
  if il.id is null then raise exception 'The invoice has no line for this product'; end if;
  select coalesce(-sum(qty), 0) into sold from public.product_movements where ref_id = p_invoice and product_id = p_product and move_type = 'sale';
  select coalesce(sum(qty), 0) into returned from public.product_movements where ref_id = p_invoice and product_id = p_product and move_type = 'return';
  if p_qty <= 0 or p_qty > sold - returned then raise exception 'Return quantity exceeds what is still returnable (%)', sold - returned; end if;
  select unit_cost into ucost from public.product_movements where ref_id = p_invoice and product_id = p_product and move_type = 'sale' limit 1;
  insert into public.credit_notes(kind, customer_id, invoice_id, issue_date, currency, fx_rate, reason) values ('sales', inv.customer_id, p_invoice, p_date, inv.currency, inv.fx_rate, p_reason) returning id into cn;
  insert into public.credit_note_lines(credit_note_id, description, quantity, unit_price, tax_rate, account_id, cost_centre_id) values (cn, 'Return: ' || p_reason, p_qty, il.unit_price, il.tax_rate, il.revenue_account_id, il.cost_centre_id);
  perform public.issue_credit_note(cn);
  amt := round(p_qty * ucost, 2);
  update public.products set stock_qty = stock_qty + p_qty where id = p_product;
  insert into public.product_movements(product_id, move_date, move_type, qty, unit_cost, ref_id) values (p_product, p_date, 'return', p_qty, ucost, p_invoice);
  if amt > 0 then perform public.create_journal(p_date, 'Returned stock ' || inv.number,
    jsonb_build_array(jsonb_build_object('account_id', public.map_account('FG_INVENTORY'), 'debit', amt), jsonb_build_object('account_id', public.map_account('COGS'), 'credit', amt)), inv.number, null, null, true, 'sales_return', cn); end if;
  return cn;
end $$;

select public._secure_tables(array['delivery_notes','delivery_note_lines','price_list','recipes','recipe_materials','stock_counts','stock_count_lines']);
select public._audit_tables(array['delivery_notes','delivery_note_lines','price_list','recipes','recipe_materials','stock_counts','stock_count_lines']);
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
