-- 0002_ledger: chart of accounts, fiscal calendar, FX rates, double-entry journals, posting controls, core reports.

create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  check (end_date > start_date)
);

create table public.fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.fiscal_years(id),
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed','locked')),
  unique (fiscal_year_id, name),
  check (end_date >= start_date)
);
create index fiscal_periods_dates_idx on public.fiscal_periods (start_date, end_date);

create or replace function public.fiscal_periods_no_overlap() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.fiscal_periods p
             where p.id <> new.id and daterange(p.start_date, p.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception 'Fiscal period % overlaps an existing period', new.name;
  end if;
  return new;
end $$;
create trigger trg_period_overlap before insert or update of start_date, end_date on public.fiscal_periods
for each row execute function public.fiscal_periods_no_overlap();

-- locked periods can only be re-opened by an explicit status change (audited); locked is final for posting
create table public.cost_centres (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null default 'general',
  is_active boolean not null default true
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  subtype text,
  cash_flow_category text check (cash_flow_category in ('operating','investing','financing','cash')),
  parent_id uuid references public.accounts(id),
  currency char(3),                       -- null = base currency; set for foreign-currency accounts
  is_bank boolean not null default false,
  allow_posting boolean not null default true,
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.account_mappings (
  key text primary key,
  account_id uuid not null references public.accounts(id)
);

create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  rate_date date not null,
  from_currency char(3) not null,
  to_currency char(3) not null,
  rate numeric(20,10) not null check (rate > 0),
  source text,
  unique (rate_date, from_currency, to_currency)
);

create or replace function public.base_currency() returns char(3) language sql stable as $$
  select base_currency from public.company_settings limit 1 $$;

create or replace function public.get_fx_rate(p_from char, p_to char, p_date date) returns numeric
language plpgsql stable as $$
declare r numeric;
begin
  if p_from = p_to then return 1; end if;
  select rate into r from public.fx_rates where from_currency = p_from and to_currency = p_to and rate_date <= p_date order by rate_date desc limit 1;
  if r is null then raise exception 'No FX rate % -> % on or before %', p_from, p_to, p_date; end if;
  return r;
end $$;

create or replace function public.map_account(p_key text) returns uuid language plpgsql stable as $$
declare a uuid;
begin
  select account_id into a from public.account_mappings where key = p_key;
  if a is null then raise exception 'Account mapping % is not configured', p_key; end if;
  return a;
end $$;

-- ------------------------------------------------------------------ journals
create sequence public.journal_no_seq;

create table public.journals (
  id uuid primary key default gen_random_uuid(),
  journal_no bigint not null unique default nextval('public.journal_no_seq'),
  entry_date date not null,
  period_id uuid references public.fiscal_periods(id),
  description text not null,
  reference text,
  source_type text not null default 'manual',
  source_id uuid,
  currency char(3) not null,
  fx_rate numeric(20,10) not null default 1 check (fx_rate > 0),
  status text not null default 'draft' check (status in ('draft','posted','reversed')),
  reversal_of uuid references public.journals(id),
  reversed_by uuid references public.journals(id),
  reversal_reason text,
  posted_at timestamptz,
  posted_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index journals_date_idx on public.journals (entry_date);
create index journals_source_idx on public.journals (source_type, source_id);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.journals(id) on delete cascade,
  line_no int not null,
  account_id uuid not null references public.accounts(id),
  cost_centre_id uuid references public.cost_centres(id),
  description text,
  debit numeric(20,4) not null default 0 check (debit >= 0),
  credit numeric(20,4) not null default 0 check (credit >= 0),
  base_debit numeric(20,4) not null default 0 check (base_debit >= 0),
  base_credit numeric(20,4) not null default 0 check (base_credit >= 0),
  unique (journal_id, line_no),
  check (not (debit > 0 and credit > 0)),
  check (not (base_debit > 0 and base_credit > 0))
);
create index journal_lines_account_idx on public.journal_lines (account_id);
create index journal_lines_cc_idx on public.journal_lines (cost_centre_id);

create or replace function public.period_for(p_date date) returns public.fiscal_periods language plpgsql stable as $$
declare p public.fiscal_periods;
begin
  select * into p from public.fiscal_periods where p_date between start_date and end_date;
  if p.id is null then raise exception 'No fiscal period covers %', p_date; end if;
  return p;
end $$;

-- lines: derive base amounts, block changes unless parent journal is a draft
create or replace function public.journal_lines_guard() returns trigger language plpgsql as $$
declare j public.journals;
begin
  if tg_op = 'DELETE' then
    select * into j from public.journals where id = old.journal_id;
    if j.id is not null and j.status <> 'draft' then
      raise exception 'Lines of a % journal cannot be deleted; use a reversal', j.status;
    end if;
    return old;
  end if;
  select * into j from public.journals where id = new.journal_id;
  if j.status <> 'draft' then
    raise exception 'Journal % is %; lines are immutable. Use a reversal.', j.journal_no, j.status;
  end if;
  if tg_op = 'UPDATE' and new.journal_id <> old.journal_id then
    raise exception 'A line cannot be moved between journals';
  end if;
  if new.base_debit = 0 and new.base_credit = 0 and (new.debit > 0 or new.credit > 0) then
    new.base_debit := round(new.debit * j.fx_rate, 4);
    new.base_credit := round(new.credit * j.fx_rate, 4);
  end if;
  return new;
end $$;
create trigger trg_journal_lines_guard before insert or update or delete on public.journal_lines
for each row execute function public.journal_lines_guard();

create or replace function public.journals_guard() returns trigger language plpgsql as $$
declare
  n int; td numeric; tc numeric; bd numeric; bc numeric; diff numeric; per public.fiscal_periods; bad text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Journals are created as drafts and posted with post_journal()'; end if;
    new.period_id := (public.period_for(new.entry_date)).id;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Posted journals cannot be deleted; reverse them instead'; end if;
    return old;
  end if;
  -- UPDATE
  if old.status in ('posted','reversed') then
    if old.status = 'posted' and new.status = 'reversed'
       and current_setting('fms.allow_reversal_update', true) = 'on'
       and (to_jsonb(new) - array['status','reversed_by','reversal_reason']::text[]) = (to_jsonb(old) - array['status','reversed_by','reversal_reason']::text[]) then
      return new;
    end if;
    raise exception 'Journal % is % and cannot be modified; use a traceable reversal', old.journal_no, old.status;
  end if;
  if new.status = 'reversed' then raise exception 'Only posted journals can be reversed'; end if;
  if new.status = 'draft' then
    new.period_id := (public.period_for(new.entry_date)).id;
    return new;
  end if;
  -- draft -> posted: validate
  per := public.period_for(new.entry_date);
  if per.status <> 'open' then
    raise exception 'Period % is % - posting rejected', per.name, per.status;
  end if;
  new.period_id := per.id;
  select count(*), coalesce(sum(debit),0), coalesce(sum(credit),0), coalesce(sum(base_debit),0), coalesce(sum(base_credit),0)
    into n, td, tc, bd, bc from public.journal_lines where journal_id = new.id;
  if n < 2 then raise exception 'A journal needs at least two lines'; end if;
  if td <> tc then raise exception 'Journal does not balance: debits % <> credits %', td, tc; end if;
  if td = 0 and bd = 0 then raise exception 'Journal has no amounts'; end if;
  select string_agg(a.code, ', ') into bad from public.journal_lines l join public.accounts a on a.id = l.account_id
   where l.journal_id = new.id and (not a.is_active or not a.allow_posting);
  if bad is not null then raise exception 'Account(s) not available for posting: %', bad; end if;
  diff := bd - bc;
  if diff <> 0 then
    -- tolerate only tiny currency rounding differences, absorbed on the largest line
    if abs(diff) <= 0.05 then
      if diff > 0 then
        update public.journal_lines set base_credit = base_credit + diff
         where id = (select id from public.journal_lines where journal_id = new.id and base_credit > 0 order by base_credit desc limit 1);
      else
        update public.journal_lines set base_debit = base_debit - diff
         where id = (select id from public.journal_lines where journal_id = new.id and base_debit > 0 order by base_debit desc limit 1);
      end if;
    else
      raise exception 'Journal does not balance in base currency: % <> %', bd, bc;
    end if;
  end if;
  new.posted_at := now();
  new.posted_by := auth.uid();
  return new;
end $$;
create trigger trg_journals_guard before insert or update or delete on public.journals
for each row execute function public.journals_guard();

-- the plug above touches lines of a draft journal being posted; allow via journals still 'draft' at that moment (BEFORE trigger)

create or replace function public.post_journal(p_id uuid) returns public.journals language plpgsql as $$
declare j public.journals;
begin
  update public.journals set status = 'posted' where id = p_id and status = 'draft' returning * into j;
  if j.id is null then raise exception 'Journal not found or not a draft'; end if;
  return j;
end $$;

create or replace function public.create_journal(
  p_date date, p_description text, p_lines jsonb,
  p_reference text default null, p_currency char default null, p_fx_rate numeric default null,
  p_post boolean default true, p_source_type text default 'manual', p_source_id uuid default null
) returns uuid language plpgsql as $$
declare
  jid uuid; l jsonb; i int := 0; cur char(3); rate numeric;
begin
  cur := coalesce(p_currency, public.base_currency());
  rate := coalesce(p_fx_rate, public.get_fx_rate(cur, public.base_currency(), p_date));
  if cur = public.base_currency() then rate := 1; end if;
  insert into public.journals(entry_date, description, reference, currency, fx_rate, source_type, source_id)
  values (p_date, p_description, p_reference, cur, rate, p_source_type, p_source_id) returning id into jid;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.journal_lines(journal_id, line_no, account_id, cost_centre_id, description, debit, credit, base_debit, base_credit)
    values (jid, i, (l->>'account_id')::uuid, nullif(l->>'cost_centre_id','')::uuid, l->>'description',
            coalesce((l->>'debit')::numeric,0), coalesce((l->>'credit')::numeric,0),
            coalesce((l->>'base_debit')::numeric,0), coalesce((l->>'base_credit')::numeric,0));
  end loop;
  if p_post then perform public.post_journal(jid); end if;
  return jid;
end $$;

create or replace function public.reverse_journal(p_id uuid, p_date date, p_reason text) returns uuid
language plpgsql as $$
declare j public.journals; rid uuid; lines jsonb;
begin
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reversal reason is required'; end if;
  select * into j from public.journals where id = p_id for update;
  if j.id is null then raise exception 'Journal not found'; end if;
  if j.status <> 'posted' then raise exception 'Only posted, not-yet-reversed journals can be reversed (status: %)', j.status; end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'cost_centre_id', cost_centre_id,
           'description', 'Reversal: ' || coalesce(description,''), 'debit', credit, 'credit', debit,
           'base_debit', base_credit, 'base_credit', base_debit) order by line_no)
    into lines from public.journal_lines where journal_id = p_id;
  rid := public.create_journal(p_date, 'Reversal of JE-' || j.journal_no || ': ' || p_reason, lines,
           'REV-' || j.journal_no, j.currency, j.fx_rate, false, 'reversal', p_id);
  update public.journals set reversal_of = p_id where id = rid;
  perform public.post_journal(rid);
  perform set_config('fms.allow_reversal_update', 'on', true);
  update public.journals set status = 'reversed', reversed_by = rid, reversal_reason = p_reason where id = p_id;
  perform set_config('fms.allow_reversal_update', 'off', true);
  return rid;
