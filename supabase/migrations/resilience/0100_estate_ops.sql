-- 0100 (Resilience Estate only): projects, properties, sales, rentals, profitability.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  status text not null default 'planning' check (status in ('planning','active','completed','on_hold')),
  start_date date, end_date date,
  budget numeric(20,4) not null default 0,
  cost_centre_id uuid not null references public.cost_centres(id),
  created_at timestamptz not null default now()
);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  project_id uuid references public.projects(id),
  property_type text not null default 'house', location text,
  list_price numeric(20,4) not null default 0,
  cost_basis numeric(20,4) not null default 0,
  status text not null default 'available' check (status in ('available','reserved','sold','rented')),
  created_at timestamptz not null default now()
);
create table public.property_sales (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id),
  customer_id uuid not null references public.customers(id),
  sale_date date not null, price numeric(20,4) not null check (price > 0),
  invoice_id uuid references public.invoices(id),
  cogs_journal_id uuid references public.journals(id),
  created_at timestamptz not null default now()
);
create table public.rental_agreements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  customer_id uuid not null references public.customers(id),
  rent_amount numeric(20,4) not null check (rent_amount > 0),
  deposit numeric(20,4) not null default 0,
  start_date date not null, end_date date,
  status text not null default 'active' check (status in ('active','ended'))
);
create table public.rental_charges (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.rental_agreements(id),
  charge_month date not null,
  invoice_id uuid not null references public.invoices(id),
  unique (agreement_id, charge_month)
);

create or replace function public.create_project(p_code text, p_name text, p_budget numeric default 0, p_start date default null) returns uuid language plpgsql as $$
declare cc uuid; pid uuid;
begin
  insert into public.cost_centres(code, name, kind) values ('PRJ-' || p_code, p_name, 'project') returning id into cc;
  insert into public.projects(code, name, budget, start_date, cost_centre_id, status) values (p_code, p_name, p_budget, p_start, cc, 'active') returning id into pid;
  return pid;
end $$;

create or replace function public.book_property_sale(p_property uuid, p_customer uuid, p_date date, p_price numeric, p_due date) returns uuid language plpgsql as $$
declare pr public.properties; cc uuid; inv uuid; sid uuid; jid uuid;
begin
  select * into pr from public.properties where id = p_property for update;
  if pr.status = 'sold' then raise exception 'Property % is already sold', pr.code; end if;
  select cost_centre_id into cc from public.projects where id = pr.project_id;
  insert into public.invoices(customer_id, issue_date, due_date, notes) values (p_customer, p_date, p_due, 'Sale of ' || pr.name) returning id into inv;
  insert into public.invoice_lines(invoice_id, description, quantity, unit_price, revenue_account_id, cost_centre_id)
  values (inv, 'Sale of ' || pr.name, 1, p_price, public.map_account('PROPERTY_SALES'), cc);
  perform public.issue_invoice(inv);
  insert into public.property_sales(property_id, customer_id, sale_date, price, invoice_id) values (p_property, p_customer, p_date, p_price, inv) returning id into sid;
  if pr.cost_basis > 0 then
    jid := public.create_journal(p_date, 'Cost of property sold ' || pr.code,
      jsonb_build_array(jsonb_build_object('account_id', public.map_account('PROPERTY_COGS'), 'cost_centre_id', cc, 'debit', pr.cost_basis),
                        jsonb_build_object('account_id', public.map_account('PROPERTY_INVENTORY'), 'cost_centre_id', cc, 'credit', pr.cost_basis)),
      pr.code, null, null, true, 'property_sale', sid);
    update public.property_sales set cogs_journal_id = jid where id = sid;
  end if;
  update public.properties set status = 'sold' where id = p_property;
  return sid;
end $$;

