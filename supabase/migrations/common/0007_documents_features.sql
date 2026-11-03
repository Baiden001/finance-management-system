-- 0007: credit notes, voids, retention, recurring entries, opening balances, year-end close, VAT and withholding-tax schedules.

create or replace function public.issue_credit_note(p_id uuid) returns uuid language plpgsql as $$
declare cn public.credit_notes; sub numeric; tax numeric; tot numeric; lines jsonb; jid uuid; rate numeric; n int; tcur char(3); topen numeric;
begin
  select * into cn from public.credit_notes where id = p_id for update;
  if cn.id is null then raise exception 'Credit note not found'; end if;
  if cn.status <> 'draft' then raise exception 'Credit note % is already issued', cn.number; end if;
  select count(*), coalesce(sum(line_total),0), coalesce(sum(round(line_total * tax_rate / 100, 2)),0) into n, sub, tax from public.credit_note_lines where credit_note_id = p_id;
  if n = 0 then raise exception 'Credit note has no lines'; end if;
  tot := sub + tax;
  rate := case when cn.currency = public.base_currency() then 1 else cn.fx_rate end;
  if cn.invoice_id is not null then
    select currency, total - public.invoice_paid(id) into tcur, topen from public.invoices where id = cn.invoice_id and status = 'issued';
  elsif cn.bill_id is not null then
    select currency, public.bill_open(id) into tcur, topen from public.bills where id = cn.bill_id and status = 'approved';
  end if;
  if (cn.invoice_id is not null or cn.bill_id is not null) then
    if tcur is null then raise exception 'The referenced document is not open'; end if;
    if tcur <> cn.currency then raise exception 'Credit note currency % differs from document currency %', cn.currency, tcur; end if;
    if tot > topen then raise exception 'Credit % exceeds the open balance % of the document', tot, topen; end if;
  end if;
  if cn.kind = 'sales' then
    select jsonb_agg(x) into lines from (
      select jsonb_build_object('account_id', account_id, 'cost_centre_id', cost_centre_id, 'debit', sum(line_total), 'description', 'Credit note ' || cn.number) x
        from public.credit_note_lines where credit_note_id = p_id group by account_id, cost_centre_id
      union all select jsonb_build_object('account_id', public.map_account('VAT_OUTPUT'), 'debit', tax, 'description', 'Output tax reversed ' || cn.number) where tax > 0
      union all select jsonb_build_object('account_id', public.map_account('AR'), 'credit', tot, 'description', 'Credit note ' || cn.number)) s;
  else
    select jsonb_agg(x) into lines from (
      select jsonb_build_object('account_id', public.map_account('AP'), 'debit', tot, 'description', 'Debit note ' || cn.number) x
      union all select jsonb_build_object('account_id', account_id, 'cost_centre_id', cost_centre_id, 'credit', sum(line_total), 'description', 'Debit note ' || cn.number)
        from public.credit_note_lines where credit_note_id = p_id group by account_id, cost_centre_id
      union all select jsonb_build_object('account_id', public.map_account('VAT_INPUT'), 'credit', tax, 'description', 'Input tax reversed ' || cn.number) where tax > 0) s;
  end if;
  jid := public.create_journal(cn.issue_date, case when cn.kind = 'sales' then 'Credit note ' else 'Supplier debit note ' end || cn.number, lines, cn.number, cn.currency, rate, true, 'credit_note', cn.id);
  perform set_config('fms.doc_internal', 'on', true);
  update public.credit_notes set status = 'issued', subtotal = sub, tax_total = tax, total = tot, journal_id = jid where id = p_id;
  perform set_config('fms.doc_internal', 'off', true);
  if cn.invoice_id is not null then insert into public.document_credits(invoice_id, kind, ref_id, amount, credit_date) values (cn.invoice_id, 'credit_note', cn.id, tot, cn.issue_date);
  elsif cn.bill_id is not null then insert into public.document_credits(bill_id, kind, ref_id, amount, credit_date) values (cn.bill_id, 'credit_note', cn.id, tot, cn.issue_date); end if;
  return jid;
