-- 0003: customers, suppliers, invoices, bills, payments (AR/AP), banking and reconciliation.

create sequence public.invoice_seq; create sequence public.bill_seq; create sequence public.payment_seq;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text, email text, address text, tin text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text, email text, address text, tin text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('INV-' || lpad(nextval('public.invoice_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers(id),
  issue_date date not null default current_date,
  due_date date not null,
  currency char(3) not null default 'GHS',
  fx_rate numeric(20,10) not null default 1 check (fx_rate > 0),
  status text not null default 'draft' check (status in ('draft','issued','void')),
  subtotal numeric(20,4) not null default 0,
  tax_total numeric(20,4) not null default 0,
  total numeric(20,4) not null default 0,
  journal_id uuid references public.journals(id),
  notes text,
  created_at timestamptz not null default now(),
  check (due_date >= issue_date)
);
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  unit_price numeric(20,4) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0),
  revenue_account_id uuid not null references public.accounts(id),
  cost_centre_id uuid references public.cost_centres(id),
  line_total numeric(20,4) generated always as (round(quantity * unit_price, 2)) stored
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('BILL-' || lpad(nextval('public.bill_seq')::text, 6, '0')),
  supplier_id uuid not null references public.suppliers(id),
  supplier_ref text,
  issue_date date not null default current_date,
  due_date date not null,
  currency char(3) not null default 'GHS',
  fx_rate numeric(20,10) not null default 1 check (fx_rate > 0),
  status text not null default 'draft' check (status in ('draft','approved','void')),
  subtotal numeric(20,4) not null default 0,
  tax_total numeric(20,4) not null default 0,
  total numeric(20,4) not null default 0,
  journal_id uuid references public.journals(id),
  retention_pct numeric(7,4) not null default 0 check (retention_pct >= 0 and retention_pct < 100),
  retention_amount numeric(20,4) not null default 0,
  retention_released boolean not null default false,
  retention_state text generated always as (case when retention_amount > 0 and not retention_released then 'held' else 'none' end) stored,
  notes text,
  created_at timestamptz not null default now(),
  check (due_date >= issue_date)
);
create table public.bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  description text not null,
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  unit_price numeric(20,4) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0),
  expense_account_id uuid not null references public.accounts(id),
  cost_centre_id uuid references public.cost_centres(id),
  line_total numeric(20,4) generated always as (round(quantity * unit_price, 2)) stored
);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.accounts(id),
  name text not null, bank_name text, currency char(3) not null default 'GHS',
  account_last4 text, kind text not null default 'bank' check (kind in ('bank','momo','cash')),
  is_active boolean not null default true
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('PAY-' || lpad(nextval('public.payment_seq')::text, 6, '0')),
  direction text not null check (direction in ('in','out')),
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  payment_date date not null,
  amount numeric(20,4) not null check (amount > 0),
  currency char(3) not null,
  fx_rate numeric(20,10) not null default 1 check (fx_rate > 0),
  bank_account_id uuid not null references public.bank_accounts(id),
  method text not null default 'bank' check (method in ('bank','momo','cash','cheque')),
  reference text,
  withholding numeric(20,4) not null default 0 check (withholding >= 0),
  journal_id uuid references public.journals(id),
  created_at timestamptz not null default now(),
  check ((direction = 'in' and customer_id is not null and supplier_id is null) or (direction = 'out' and supplier_id is not null and customer_id is null))
);
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  invoice_id uuid references public.invoices(id),
  bill_id uuid references public.bills(id),
  amount numeric(20,4) not null check (amount > 0),
  check ((invoice_id is not null) <> (bill_id is not null))
);
create index pa_invoice_idx on public.payment_allocations (invoice_id);
create index pa_bill_idx on public.payment_allocations (bill_id);

