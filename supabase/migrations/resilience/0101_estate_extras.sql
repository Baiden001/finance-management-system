-- 0101 (Resilience only): instalment plans, customer deposits, agent commissions, project cost allocation.

insert into public.accounts (code, name, type, subtype, cash_flow_category, is_system) values ('5220','Sales Commissions','expense',null,'operating',true) on conflict (code) do nothing;
insert into public.account_mappings(key, account_id) select 'COMMISSION_EXPENSE', id from public.accounts where code = '5220' on conflict (key) do nothing;

create table public.payment_plans (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null unique references public.property_sales(id),
  deposit numeric(20,4) not null default 0 check (deposit >= 0),
  instalment_count int not null check (instalment_count >= 1),
  created_at timestamptz not null default now()
);
create table public.plan_instalments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.payment_plans(id) on delete cascade,
  seq int not null, due_date date not null, amount numeric(20,4) not null check (amount > 0),
  unique (plan_id, seq)
);
create table public.customer_deposits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  property_id uuid references public.properties(id),
  deposit_date date not null,
  amount numeric(20,4) not null check (amount > 0),
  applied numeric(20,4) not null default 0 check (applied >= 0),
  bank_account_id uuid not null references public.bank_accounts(id),
  reference text,
  journal_id uuid references public.journals(id),
  created_at timestamptz not null default now(),
  check (applied <= amount)
);
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.property_sales(id),
  supplier_id uuid not null references public.suppliers(id),
  rate numeric(7,4) not null check (rate > 0 and rate <= 100),
  amount numeric(20,4) not null,
  bill_id uuid not null references public.bills(id),
  created_at timestamptz not null default now()
);

-- Splits (price - deposit) into equal monthly instalments (last one absorbs rounding); the deposit is due on the sale date.
create or replace function public.create_payment_plan(p_sale uuid, p_deposit numeric, p_count int, p_first_due date) returns uuid language plpgsql as $$
declare s public.property_sales; pid uuid; per numeric; i int; rest numeric;
begin
  select * into s from public.property_sales where id = p_sale;
  if s.id is null then raise exception 'Sale not found'; end if;
  if p_deposit < 0 or p_deposit >= s.price then raise exception 'Deposit must be between zero and the price'; end if;
  insert into public.payment_plans(sale_id, deposit, instalment_count) values (p_sale, p_deposit, p_count) returning id into pid;
  if p_deposit > 0 then insert into public.plan_instalments(plan_id, seq, due_date, amount) values (pid, 0, s.sale_date, p_deposit); end if;
  per := round((s.price - p_deposit) / p_count, 2); rest := s.price - p_deposit;
  for i in 1 .. p_count loop
    insert into public.plan_instalments(plan_id, seq, due_date, amount) values (pid, i, (p_first_due + ((i - 1) || ' months')::interval)::date, case when i = p_count then rest else per end);
    rest := rest - per;
  end loop;
  return pid;
end $$;

-- Receipts are applied to instalments oldest-first (FIFO) from what the invoice has settled as of the date.
create or replace function public.rpt_instalment_schedule(p_as_of date)
returns table(property text, customer text, seq int, due_date date, amount numeric, settled numeric, outstanding numeric, status text)
language sql stable as $$
  with paid as (
    select s.id sale_id, coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id where a.invoice_id = s.invoice_id and p.payment_date <= p_as_of), 0)
         + coalesce((select sum(dc.amount) from public.document_credits dc where dc.invoice_id = s.invoice_id and dc.credit_date <= p_as_of), 0) total_paid
    from public.property_sales s),
  r as (
    select pl.sale_id, i.seq, i.due_date, i.amount, sum(i.amount) over (partition by pl.id order by i.seq) - i.amount prior
    from public.plan_instalments i join public.payment_plans pl on pl.id = i.plan_id)
  select pr.name, c.name, r.seq, r.due_date, r.amount,
         greatest(0, least(r.amount, pd.total_paid - r.prior)), r.amount - greatest(0, least(r.amount, pd.total_paid - r.prior)),
         case when r.amount - greatest(0, least(r.amount, pd.total_paid - r.prior)) = 0 then 'paid' when r.due_date < p_as_of then 'overdue' else 'upcoming' end
  from r join paid pd on pd.sale_id = r.sale_id join public.property_sales s on s.id = r.sale_id join public.properties pr on pr.id = s.property_id join public.customers c on c.id = s.customer_id
  order by pr.name, r.seq
$$;

create or replace function public.record_customer_deposit(p_customer uuid, p_property uuid, p_date date, p_amount numeric, p_bank_account uuid, p_reference text default null) returns uuid language plpgsql as $$
declare ba uuid; cur char(3); jid uuid; did uuid;
begin
  select account_id, currency into ba, cur from public.bank_accounts where id = p_bank_account;
  if ba is null then raise exception 'Bank account not found'; end if;
  if cur <> public.base_currency() then raise exception 'Customer deposits are recorded in the base currency'; end if;
  insert into public.customer_deposits(customer_id, property_id, deposit_date, amount, bank_account_id, reference) values (p_customer, p_property, p_date, p_amount, p_bank_account, p_reference) returning id into did;
  jid := public.create_journal(p_date, 'Customer deposit ' || coalesce(p_reference, ''),
    jsonb_build_array(jsonb_build_object('account_id', ba, 'debit', p_amount), jsonb_build_object('account_id', public.map_account('CUSTOMER_DEPOSITS'), 'credit', p_amount)), p_reference, null, null, true, 'deposit', did);
  update public.customer_deposits set journal_id = jid where id = did;
  return did;