end $$;

-- Apply an issued credit note that is not yet (fully) applied to another open invoice (sales) or bill (purchase)
create or replace function public.apply_credit_note(p_cn uuid, p_document uuid, p_amount numeric, p_date date default current_date) returns void language plpgsql as $$
declare cn public.credit_notes; remaining numeric; tcur char(3); topen numeric;
begin
  select * into cn from public.credit_notes where id = p_cn for update;
  if cn.id is null or cn.status <> 'issued' then raise exception 'Credit note not found or not issued'; end if;
  select cn.total - coalesce(sum(amount), 0) into remaining from public.document_credits where kind = 'credit_note' and ref_id = p_cn;
  if p_amount <= 0 or p_amount > remaining then raise exception 'Amount must be between 0 and the unapplied balance %', remaining; end if;
  if cn.kind = 'sales' then
    select currency, total - public.invoice_paid(id) into tcur, topen from public.invoices where id = p_document and customer_id = cn.customer_id and status = 'issued';
  else
    select currency, public.bill_open(id) into tcur, topen from public.bills where id = p_document and supplier_id = cn.supplier_id and status = 'approved';
  end if;
  if tcur is null then raise exception 'Target document not found or not open for this party'; end if;
  if tcur <> cn.currency then raise exception 'Currency mismatch'; end if;
  if p_amount > topen then raise exception 'Amount exceeds the open balance %', topen; end if;
  if cn.kind = 'sales' then insert into public.document_credits(invoice_id, kind, ref_id, amount, credit_date) values (p_document, 'credit_note', p_cn, p_amount, p_date);
  else insert into public.document_credits(bill_id, kind, ref_id, amount, credit_date) values (p_document, 'credit_note', p_cn, p_amount, p_date); end if;
end $$;

-- Convenience: credit an invoice (or debit-note a bill) for an amount excluding tax; tax is credited pro rata.
create or replace function public.credit_invoice(p_invoice uuid, p_amount numeric, p_reason text, p_date date default current_date) returns uuid language plpgsql as $$
declare inv public.invoices; acc uuid; cc uuid; rate numeric; cid uuid;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.status <> 'issued' then raise exception 'Only an issued invoice can be credited'; end if;
  if p_amount <= 0 then raise exception 'Credit amount must be positive'; end if;
  rate := case when inv.subtotal > 0 then round(inv.tax_total / inv.subtotal * 100, 4) else 0 end;
  select revenue_account_id, cost_centre_id into acc, cc from public.invoice_lines where invoice_id = p_invoice order by line_total desc limit 1;
  insert into public.credit_notes(kind, customer_id, invoice_id, issue_date, currency, fx_rate, reason) values ('sales', inv.customer_id, p_invoice, p_date, inv.currency, inv.fx_rate, p_reason) returning id into cid;
  insert into public.credit_note_lines(credit_note_id, description, quantity, unit_price, tax_rate, account_id, cost_centre_id) values (cid, 'Credit against ' || inv.number || ': ' || coalesce(p_reason, ''), 1, p_amount, rate, acc, cc);
  perform public.issue_credit_note(cid);
  return cid;
end $$;

create or replace function public.credit_bill(p_bill uuid, p_amount numeric, p_reason text, p_date date default current_date) returns uuid language plpgsql as $$
declare b public.bills; acc uuid; cc uuid; rate numeric; cid uuid;
begin
  select * into b from public.bills where id = p_bill;
  if b.id is null or b.status <> 'approved' then raise exception 'Only an approved bill can be debit-noted'; end if;
  if p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  rate := case when b.subtotal > 0 then round(b.tax_total / b.subtotal * 100, 4) else 0 end;
  select expense_account_id, cost_centre_id into acc, cc from public.bill_lines where bill_id = p_bill order by line_total desc limit 1;
  insert into public.credit_notes(kind, supplier_id, bill_id, issue_date, currency, fx_rate, reason) values ('purchase', b.supplier_id, p_bill, p_date, b.currency, b.fx_rate, p_reason) returning id into cid;
  insert into public.credit_note_lines(credit_note_id, description, quantity, unit_price, tax_rate, account_id, cost_centre_id) values (cid, 'Debit note against ' || b.number || ': ' || coalesce(p_reason, ''), 1, p_amount, rate, acc, cc);
  perform public.issue_credit_note(cid);
  return cid;