create or replace function public.generate_rent_invoice(p_agreement uuid, p_month date) returns uuid language plpgsql as $$
declare ag public.rental_agreements; m date := date_trunc('month', p_month)::date; inv uuid; cc uuid;
begin
  select * into ag from public.rental_agreements where id = p_agreement and status = 'active';
  if ag.id is null then raise exception 'Active agreement not found'; end if;
  if m < date_trunc('month', ag.start_date)::date or (ag.end_date is not null and m > ag.end_date) then raise exception 'Month is outside the agreement term'; end if;
  select pj.cost_centre_id into cc from public.properties p left join public.projects pj on pj.id = p.project_id where p.id = ag.property_id;
  insert into public.invoices(customer_id, issue_date, due_date, notes) values (ag.customer_id, m, m + 14, 'Rent ' || to_char(m, 'Mon YYYY')) returning id into inv;
  insert into public.invoice_lines(invoice_id, description, quantity, unit_price, revenue_account_id, cost_centre_id)
  values (inv, 'Rent ' || to_char(m, 'Mon YYYY'), 1, ag.rent_amount, public.map_account('RENTAL_INCOME'), cc);
  perform public.issue_invoice(inv);
  insert into public.rental_charges(agreement_id, charge_month, invoice_id) values (p_agreement, m, inv);
  return inv;
end $$;

create or replace function public.rpt_project_profitability(p_from date, p_to date)
returns table(project_code text, project_name text, budget numeric, revenue numeric, costs numeric, profit numeric, budget_used_pct numeric)
language sql stable as $$
  select p.code, p.name, p.budget,
    coalesce(sum(l.base_credit - l.base_debit) filter (where a.type = 'income'),0),
    coalesce(sum(l.base_debit - l.base_credit) filter (where a.type = 'expense' or a.subtype = 'project_cost'),0),
    coalesce(sum(l.base_credit - l.base_debit) filter (where a.type = 'income'),0) - coalesce(sum(l.base_debit - l.base_credit) filter (where a.type = 'expense' or a.subtype = 'project_cost'),0),
    case when p.budget = 0 then null else round(coalesce(sum(l.base_debit - l.base_credit) filter (where a.type = 'expense' or a.subtype = 'project_cost'),0) / p.budget * 100, 2) end
  from public.projects p
  left join public.journal_lines l on l.cost_centre_id = p.cost_centre_id
  left join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed') and j.entry_date between p_from and p_to
  left join public.accounts a on a.id = l.account_id and j.id is not null
  group by p.id, p.code, p.name, p.budget order by p.code
$$;

create or replace function public.rpt_property_sales(p_from date, p_to date)
returns table(sale_date date, property_code text, property_name text, customer text, price numeric, invoice_number text, received numeric, outstanding numeric)
language sql stable as $$
  select s.sale_date, p.code, p.name, c.name, s.price, i.number, public.invoice_paid(i.id), i.total - public.invoice_paid(i.id)
  from public.property_sales s join public.properties p on p.id = s.property_id join public.customers c on c.id = s.customer_id join public.invoices i on i.id = s.invoice_id
  where s.sale_date between p_from and p_to order by s.sale_date $$;

create or replace function public.rpt_rental_roll(p_as_of date)
returns table(property_code text, tenant text, rent_amount numeric, start_date date, end_date date, billed_to_date numeric, outstanding numeric)
language sql stable as $$
  select p.code, c.name, ra.rent_amount, ra.start_date, ra.end_date,
    coalesce((select sum(i.total) from public.rental_charges rc join public.invoices i on i.id = rc.invoice_id where rc.agreement_id = ra.id and rc.charge_month <= p_as_of),0),
    coalesce((select sum(i.total - public.invoice_paid(i.id)) from public.rental_charges rc join public.invoices i on i.id = rc.invoice_id where rc.agreement_id = ra.id and rc.charge_month <= p_as_of),0)
  from public.rental_agreements ra join public.properties p on p.id = ra.property_id join public.customers c on c.id = ra.customer_id where ra.status = 'active' order by p.code $$;

select public._secure_tables(array['projects','properties','property_sales','rental_agreements','rental_charges']);
select public._audit_tables(array['projects','properties','property_sales','rental_agreements','rental_charges']);

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