end $$;

create or replace function public.apply_customer_deposit(p_deposit uuid, p_invoice uuid, p_amount numeric, p_date date default current_date) returns uuid language plpgsql as $$
declare d public.customer_deposits; open_amt numeric; cur char(3); jid uuid;
begin
  select * into d from public.customer_deposits where id = p_deposit for update;
  if d.id is null then raise exception 'Deposit not found'; end if;
  if p_amount <= 0 or p_amount > d.amount - d.applied then raise exception 'Amount exceeds the unapplied deposit balance %', d.amount - d.applied; end if;
  select total - public.invoice_paid(id), currency into open_amt, cur from public.invoices where id = p_invoice and customer_id = d.customer_id and status = 'issued';
  if open_amt is null then raise exception 'Invoice not found, not open, or belongs to another customer'; end if;
  if cur <> public.base_currency() then raise exception 'Deposits can only be applied to base-currency invoices'; end if;
  if p_amount > open_amt then raise exception 'Amount exceeds the invoice open balance %', open_amt; end if;
  jid := public.create_journal(p_date, 'Apply customer deposit to invoice',
    jsonb_build_array(jsonb_build_object('account_id', public.map_account('CUSTOMER_DEPOSITS'), 'debit', p_amount), jsonb_build_object('account_id', public.map_account('AR'), 'credit', p_amount)), null, null, null, true, 'deposit_application', p_deposit);
  insert into public.document_credits(invoice_id, kind, ref_id, amount, credit_date) values (p_invoice, 'deposit', p_deposit, p_amount, p_date);
  update public.customer_deposits set applied = applied + p_amount where id = p_deposit;
  return jid;
end $$;

-- Agent commission on a sale is raised as an approved supplier bill (the agent is a supplier)
create or replace function public.create_commission_bill(p_sale uuid, p_supplier uuid, p_rate numeric, p_date date default current_date) returns uuid language plpgsql as $$
declare s public.property_sales; amt numeric; bid uuid; cc uuid;
begin
  select * into s from public.property_sales where id = p_sale;
  if s.id is null then raise exception 'Sale not found'; end if;
  amt := round(s.price * p_rate / 100, 2);
  select pj.cost_centre_id into cc from public.properties p left join public.projects pj on pj.id = p.project_id where p.id = s.property_id;
  insert into public.bills(supplier_id, supplier_ref, issue_date, due_date) values (p_supplier, 'Commission', p_date, p_date + 30) returning id into bid;
  insert into public.bill_lines(bill_id, description, quantity, unit_price, expense_account_id, cost_centre_id) values (bid, 'Sales commission ' || p_rate || '%', 1, amt, public.map_account('COMMISSION_EXPENSE'), cc);
  perform public.approve_bill(bid);
  insert into public.commissions(sale_id, supplier_id, rate, amount, bill_id) values (p_sale, p_supplier, p_rate, amt, bid);
  return bid;
end $$;

-- Spreads capitalised development cost held for a project across its unsold properties (by list price or equally)
create or replace function public.allocate_project_costs(p_project uuid, p_basis text default 'list_price') returns numeric language plpgsql as $$
declare pj public.projects; total numeric; wsum numeric; n int; acc uuid;
begin
  select * into pj from public.projects where id = p_project;
  if pj.id is null then raise exception 'Project not found'; end if;
  acc := public.map_account('PROPERTY_INVENTORY');
  select coalesce(sum(l.base_debit - l.base_credit), 0) into total from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
   where l.account_id = acc and l.cost_centre_id = pj.cost_centre_id;
  select count(*), coalesce(sum(case when p_basis = 'equal' then 1 else list_price end), 0) into n, wsum from public.properties where project_id = p_project and status <> 'sold';
  if n = 0 then raise exception 'The project has no unsold properties'; end if;
  if wsum = 0 then raise exception 'List prices are required for allocation by list price (or use equal)'; end if;
  update public.properties set cost_basis = round(total * (case when p_basis = 'equal' then 1 else list_price end) / wsum, 2) where project_id = p_project and status <> 'sold';
  return total;
end $$;

create view public.v_sales_pick with (security_invoker = true) as
  select s.id, p.name || ' / ' || c.name || ' / ' || to_char(s.price, 'FM999,999,990') as label from public.property_sales s join public.properties p on p.id = s.property_id join public.customers c on c.id = s.customer_id;
revoke all on public.v_sales_pick from anon; grant select on public.v_sales_pick to authenticated;

select public._secure_tables(array['payment_plans','plan_instalments','customer_deposits','commissions']);
select public._audit_tables(array['payment_plans','plan_instalments','customer_deposits','commissions']);
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