end $$;

-- Void an issued, unsettled document: reverses its journal (traceable) and marks it void.
create or replace function public.void_invoice(p_id uuid, p_reason text, p_date date default current_date) returns uuid language plpgsql as $$
declare inv public.invoices; rid uuid;
begin
  select * into inv from public.invoices where id = p_id for update;
  if inv.id is null or inv.status <> 'issued' then raise exception 'Only an issued invoice can be voided'; end if;
  if public.invoice_paid(p_id) > 0 then raise exception 'Invoice % has receipts or credits applied; issue a credit note instead', inv.number; end if;
  if to_jsonb(inv) ->> 'cogs_journal_id' is not null then raise exception 'Cost of sales was posted for this invoice; process a sales return instead'; end if;
  rid := public.reverse_journal(inv.journal_id, p_date, 'Void ' || inv.number || ': ' || p_reason);
  perform set_config('fms.doc_internal', 'on', true);
  update public.invoices set status = 'void' where id = p_id;
  perform set_config('fms.doc_internal', 'off', true);
  return rid;
end $$;

create or replace function public.void_bill(p_id uuid, p_reason text, p_date date default current_date) returns uuid language plpgsql as $$
declare b public.bills; rid uuid;
begin
  select * into b from public.bills where id = p_id for update;
  if b.id is null or b.status <> 'approved' then raise exception 'Only an approved bill can be voided'; end if;
  if public.bill_paid(p_id) > 0 then raise exception 'Bill % has payments or credits applied; issue a debit note instead', b.number; end if;
  if b.retention_released then raise exception 'Retention on this bill was already released; issue a debit note instead'; end if;
  rid := public.reverse_journal(b.journal_id, p_date, 'Void ' || b.number || ': ' || p_reason);
  perform set_config('fms.doc_internal', 'on', true);
  update public.bills set status = 'void' where id = p_id;
  perform set_config('fms.doc_internal', 'off', true);
  return rid;
end $$;

-- Retention held on a contractor bill becomes payable when released
create or replace function public.release_retention(p_bill uuid, p_date date default current_date) returns uuid language plpgsql as $$
declare b public.bills; jid uuid;
begin
  select * into b from public.bills where id = p_bill for update;
  if b.id is null or b.status <> 'approved' then raise exception 'Bill not found or not approved'; end if;
  if b.retention_amount <= 0 or b.retention_released then raise exception 'No unreleased retention on this bill'; end if;
  jid := public.create_journal(p_date, 'Release retention ' || b.number,
    jsonb_build_array(jsonb_build_object('account_id', public.map_account('RETENTION_PAYABLE'), 'debit', b.retention_amount),
                      jsonb_build_object('account_id', public.map_account('AP'), 'credit', b.retention_amount)), b.number, b.currency, case when b.currency = public.base_currency() then 1 else b.fx_rate end, true, 'retention', b.id);
  perform set_config('fms.doc_internal', 'on', true);
  update public.bills set retention_released = true where id = p_bill;
  perform set_config('fms.doc_internal', 'off', true);
  return jid;
end $$;

-- ------------------------------------------------------------ recurring entries
create table public.recurring_journals (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text not null,
  frequency text not null check (frequency in ('monthly','quarterly','yearly')),
  next_run date not null, end_date date,
  active boolean not null default true,
  lines jsonb not null,
  runs int not null default 0,
  last_journal_id uuid references public.journals(id),
  created_at timestamptz not null default now()
);