create sequence public.credit_note_seq;
create table public.credit_notes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('CN-' || lpad(nextval('public.credit_note_seq')::text, 6, '0')),
  kind text not null check (kind in ('sales','purchase')),
  customer_id uuid references public.customers(id),
  supplier_id uuid references public.suppliers(id),
  invoice_id uuid references public.invoices(id),
  bill_id uuid references public.bills(id),
  issue_date date not null default current_date,
  currency char(3) not null default 'GHS',
  fx_rate numeric(20,10) not null default 1 check (fx_rate > 0),
  status text not null default 'draft' check (status in ('draft','issued')),
  subtotal numeric(20,4) not null default 0, tax_total numeric(20,4) not null default 0, total numeric(20,4) not null default 0,
  journal_id uuid references public.journals(id),
  reason text,
  created_at timestamptz not null default now(),
  check ((kind = 'sales' and customer_id is not null and supplier_id is null) or (kind = 'purchase' and supplier_id is not null and customer_id is null))
);
create table public.credit_note_lines (
  id uuid primary key default gen_random_uuid(),
  credit_note_id uuid not null references public.credit_notes(id) on delete cascade,
  description text not null,
  quantity numeric(18,4) not null default 1 check (quantity > 0),
  unit_price numeric(20,4) not null check (unit_price >= 0),
  tax_rate numeric(7,4) not null default 0 check (tax_rate >= 0),
  account_id uuid not null references public.accounts(id),
  cost_centre_id uuid references public.cost_centres(id),
  line_total numeric(20,4) generated always as (round(quantity * unit_price, 2)) stored
);
-- credits (credit notes, customer deposits) applied against an invoice or a bill
create table public.document_credits (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references public.invoices(id),
  bill_id uuid references public.bills(id),
  kind text not null check (kind in ('credit_note','deposit')),
  ref_id uuid not null,
  amount numeric(20,4) not null check (amount > 0),
  credit_date date not null,
  created_at timestamptz not null default now(),
  check ((invoice_id is not null) <> (bill_id is not null))
);
create index dc_invoice_idx on public.document_credits (invoice_id); create index dc_bill_idx on public.document_credits (bill_id); create index dc_ref_idx on public.document_credits (ref_id);

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id),
  line_date date not null,
  description text, reference text,
  amount numeric(20,4) not null,            -- positive = money in, negative = money out
  matched_line_id uuid unique references public.journal_lines(id),
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  import_batch text,
  created_at timestamptz not null default now()
);
create table public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id),
  statement_date date not null,
  statement_balance numeric(20,4) not null,
  book_balance numeric(20,4) not null,
  difference numeric(20,4) not null,
  status text not null default 'completed',
  completed_by uuid default auth.uid(),
  completed_at timestamptz not null default now()
);

-- -------------------------------------------------- immutability of documents
create or replace function public.doc_lines_guard() returns trigger language plpgsql as $$
declare st text; pid uuid;
begin
  if tg_table_name = 'invoice_lines' then
    pid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
    select status into st from public.invoices where id = pid;
  else
    pid := case when tg_op = 'DELETE' then old.bill_id else new.bill_id end;
    select status into st from public.bills where id = pid;
  end if;
  if st is not null and st <> 'draft' then raise exception 'Document is % - its lines cannot be changed', st; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_il_guard before insert or update or delete on public.invoice_lines for each row execute function public.doc_lines_guard();
create trigger trg_bl_guard before insert or update or delete on public.bill_lines for each row execute function public.doc_lines_guard();

create or replace function public.doc_header_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception '% % cannot be deleted; void it instead', tg_table_name, old.number; end if;
    return old;
  end if;
  if old.status <> 'draft' then
    if current_setting('fms.doc_internal', true) = 'on' then return new; end if;
    raise exception '% % is % and cannot be edited', tg_table_name, old.number, old.status;
  end if;
  return new;
end $$;
create trigger trg_inv_guard before update or delete on public.invoices for each row execute function public.doc_header_guard();
create trigger trg_bill_guard before update or delete on public.bills for each row execute function public.doc_header_guard();

create or replace function public.payments_immutable() returns trigger language plpgsql as $$
begin
  if current_setting('fms.doc_internal', true) = 'on' and tg_op = 'UPDATE' then return new; end if;
  raise exception 'Payments are immutable; reverse the payment journal instead';