end $$;

-- period control: lock / close / reopen (reopen of a locked period is an audited, explicit action)
create or replace function public.set_period_status(p_period uuid, p_status text, p_reason text default null) returns void
language plpgsql as $$
declare old_s text;
begin
  select status into old_s from public.fiscal_periods where id = p_period;
  if old_s = 'locked' and p_status = 'open' and coalesce(trim(p_reason),'') = '' then
    raise exception 'Re-opening a locked period requires a reason';
  end if;
  update public.fiscal_periods set status = p_status where id = p_period;
  perform public.audit_event('period_status', jsonb_build_object('period', p_period, 'from', old_s, 'to', p_status, 'reason', p_reason));
end $$;

-- ------------------------------------------------------------------ reports
-- All amounts are base-currency amounts. Ledger = posted + reversed journals (reversals offset originals).
create or replace function public.rpt_trial_balance(p_from date, p_to date)
returns table(code text, name text, type text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable as $$
  select a.code, a.name, a.type,
    coalesce(sum(case when j.entry_date < p_from then l.base_debit - l.base_credit end),0)::numeric,
    coalesce(sum(case when j.entry_date between p_from and p_to then l.base_debit end),0)::numeric,
    coalesce(sum(case when j.entry_date between p_from and p_to then l.base_credit end),0)::numeric,
    coalesce(sum(case when j.entry_date <= p_to then l.base_debit - l.base_credit end),0)::numeric
  from public.accounts a
  left join public.journal_lines l on l.account_id = a.id
  left join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  group by a.id, a.code, a.name, a.type
  having coalesce(sum(case when j.entry_date <= p_to then l.base_debit + l.base_credit end),0) <> 0
  order by a.code
$$;

create or replace function public.rpt_general_ledger(p_account uuid, p_from date, p_to date)
returns table(entry_date date, journal_no bigint, description text, reference text, debit numeric, credit numeric, balance numeric)
language sql stable as $$
  with opening as (
    select coalesce(sum(l.base_debit - l.base_credit),0) as bal
    from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
    where l.account_id = p_account and j.entry_date < p_from),
  mv as (
    select j.entry_date, j.journal_no, coalesce(l.description, j.description) as description, j.reference,
           l.base_debit as debit, l.base_credit as credit, l.line_no
    from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
    where l.account_id = p_account and j.entry_date between p_from and p_to)
  select p_from, 0::bigint, 'Opening balance'::text, null::text, 0::numeric, 0::numeric, (select bal from opening)
  union all
  select entry_date, journal_no, description, reference, debit, credit,
         (select bal from opening) + sum(debit - credit) over (order by entry_date, journal_no, line_no)
  from mv
  order by 1, 2
$$;

create or replace function public.rpt_income_statement(p_from date, p_to date)
returns table(section text, code text, name text, amount numeric)
language sql stable as $$
  select a.type, a.code, a.name,
    case when a.type = 'income' then sum(l.base_credit - l.base_debit) else sum(l.base_debit - l.base_credit) end
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  join public.accounts a on a.id = l.account_id
  where a.type in ('income','expense') and j.entry_date between p_from and p_to
  group by a.type, a.code, a.name
  having sum(l.base_debit + l.base_credit) <> 0
  order by a.type desc, a.code
$$;

create or replace function public.rpt_balance_sheet(p_as_of date)
returns table(section text, code text, name text, amount numeric)
language sql stable as $$
  select a.type, a.code, a.name,
    case when a.type = 'asset' then sum(l.base_debit - l.base_credit) else sum(l.base_credit - l.base_debit) end
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  join public.accounts a on a.id = l.account_id
  where a.type in ('asset','liability','equity') and j.entry_date <= p_as_of
  group by a.type, a.code, a.name
  having sum(l.base_debit + l.base_credit) <> 0
  union all
  select 'equity', 'RE-DERIVED', 'Retained earnings (cumulative income less expenses)',
    coalesce(sum(l.base_credit - l.base_debit),0)
  from public.journal_lines l
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  join public.accounts a on a.id = l.account_id
  where a.type in ('income','expense') and j.entry_date <= p_as_of
  order by 1, 2
$$;

create or replace function public.rpt_journal_listing(p_from date, p_to date)
returns table(journal_no bigint, entry_date date, status text, source_type text, description text, account_code text, account_name text, debit numeric, credit numeric)
language sql stable as $$
  select j.journal_no, j.entry_date, j.status, j.source_type, j.description, a.code, a.name, l.base_debit, l.base_credit
  from public.journals j join public.journal_lines l on l.journal_id = j.id join public.accounts a on a.id = l.account_id
  where j.entry_date between p_from and p_to and j.status in ('posted','reversed')
  order by j.journal_no, l.line_no
$$;

-- Direct-method cash flow: each non-cash line in a journal that touches cash is classified by its account's category.
create or replace function public.rpt_cash_flow(p_from date, p_to date)
returns table(category text, account_code text, account_name text, amount numeric)
language sql stable as $$
  with cash_journals as (
    select distinct l.journal_id from public.journal_lines l join public.accounts a on a.id = l.account_id
    join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
    where a.cash_flow_category = 'cash' and j.entry_date between p_from and p_to)
  select coalesce(a.cash_flow_category, 'operating'), a.code, a.name, sum(l.base_credit - l.base_debit)
  from public.journal_lines l join public.accounts a on a.id = l.account_id
  where l.journal_id in (select journal_id from cash_journals) and coalesce(a.cash_flow_category,'operating') <> 'cash'
  group by 1, a.code, a.name
  having sum(l.base_credit - l.base_debit) <> 0
  union all
  select 'opening_cash', null, 'Cash and bank at start', coalesce(sum(l.base_debit - l.base_credit),0)
  from public.journal_lines l join public.accounts a on a.id = l.account_id and a.cash_flow_category = 'cash'
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed') where j.entry_date < p_from
  union all
  select 'closing_cash', null, 'Cash and bank at end', coalesce(sum(l.base_debit - l.base_credit),0)
  from public.journal_lines l join public.accounts a on a.id = l.account_id and a.cash_flow_category = 'cash'
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed') where j.entry_date <= p_to
  order by 1, 2
$$;

create or replace function public.rpt_expense_report(p_from date, p_to date)
returns table(account_code text, account_name text, cost_centre text, amount numeric)
language sql stable as $$
  select a.code, a.name, coalesce(c.name, 'Unallocated'), sum(l.base_debit - l.base_credit)
  from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  join public.accounts a on a.id = l.account_id and a.type = 'expense'
  left join public.cost_centres c on c.id = l.cost_centre_id
  where j.entry_date between p_from and p_to
  group by a.code, a.name, c.name having sum(l.base_debit - l.base_credit) <> 0
  order by a.code, 3
$$;

create or replace function public.rpt_tax_schedule(p_from date, p_to date)
returns table(account_code text, account_name text, debit numeric, credit numeric, net_payable numeric)
language sql stable as $$
  select a.code, a.name, coalesce(sum(l.base_debit),0), coalesce(sum(l.base_credit),0), coalesce(sum(l.base_credit - l.base_debit),0)
  from public.accounts a
  join public.journal_lines l on l.account_id = a.id
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  where a.subtype = 'tax' and j.entry_date between p_from and p_to
  group by a.code, a.name order by a.code
$$;

select public._secure_tables(array['fiscal_years','fiscal_periods','cost_centres','accounts','account_mappings','fx_rates','journals','journal_lines']);
select public._audit_tables(array['fiscal_years','fiscal_periods','cost_centres','accounts','account_mappings','fx_rates','journals','journal_lines']);

-- Helper: create a fiscal year with 12 monthly periods (calendar year)
create or replace function public.create_fiscal_year(p_year int) returns uuid language plpgsql as $$
declare fy uuid; m int;
begin
  insert into public.fiscal_years(name, start_date, end_date) values ('FY' || p_year, make_date(p_year,1,1), make_date(p_year,12,31)) returning id into fy;
  for m in 1..12 loop
    insert into public.fiscal_periods(fiscal_year_id, name, start_date, end_date)
    values (fy, to_char(make_date(p_year,m,1),'YYYY-MM'), make_date(p_year,m,1), (make_date(p_year,m,1) + interval '1 month - 1 day')::date);
  end loop;
  return fy;
end $$;

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