create or replace function public.recurring_from_journal(p_journal uuid, p_name text, p_frequency text, p_next_run date, p_end date default null) returns uuid language plpgsql as $$
declare j public.journals; lines jsonb; rid uuid;
begin
  select * into j from public.journals where id = p_journal;
  if j.id is null or j.status not in ('posted','reversed') then raise exception 'Choose a posted journal'; end if;
  if j.currency <> public.base_currency() then raise exception 'Only base-currency journals can be made recurring'; end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'cost_centre_id', cost_centre_id, 'description', description, 'debit', debit, 'credit', credit) order by line_no) into lines
    from public.journal_lines where journal_id = p_journal;
  insert into public.recurring_journals(name, description, frequency, next_run, end_date, lines) values (p_name, j.description, p_frequency, p_next_run, p_end, lines) returning id into rid;
  return rid;
end $$;

create or replace function public.run_recurring(p_as_of date default current_date) returns jsonb language plpgsql as $$
declare r public.recurring_journals; posted int := 0; failed jsonb := '[]'::jsonb; jid uuid; guard int;
begin
  for r in select * from public.recurring_journals where active and next_run <= p_as_of order by next_run, name loop
    guard := 0;
    while r.next_run <= p_as_of and (r.end_date is null or r.next_run <= r.end_date) and guard < 36 loop
      guard := guard + 1;
      begin
        jid := public.create_journal(r.next_run, r.description, r.lines, 'REC-' || r.name, null, null, true, 'recurring', r.id);
        r.next_run := (r.next_run + case r.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end)::date;
        update public.recurring_journals set next_run = r.next_run, runs = runs + 1, last_journal_id = jid where id = r.id;
        posted := posted + 1;
      exception when others then
        failed := failed || jsonb_build_object('name', r.name, 'date', r.next_run, 'error', sqlerrm);
        exit;
      end;
    end loop;
  end loop;
  return jsonb_build_object('posted', posted, 'failed', failed);
end $$;

-- ------------------------------------------------- opening balances, year-end
create or replace function public.post_opening_balances(p_date date, p_lines jsonb, p_plug boolean default false) returns uuid language plpgsql as $$
declare d numeric := 0; c numeric := 0; l jsonb; lines jsonb := p_lines; diff numeric;
begin
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then raise exception 'Enter at least one opening balance'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop d := d + coalesce((l->>'debit')::numeric, 0); c := c + coalesce((l->>'credit')::numeric, 0); end loop;
  diff := d - c;
  if diff <> 0 then
    if not p_plug then raise exception 'Opening balances do not balance (difference %). Tick the option to post the difference to Opening Balance Equity.', diff; end if;
    lines := lines || case when diff > 0 then jsonb_build_object('account_id', public.map_account('OPENING_BALANCE_EQUITY'), 'credit', diff)
                           else jsonb_build_object('account_id', public.map_account('OPENING_BALANCE_EQUITY'), 'debit', -diff) end;
  end if;
  return public.create_journal(p_date, 'Opening balances', lines, 'OPENING', null, null, true, 'opening');
end $$;

-- Closes a fiscal year: refuses if drafts remain, locks every period, marks the year closed, opens the next calendar year.
-- Retained earnings are derived from the ledger, so no closing journal is needed.
create or replace function public.close_fiscal_year(p_fy uuid) returns uuid language plpgsql as $$
declare fy public.fiscal_years; drafts int; bal numeric; nxt uuid;
begin
  select * into fy from public.fiscal_years where id = p_fy for update;
  if fy.id is null then raise exception 'Fiscal year not found'; end if;
  if fy.status = 'closed' then raise exception 'Fiscal year % is already closed', fy.name; end if;
  select count(*) into drafts from public.journals where status = 'draft' and entry_date between fy.start_date and fy.end_date;
  if drafts > 0 then raise exception '% draft journal(s) dated in % must be posted or deleted first', drafts, fy.name; end if;
  select coalesce(sum(l.base_debit - l.base_credit), 0) into bal from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed') where j.entry_date between fy.start_date and fy.end_date;
  if bal <> 0 then raise exception 'Ledger for % is out of balance by %', fy.name, bal; end if;
  update public.fiscal_periods set status = 'locked' where fiscal_year_id = p_fy;
  update public.fiscal_years set status = 'closed' where id = p_fy;
  if fy.start_date = make_date(extract(year from fy.start_date)::int, 1, 1) and fy.end_date = make_date(extract(year from fy.start_date)::int, 12, 31)
     and not exists (select 1 from public.fiscal_years where start_date = fy.end_date + 1) then
    nxt := public.create_fiscal_year(extract(year from fy.start_date)::int + 1);
  end if;
  perform public.audit_event('fiscal_year_closed', jsonb_build_object('fiscal_year', fy.name));
  return nxt;