end $$;
create trigger trg_pay_immutable before update or delete on public.payments for each row execute function public.payments_immutable();
create trigger trg_alloc_immutable before update or delete on public.payment_allocations for each row execute function public.payments_immutable();
create trigger trg_dc_immutable before update or delete on public.document_credits for each row execute function public.payments_immutable();
create or replace function public.credit_note_guard() returns trigger language plpgsql as $$
declare st text;
begin
  if tg_table_name = 'credit_note_lines' then
    select status into st from public.credit_notes where id = coalesce(new.credit_note_id, old.credit_note_id);
    if st is not null and st <> 'draft' then raise exception 'Credit note is issued; its lines cannot be changed'; end if;
  else
    if tg_op = 'DELETE' then if old.status <> 'draft' then raise exception 'Issued credit notes cannot be deleted'; end if; return old; end if;
    if old.status <> 'draft' and current_setting('fms.doc_internal', true) <> 'on' then raise exception 'Credit note % is issued and cannot be edited', old.number; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_cnl_guard before insert or update or delete on public.credit_note_lines for each row execute function public.credit_note_guard();
create trigger trg_cn_guard before update or delete on public.credit_notes for each row execute function public.credit_note_guard();

-- Extension point: company-specific rules (e.g. credit limits) replace this no-op in later migrations.
create or replace function public.invoice_hook_before_issue(p_customer uuid, p_total numeric, p_currency char) returns void language plpgsql as $$
begin return; end $$;

-- ----------------------------------------------------------------- issuing
create or replace function public.issue_invoice(p_id uuid) returns uuid language plpgsql as $$
declare inv public.invoices; sub numeric; tax numeric; tot numeric; lines jsonb; jid uuid; rate numeric; ar uuid; vat uuid; n int;
begin
  select * into inv from public.invoices where id = p_id for update;
  if inv.id is null then raise exception 'Invoice not found'; end if;
  if inv.status <> 'draft' then raise exception 'Invoice % is already %', inv.number, inv.status; end if;
  select count(*), coalesce(sum(line_total),0), coalesce(sum(round(line_total * tax_rate / 100, 2)),0)
    into n, sub, tax from public.invoice_lines where invoice_id = p_id;
  if n = 0 then raise exception 'Invoice has no lines'; end if;
  tot := sub + tax;
  perform public.invoice_hook_before_issue(inv.customer_id, tot, inv.currency);
  ar := public.map_account('AR');
  rate := case when inv.currency = public.base_currency() then 1 else inv.fx_rate end;
  select jsonb_agg(x) into lines from (
    select jsonb_build_object('account_id', ar, 'debit', tot, 'description', 'Invoice ' || inv.number) as x
    union all
    select jsonb_build_object('account_id', revenue_account_id, 'cost_centre_id', cost_centre_id, 'credit', sum(line_total), 'description', 'Invoice ' || inv.number)
      from public.invoice_lines where invoice_id = p_id group by revenue_account_id, cost_centre_id
    union all
    select jsonb_build_object('account_id', public.map_account('VAT_OUTPUT'), 'credit', tax, 'description', 'Output tax ' || inv.number) where tax > 0
  ) s;
  jid := public.create_journal(inv.issue_date, 'Invoice ' || inv.number, lines, inv.number, inv.currency, rate, true, 'invoice', inv.id);
  perform set_config('fms.doc_internal', 'on', true);
  update public.invoices set status = 'issued', subtotal = sub, tax_total = tax, total = tot, journal_id = jid where id = p_id;
  perform set_config('fms.doc_internal', 'off', true);
  return jid;
end $$;