end $$;

-- ------------------------------------------------------ tax return schedules
create or replace function public.rpt_vat_return(p_from date, p_to date)
returns table(section text, rate numeric, base_amount numeric, tax_amount numeric)
language sql stable as $$
  with s as (
    select 'Output tax - sales' sec, l.tax_rate, sum(l.line_total * case when i.currency = public.base_currency() then 1 else i.fx_rate end) base, sum(round(l.line_total * l.tax_rate / 100, 2) * case when i.currency = public.base_currency() then 1 else i.fx_rate end) tax
    from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where i.status = 'issued' and i.issue_date between p_from and p_to group by l.tax_rate
    union all
    select 'Output tax - sales', l.tax_rate, -sum(l.line_total * case when c.currency = public.base_currency() then 1 else c.fx_rate end), -sum(round(l.line_total * l.tax_rate / 100, 2) * case when c.currency = public.base_currency() then 1 else c.fx_rate end)
    from public.credit_notes c join public.credit_note_lines l on l.credit_note_id = c.id where c.kind = 'sales' and c.status = 'issued' and c.issue_date between p_from and p_to group by l.tax_rate
    union all
    select 'Input tax - purchases', l.tax_rate, sum(l.line_total * case when b.currency = public.base_currency() then 1 else b.fx_rate end), sum(round(l.line_total * l.tax_rate / 100, 2) * case when b.currency = public.base_currency() then 1 else b.fx_rate end)
    from public.bills b join public.bill_lines l on l.bill_id = b.id where b.status = 'approved' and b.issue_date between p_from and p_to group by l.tax_rate
    union all
    select 'Input tax - purchases', l.tax_rate, -sum(l.line_total * case when c.currency = public.base_currency() then 1 else c.fx_rate end), -sum(round(l.line_total * l.tax_rate / 100, 2) * case when c.currency = public.base_currency() then 1 else c.fx_rate end)
    from public.credit_notes c join public.credit_note_lines l on l.credit_note_id = c.id where c.kind = 'purchase' and c.status = 'issued' and c.issue_date between p_from and p_to group by l.tax_rate),
  agg as (select sec, tax_rate, sum(base) base, sum(tax) tax from s group by sec, tax_rate)
  select sec, tax_rate, base, tax from agg
  union all select 'Total output tax', null, null, coalesce((select sum(tax) from agg where sec like 'Output%'), 0)
  union all select 'Total input tax', null, null, coalesce((select sum(tax) from agg where sec like 'Input%'), 0)
  union all select 'Net VAT payable / (refundable)', null, null, coalesce((select sum(tax) from agg where sec like 'Output%'), 0) - coalesce((select sum(tax) from agg where sec like 'Input%'), 0)
  order by 1, 2
$$;

create or replace function public.rpt_wht_schedule(p_from date, p_to date)
returns table(payment_date date, direction text, party text, reference text, gross_amount numeric, tax_withheld numeric, cash_amount numeric)
language sql stable as $$
  select p.payment_date, case when p.direction = 'in' then 'Withheld by customer (receivable)' else 'Withheld from supplier (payable)' end,
         coalesce(c.name, s.name), p.reference, round(p.amount * p.fx_rate, 2), round(p.withholding * p.fx_rate, 2), round((p.amount - p.withholding) * p.fx_rate, 2)
  from public.payments p left join public.customers c on c.id = p.customer_id left join public.suppliers s on s.id = p.supplier_id
  where p.withholding > 0 and p.payment_date between p_from and p_to order by p.payment_date, p.number
$$;

select public._secure_tables(array['recurring_journals']);
select public._audit_tables(array['recurring_journals']);
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