create or replace function public.approve_bill(p_id uuid) returns uuid language plpgsql as $$
declare b public.bills; sub numeric; tax numeric; tot numeric; lines jsonb; jid uuid; rate numeric; n int; ret numeric := 0;
begin
  select * into b from public.bills where id = p_id for update;
  if b.id is null then raise exception 'Bill not found'; end if;
  if b.status <> 'draft' then raise exception 'Bill % is already %', b.number, b.status; end if;
  select count(*), coalesce(sum(line_total),0), coalesce(sum(round(line_total * tax_rate / 100, 2)),0)
    into n, sub, tax from public.bill_lines where bill_id = p_id;
  if n = 0 then raise exception 'Bill has no lines'; end if;
  tot := sub + tax;
  ret := round(tot * b.retention_pct / 100, 2);
  rate := case when b.currency = public.base_currency() then 1 else b.fx_rate end;
  select jsonb_agg(x) into lines from (
    select jsonb_build_object('account_id', expense_account_id, 'cost_centre_id', cost_centre_id, 'debit', sum(line_total), 'description', 'Bill ' || b.number) as x
      from public.bill_lines where bill_id = p_id group by expense_account_id, cost_centre_id
    union all
    select jsonb_build_object('account_id', public.map_account('VAT_INPUT'), 'debit', tax, 'description', 'Input tax ' || b.number) where tax > 0
    union all
    select jsonb_build_object('account_id', public.map_account('AP'), 'credit', tot - ret, 'description', 'Bill ' || b.number) where tot - ret > 0
    union all
    select jsonb_build_object('account_id', public.map_account('RETENTION_PAYABLE'), 'credit', ret, 'description', 'Retention held ' || b.number) where ret > 0
  ) s;
  jid := public.create_journal(b.issue_date, 'Bill ' || b.number, lines, b.number, b.currency, rate, true, 'bill', b.id);
  perform set_config('fms.doc_internal', 'on', true);
  update public.bills set status = 'approved', subtotal = sub, tax_total = tax, total = tot, retention_amount = ret, journal_id = jid where id = p_id;
  perform set_config('fms.doc_internal', 'off', true);
  return jid;
end $$;

create or replace function public.invoice_paid(p_invoice uuid) returns numeric language sql stable as $$
  select coalesce((select sum(amount) from public.payment_allocations where invoice_id = p_invoice), 0) + coalesce((select sum(amount) from public.document_credits where invoice_id = p_invoice), 0) $$;
create or replace function public.bill_paid(p_bill uuid) returns numeric language sql stable as $$
  select coalesce((select sum(amount) from public.payment_allocations where bill_id = p_bill), 0) + coalesce((select sum(amount) from public.document_credits where bill_id = p_bill), 0) $$;
create or replace function public.bill_open(p_bill uuid) returns numeric language sql stable as $$
  select b.total - case when b.retention_released then 0 else b.retention_amount end - public.bill_paid(b.id) from public.bills b where b.id = p_bill $$;

-- Records a customer receipt (direction in) or supplier payment (out), allocates it, books realised FX and withholding tax.
-- p_amount is the GROSS amount settled; p_withholding (>= 0) is withheld tax, so cash moved = p_amount - p_withholding.
-- p_allocations: [{"invoice_id": "...", "amount": 100}] or [{"bill_id": ...}]. Document currency must equal payment currency.
create or replace function public.record_payment(
  p_direction text, p_party uuid, p_date date, p_amount numeric, p_currency char,
  p_bank_account uuid, p_allocations jsonb, p_method text default 'bank', p_reference text default null, p_fx_rate numeric default null, p_withholding numeric default 0
) returns uuid language plpgsql as $$
declare
  base char(3) := public.base_currency(); prate numeric; pid uuid; a jsonb; alloc_total numeric := 0; wht numeric := coalesce(p_withholding, 0);
  doc_cur char(3); doc_rate numeric; doc_open numeric; amt numeric; lines jsonb := '[]'::jsonb; fx numeric := 0;
  bank_acct uuid; ctrl uuid; jid uuid; bank_cur char(3); basegross numeric; basewht numeric; basebank numeric; basectrl numeric := 0;
begin
  if wht < 0 or wht >= p_amount then raise exception 'Withholding must be between zero and the amount settled'; end if;
  select account_id, currency into bank_acct, bank_cur from public.bank_accounts where id = p_bank_account;
  if bank_acct is null then raise exception 'Bank account not found'; end if;
  if bank_cur <> p_currency then raise exception 'Bank account currency % differs from payment currency %', bank_cur, p_currency; end if;
  prate := case when p_currency = base then 1 else coalesce(p_fx_rate, public.get_fx_rate(p_currency, base, p_date)) end;
  ctrl := public.map_account(case when p_direction = 'in' then 'AR' else 'AP' end);
  if p_direction = 'in' then
    insert into public.payments(direction, customer_id, payment_date, amount, currency, fx_rate, bank_account_id, method, reference, withholding)
    values ('in', p_party, p_date, p_amount, p_currency, prate, p_bank_account, p_method, p_reference, wht) returning id into pid;
  else
    insert into public.payments(direction, supplier_id, payment_date, amount, currency, fx_rate, bank_account_id, method, reference, withholding)
    values ('out', p_party, p_date, p_amount, p_currency, prate, p_bank_account, p_method, p_reference, wht) returning id into pid;
  end if;
  basegross := round(p_amount * prate, 2); basewht := round(wht * prate, 2); basebank := basegross - basewht;
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    amt := (a->>'amount')::numeric;
    if p_direction = 'in' then
      select currency, case when currency = base then 1 else fx_rate end, total - public.invoice_paid(id)
        into doc_cur, doc_rate, doc_open from public.invoices
       where id = (a->>'invoice_id')::uuid and customer_id = p_party and status = 'issued' for update;
    else
      select currency, case when currency = base then 1 else fx_rate end, public.bill_open(id)
        into doc_cur, doc_rate, doc_open from public.bills
       where id = (a->>'bill_id')::uuid and supplier_id = p_party and status = 'approved' for update;
    end if;
    if doc_cur is null then raise exception 'Allocation target not found, not open, or belongs to another party'; end if;
    if doc_cur <> p_currency then raise exception 'Allocation currency % differs from payment currency %', doc_cur, p_currency; end if;
    if amt > doc_open then raise exception 'Allocation % exceeds the open balance %', amt, doc_open; end if;
    insert into public.payment_allocations(payment_id, invoice_id, bill_id, amount)
    values (pid, nullif(a->>'invoice_id','')::uuid, nullif(a->>'bill_id','')::uuid, amt);
    alloc_total := alloc_total + amt;
    basectrl := basectrl + round(amt * doc_rate, 2);
  end loop;
  if alloc_total > p_amount then raise exception 'Allocations % exceed the payment amount %', alloc_total, p_amount; end if;
  -- unapplied remainder stays on the control account at the payment rate (customer credit / supplier advance)
  basectrl := basectrl + round((p_amount - alloc_total) * prate, 2);
  fx := basegross - basectrl;
  if p_direction = 'in' then
    lines := jsonb_build_array(
      jsonb_build_object('account_id', bank_acct, 'debit', p_amount - wht, 'base_debit', basebank, 'description', 'Receipt ' || coalesce(p_reference,'')),
      jsonb_build_object('account_id', ctrl, 'credit', p_amount, 'base_credit', basectrl, 'description', 'Receipt applied'));
    if wht > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('WHT_RECEIVABLE'), 'debit', wht, 'base_debit', basewht, 'description', 'Tax withheld by customer'); end if;
    if fx > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FX_GAIN_LOSS'), 'base_credit', fx, 'description', 'Realised FX gain');
    elsif fx < 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FX_GAIN_LOSS'), 'base_debit', -fx, 'description', 'Realised FX loss'); end if;
  else
    lines := jsonb_build_array(
      jsonb_build_object('account_id', ctrl, 'debit', p_amount, 'base_debit', basectrl, 'description', 'Supplier payment applied'),
      jsonb_build_object('account_id', bank_acct, 'credit', p_amount - wht, 'base_credit', basebank, 'description', 'Payment ' || coalesce(p_reference,'')));
    if wht > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('WHT_PAYABLE'), 'credit', wht, 'base_credit', basewht, 'description', 'Tax withheld from supplier'); end if;
    -- paying more base currency than the book liability is a loss; less is a gain
    if fx > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FX_GAIN_LOSS'), 'base_debit', fx, 'description', 'Realised FX loss');
    elsif fx < 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FX_GAIN_LOSS'), 'base_credit', -fx, 'description', 'Realised FX gain'); end if;
  end if;
  jid := public.create_journal(p_date, case when p_direction = 'in' then 'Customer receipt ' else 'Supplier payment ' end || coalesce(p_reference, ''), lines,
           p_reference, p_currency, prate, true, 'payment', pid);
  perform set_config('fms.doc_internal', 'on', true);
  update public.payments set journal_id = jid where id = pid;
  perform set_config('fms.doc_internal', 'off', true);
  return pid;
end $$;

-- ------------------------------------------------------------------ aging
create or replace function public.rpt_ar_aging(p_as_of date)
returns table(customer text, current_amt numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over_90 numeric, total numeric)
language sql stable as $$
  with open_inv as (
    select i.customer_id, round((i.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
            where a.invoice_id = i.id and p.payment_date <= p_as_of),0) - coalesce((select sum(dc.amount) from public.document_credits dc where dc.invoice_id = i.id and dc.credit_date <= p_as_of),0)) * case when i.currency = public.base_currency() then 1 else i.fx_rate end, 2) as open_amt,
           (p_as_of - i.due_date) as days_over
    from public.invoices i where i.status = 'issued' and i.issue_date <= p_as_of),
  unapplied as (
    select p.customer_id, -(p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id),0)) * p.fx_rate as open_amt, 0 as days_over
    from public.payments p where p.direction = 'in' and p.payment_date <= p_as_of),
  unapplied_cn as (
    select cn.customer_id, -(cn.total - coalesce((select sum(dc.amount) from public.document_credits dc where dc.kind = 'credit_note' and dc.ref_id = cn.id and dc.credit_date <= p_as_of),0)) * case when cn.currency = public.base_currency() then 1 else cn.fx_rate end as open_amt, 0 as days_over
    from public.credit_notes cn where cn.kind = 'sales' and cn.status = 'issued' and cn.issue_date <= p_as_of),
  u as (select * from open_inv union all select * from unapplied union all select * from unapplied_cn)
  select c.name,
    coalesce(sum(open_amt) filter (where days_over <= 0),0), coalesce(sum(open_amt) filter (where days_over between 1 and 30),0),
    coalesce(sum(open_amt) filter (where days_over between 31 and 60),0), coalesce(sum(open_amt) filter (where days_over between 61 and 90),0),
    coalesce(sum(open_amt) filter (where days_over > 90),0), coalesce(sum(open_amt),0)
  from u join public.customers c on c.id = u.customer_id group by c.name having sum(open_amt) <> 0 order by c.name
$$;

create or replace function public.rpt_ap_aging(p_as_of date)
returns table(supplier text, current_amt numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, over_90 numeric, total numeric)
language sql stable as $$
  with open_b as (
    select b.supplier_id, round((b.total - case when b.retention_released then 0 else b.retention_amount end - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
            where a.bill_id = b.id and p.payment_date <= p_as_of),0) - coalesce((select sum(dc.amount) from public.document_credits dc where dc.bill_id = b.id and dc.credit_date <= p_as_of),0)) * case when b.currency = public.base_currency() then 1 else b.fx_rate end, 2) as open_amt,
           (p_as_of - b.due_date) as days_over
    from public.bills b where b.status = 'approved' and b.issue_date <= p_as_of),
  unapplied as (
    select p.supplier_id, -(p.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = p.id),0)) * p.fx_rate as open_amt, 0 as days_over
    from public.payments p where p.direction = 'out' and p.payment_date <= p_as_of),
  unapplied_cn as (
    select cn.supplier_id, -(cn.total - coalesce((select sum(dc.amount) from public.document_credits dc where dc.kind = 'credit_note' and dc.ref_id = cn.id and dc.credit_date <= p_as_of),0)) * case when cn.currency = public.base_currency() then 1 else cn.fx_rate end as open_amt, 0 as days_over
    from public.credit_notes cn where cn.kind = 'purchase' and cn.status = 'issued' and cn.issue_date <= p_as_of),
  u as (select * from open_b union all select * from unapplied union all select * from unapplied_cn)
  select s.name,
    coalesce(sum(open_amt) filter (where days_over <= 0),0), coalesce(sum(open_amt) filter (where days_over between 1 and 30),0),
    coalesce(sum(open_amt) filter (where days_over between 31 and 60),0), coalesce(sum(open_amt) filter (where days_over between 61 and 90),0),
    coalesce(sum(open_amt) filter (where days_over > 90),0), coalesce(sum(open_amt),0)
  from u join public.suppliers s on s.id = u.supplier_id group by s.name having sum(open_amt) <> 0 order by s.name
$$;

-- ------------------------------------------------------------- reconciliation
create or replace function public.match_statement_line(p_stmt uuid, p_journal_line uuid) returns void language plpgsql as $$
declare s public.bank_statement_lines; l public.journal_lines; ba public.bank_accounts; net numeric;
begin
  select * into s from public.bank_statement_lines where id = p_stmt for update;
  select * into l from public.journal_lines where id = p_journal_line;
  select * into ba from public.bank_accounts where id = s.bank_account_id;
  if s.id is null or l.id is null then raise exception 'Statement line or journal line not found'; end if;
  if s.status = 'matched' then raise exception 'Statement line is already matched'; end if;
  if l.account_id <> ba.account_id then raise exception 'Journal line belongs to a different account'; end if;
  net := l.debit - l.credit;
  if net <> s.amount then raise exception 'Amounts differ: statement % vs ledger %', s.amount, net; end if;
  update public.bank_statement_lines set matched_line_id = p_journal_line, status = 'matched' where id = p_stmt;
end $$;

create or replace function public.unmatch_statement_line(p_stmt uuid) returns void language sql as $$
  update public.bank_statement_lines set matched_line_id = null, status = 'unmatched' where id = p_stmt $$;

create or replace function public.rpt_bank_reconciliation(p_bank uuid, p_as_of date, p_statement_balance numeric)
returns table(section text, item_date date, description text, amount numeric)
language plpgsql stable as $$
declare ba public.bank_accounts; book numeric; uncleared numeric; diff numeric;
begin
  select * into ba from public.bank_accounts where id = p_bank;
  select coalesce(sum(l.debit - l.credit),0) into book from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
   join public.journals j2 on j2.id = l.journal_id and (j2.currency = ba.currency)
   where l.account_id = ba.account_id and j.entry_date <= p_as_of;
  select coalesce(sum(l.debit - l.credit),0) into uncleared from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed') and j.currency = ba.currency
   where l.account_id = ba.account_id and j.entry_date <= p_as_of
     and not exists (select 1 from public.bank_statement_lines s where s.matched_line_id = l.id);
  diff := p_statement_balance - (book - uncleared);
  return query select 'summary', p_as_of, 'Statement balance', p_statement_balance;
  return query select 'summary', p_as_of, 'Book balance (ledger)', book;
  return query select 'summary', p_as_of, 'Uncleared ledger items (not on statement)', uncleared;
  return query select 'summary', p_as_of, 'Unexplained difference (statement - (book - uncleared))', diff;
  return query select 'uncleared_ledger', j.entry_date, coalesce(l.description, j.description), l.debit - l.credit
    from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed') and j.currency = ba.currency
    where l.account_id = ba.account_id and j.entry_date <= p_as_of and not exists (select 1 from public.bank_statement_lines s where s.matched_line_id = l.id) order by j.entry_date;
  return query select 'unmatched_statement', s.line_date, s.description, s.amount from public.bank_statement_lines s
    where s.bank_account_id = p_bank and s.status = 'unmatched' and s.line_date <= p_as_of order by s.line_date;
end $$;

create or replace function public.complete_reconciliation(p_bank uuid, p_as_of date, p_statement_balance numeric) returns uuid language plpgsql as $$
declare diff numeric; rid uuid; book numeric;
begin
  select amount into diff from public.rpt_bank_reconciliation(p_bank, p_as_of, p_statement_balance) where description like 'Unexplained%';
  select amount into book from public.rpt_bank_reconciliation(p_bank, p_as_of, p_statement_balance) where description like 'Book balance%';
  if diff <> 0 then raise exception 'Cannot complete reconciliation: unexplained difference %', diff; end if;
  insert into public.bank_reconciliations(bank_account_id, statement_date, statement_balance, book_balance, difference)
  values (p_bank, p_as_of, p_statement_balance, book, diff) returning id into rid;
  return rid;
end $$;

select public._secure_tables(array['customers','suppliers','invoices','invoice_lines','bills','bill_lines','bank_accounts','payments','payment_allocations','bank_statement_lines','bank_reconciliations','credit_notes','credit_note_lines','document_credits']);
select public._audit_tables(array['customers','suppliers','invoices','invoice_lines','bills','bill_lines','bank_accounts','payments','payment_allocations','bank_statement_lines','bank_reconciliations','credit_notes','credit_note_lines','document_credits']);

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
