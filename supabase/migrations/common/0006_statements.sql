-- 0006: financial statements at three levels of detail, with optional comparative period.
--   Level 1 = summary (headline totals), Level 2 = grouped (sub-totals), Level 3 = detailed (every account).
-- Statement lines are derived from the ledger (posted + reversed journals), base currency.

alter table public.accounts add column statement_group text;

create table public.statement_groups (
  code text primary key, label text not null, statement text not null check (statement in ('bs','is')), sort int not null
);
insert into public.statement_groups(code, label, statement, sort) values
 ('current_assets','Current assets','bs',10), ('non_current_assets','Non-current assets','bs',20),
 ('current_liabilities','Current liabilities','bs',30), ('non_current_liabilities','Non-current liabilities','bs',40), ('equity','Equity','bs',50),
 ('revenue','Revenue','is',10), ('cost_of_sales','Cost of sales','is',20), ('other_income','Other income','is',30),
 ('operating_expenses','Operating expenses','is',40), ('other_expenses','Other expenses','is',50),
 ('finance_costs','Finance costs','is',60), ('income_tax','Income tax','is',70);

create table public.report_notes (
  id uuid primary key default gen_random_uuid(),
  report_key text not null unique,
  body text not null,
  updated_at timestamptz not null default now()
);

-- Default grouping by type / subtype / code range; override per account with accounts.statement_group.
create or replace function public.account_group(a public.accounts) returns text language sql stable as $$
  select coalesce(a.statement_group, case a.type
    when 'asset' then case when a.subtype = 'fixed_asset' then 'non_current_assets' else 'current_assets' end
    when 'liability' then case when a.subtype = 'loan' then 'non_current_liabilities' else 'current_liabilities' end
    when 'equity' then 'equity'
    when 'income' then case when a.code like '49%' then 'other_income' else 'revenue' end
    else case when a.code like '5%' then 'cost_of_sales' when a.code like '8%' then 'income_tax'
              when a.code in ('7000','7900','7910') then 'other_expenses' when a.code like '78%' then 'finance_costs' else 'operating_expenses' end
  end)
$$;

create or replace function public._codenum(c text) returns bigint language sql immutable as $$
  select coalesce(nullif(regexp_replace(c, '\D', '', 'g'), '')::bigint, 0) $$;

-- natural-signed balance-sheet balances at a date (assets = debit-credit, liabilities/equity = credit-debit)
create or replace function public._bs_amounts(p_as_of date)
returns table(account_id uuid, code text, name text, type text, grp text, cat text, amt numeric)
language sql stable as $$
  select a.id, a.code, a.name, a.type, public.account_group(a),
         coalesce(a.cash_flow_category, case when a.type = 'equity' then 'financing' else 'operating' end),
         case when a.type = 'asset' then sum(l.base_debit - l.base_credit) else sum(l.base_credit - l.base_debit) end
  from public.accounts a
  join public.journal_lines l on l.account_id = a.id
  join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
  where a.type in ('asset','liability','equity') and j.entry_date <= p_as_of
  group by a.id
  having sum(l.base_debit + l.base_credit) <> 0
$$;

create or replace function public._bs_rows(p_as_of date)
returns table(sort bigint, line_type text, label text, account_id uuid, code text, depth int, amount numeric)
language sql stable as $$
  with re as (
    select coalesce(sum(l.base_credit - l.base_debit), 0) amt
    from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
    join public.accounts a on a.id = l.account_id and a.type in ('income','expense') where j.entry_date <= p_as_of),
  acc as (
    select account_id, code, name, grp, amt from public._bs_amounts(p_as_of)
    union all select null::uuid, 'RE', 'Retained earnings (cumulative profit)', 'equity', amt from re where amt <> 0),
  g as (select code, label, sort from public.statement_groups where statement = 'bs'),
  gt as (select g.code grp, g.sort, g.label, coalesce(sum(acc.amt), 0) amt, count(acc.code) n from g left join acc on acc.grp = g.code group by g.code, g.sort, g.label)
  select gt.sort * 1000000000::bigint, 'header', gt.label, null::uuid, null::text, 1, null::numeric from gt where gt.n > 0
  union all
  select g.sort * 1000000000::bigint + public._codenum(acc.code), 'account', acc.name, acc.account_id, acc.code, 2, acc.amt from acc join g on g.code = acc.grp
  union all
  select gt.sort * 1000000000::bigint + 999999999, 'group_total', gt.label, null, null, 1, gt.amt from gt where gt.n > 0 and gt.grp <> 'equity'
  union all select 25000000000::bigint, 'total', 'Total assets', null, null, 0, coalesce((select sum(amt) from gt where grp in ('current_assets','non_current_assets')), 0)
  union all select 45000000000::bigint, 'total', 'Total liabilities', null, null, 0, coalesce((select sum(amt) from gt where grp in ('current_liabilities','non_current_liabilities')), 0)
  union all select 55000000000::bigint, 'total', 'Total equity', null, null, 0, coalesce((select sum(amt) from gt where grp = 'equity'), 0)
  union all select 60000000000::bigint, 'total', 'Total liabilities and equity', null, null, 0, coalesce((select sum(amt) from gt where grp in ('current_liabilities','non_current_liabilities','equity')), 0)
  union all select 65000000000::bigint, 'check', 'Difference (assets less liabilities and equity)', null, null, 0,
    coalesce((select sum(amt) from gt where grp in ('current_assets','non_current_assets')), 0) - coalesce((select sum(amt) from gt where grp in ('current_liabilities','non_current_liabilities','equity')), 0)
$$;

create or replace function public._is_rows(p_from date, p_to date)
returns table(sort bigint, line_type text, label text, account_id uuid, code text, depth int, amount numeric)
language sql stable as $$
  with acc as (
    select a.id account_id, a.code, a.name, public.account_group(a) grp,
      case when a.type = 'income' then sum(l.base_credit - l.base_debit) else sum(l.base_debit - l.base_credit) end amt
    from public.accounts a join public.journal_lines l on l.account_id = a.id
    join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
    where a.type in ('income','expense') and j.entry_date between p_from and p_to
    group by a.id having sum(l.base_debit + l.base_credit) <> 0),
  g as (select code, label, sort from public.statement_groups where statement = 'is'),
  gt as (select g.code grp, g.sort, g.label, coalesce(sum(acc.amt), 0) amt, count(acc.code) n from g left join acc on acc.grp = g.code group by g.code, g.sort, g.label),
  v as (select grp, amt from gt)
  select gt.sort * 1000000000::bigint, 'header', gt.label, null::uuid, null::text, 1, null::numeric from gt where gt.n > 0 and gt.grp <> 'revenue'
  union all
  select g.sort * 1000000000::bigint + public._codenum(acc.code), 'account', acc.name, acc.account_id, acc.code, 2, acc.amt from acc join g on g.code = acc.grp
  union all
  select gt.sort * 1000000000::bigint + 999999999, case when gt.grp = 'revenue' then 'total' else 'group_total' end, gt.label, null, null, case when gt.grp = 'revenue' then 0 else 1 end, gt.amt
    from gt where gt.n > 0 or gt.grp = 'revenue'
  union all select 25000000000::bigint, 'total', 'Gross profit', null, null, 0, coalesce((select amt from v where grp = 'revenue'), 0) - coalesce((select amt from v where grp = 'cost_of_sales'), 0)
  union all select 45000000000::bigint, 'total', 'Operating profit', null, null, 0,
    coalesce((select amt from v where grp = 'revenue'), 0) - coalesce((select amt from v where grp = 'cost_of_sales'), 0) + coalesce((select amt from v where grp = 'other_income'), 0) - coalesce((select amt from v where grp = 'operating_expenses'), 0)
  union all select 65000000000::bigint, 'group_total', 'Profit before tax', null, null, 1,
    coalesce((select amt from v where grp = 'revenue'), 0) - coalesce((select amt from v where grp = 'cost_of_sales'), 0) + coalesce((select amt from v where grp = 'other_income'), 0)
    - coalesce((select amt from v where grp = 'operating_expenses'), 0) - coalesce((select amt from v where grp = 'other_expenses'), 0) - coalesce((select amt from v where grp = 'finance_costs'), 0)
  union all select 80000000000::bigint, 'total', 'Net profit for the period', null, null, 0,
    coalesce((select amt from v where grp = 'revenue'), 0) - coalesce((select amt from v where grp = 'cost_of_sales'), 0) + coalesce((select amt from v where grp = 'other_income'), 0)
    - coalesce((select amt from v where grp = 'operating_expenses'), 0) - coalesce((select amt from v where grp = 'other_expenses'), 0) - coalesce((select amt from v where grp = 'finance_costs'), 0) - coalesce((select amt from v where grp = 'income_tax'), 0)
$$;

create or replace function public._cf_lines(p_from date, p_to date, p_method text)
returns table(sec int, sub text, sortkey bigint, label text, account_id uuid, code text, amt numeric, is_np boolean)
language plpgsql stable as $$
declare accdep uuid;
begin
  select m.account_id into accdep from public.account_mappings m where m.key = 'ACCUMULATED_DEPRECIATION';
  if p_method = 'direct' then
    return query
    select x.sec, 'direct'::text, x.sec * 10000000000::bigint + public._codenum(x.code), x.name, x.id, x.code, x.amt, false
    from (
      select case coalesce(a.cash_flow_category, case when a.type = 'equity' then 'financing' else 'operating' end) when 'investing' then 2 when 'financing' then 3 else 1 end sec,
             a.id, a.code, a.name, sum(l.base_credit - l.base_debit) amt
      from public.journal_lines l join public.accounts a on a.id = l.account_id
      where l.journal_id in (select l2.journal_id from public.journal_lines l2 join public.accounts a2 on a2.id = l2.account_id
                              join public.journals j2 on j2.id = l2.journal_id and j2.status in ('posted','reversed')
                              where a2.cash_flow_category = 'cash' and j2.entry_date between p_from and p_to)
        and coalesce(a.cash_flow_category, 'operating') <> 'cash'
      group by 1, a.id) x
    where x.amt <> 0;
  elsif p_method = 'indirect' then
    return query
    with c as (select * from public._bs_amounts(p_to)), o as (select * from public._bs_amounts(p_from - 1)),
    m as (select coalesce(c.account_id, o.account_id) account_id, coalesce(c.code, o.code) code, coalesce(c.name, o.name) name, coalesce(c.type, o.type) type, coalesce(c.cat, o.cat) cat,
                 coalesce(c.amt, 0) - coalesce(o.amt, 0) delta from c full join o on o.account_id = c.account_id),
    e as (select m.*, case when m.type = 'asset' then -m.delta else m.delta end effect from m where m.cat <> 'cash' and m.delta <> 0)
    select 1, 'np'::text, 10000000001::bigint, 'Net profit for the period'::text, null::uuid, 'NP'::text,
           coalesce((select sum(l.base_credit - l.base_debit) from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
                     join public.accounts a on a.id = l.account_id and a.type in ('income','expense') where j.entry_date between p_from and p_to), 0), true
    union all
    select 1, 'adj', 10000000002::bigint, 'Depreciation and amortisation', e.account_id, e.code, e.effect, false from e where e.account_id = accdep
    union all
    select case e.cat when 'investing' then 2 when 'financing' then 3 else 1 end, case when e.cat = 'operating' then 'wc' else 'acc' end,
           (case e.cat when 'investing' then 2 when 'financing' then 3 else 1 end) * 10000000000::bigint + public._codenum(e.code), e.name, e.account_id, e.code, e.effect, false
    from e where e.account_id is distinct from accdep;
  else
    raise exception 'Cash flow method must be direct or indirect';
  end if;
end $$;

create or replace function public._cf_rows(p_from date, p_to date, p_method text)
returns table(sort bigint, line_type text, label text, account_id uuid, code text, depth int, amount numeric)
language sql stable as $$
  with l as (select * from public._cf_lines(p_from, p_to, p_method)),
  op as (select coalesce(sum(amt), 0) a from l where sec = 1), iv as (select coalesce(sum(amt), 0) a from l where sec = 2), fn as (select coalesce(sum(amt), 0) a from l where sec = 3),
  oc as (select coalesce(sum(x.base_debit - x.base_credit), 0) a from public.journal_lines x join public.accounts a on a.id = x.account_id and a.cash_flow_category = 'cash'
         join public.journals j on j.id = x.journal_id and j.status in ('posted','reversed') where j.entry_date < p_from),
  cc as (select coalesce(sum(x.base_debit - x.base_credit), 0) a from public.journal_lines x join public.accounts a on a.id = x.account_id and a.cash_flow_category = 'cash'
         join public.journals j on j.id = x.journal_id and j.status in ('posted','reversed') where j.entry_date <= p_to)
  select l.sortkey, case when l.is_np then 'group_total' else 'account' end, l.label, l.account_id, l.code, case when l.is_np then 1 else 2 end, l.amt from l
  union all select 1000000003::bigint + 9000000000, 'group_total', 'Adjustments for non-cash items', null, null, 1, sum(amt) from l where sub = 'adj' having count(*) > 0
  union all select 10000900000::bigint, 'group_total', 'Changes in working capital', null, null, 1, sum(amt) from l where sub = 'wc' having count(*) > 0
  union all select 10999999999::bigint, 'total', 'Net cash from operating activities', null, null, 0, (select a from op)
  union all select 20999999999::bigint, 'total', 'Net cash from investing activities', null, null, 0, (select a from iv)
  union all select 30999999999::bigint, 'total', 'Net cash from financing activities', null, null, 0, (select a from fn)
  union all select 40000000000::bigint, 'total', 'Net increase / (decrease) in cash and bank', null, null, 0, (select a from op) + (select a from iv) + (select a from fn)
  union all select 41000000000::bigint, 'total', 'Cash and bank at start of period', null, null, 0, (select a from oc)
  union all select 42000000000::bigint, 'total', 'Cash and bank at end of period', null, null, 0, (select a from oc) + (select a from op) + (select a from iv) + (select a from fn)
  union all select 43000000000::bigint, 'check', 'Difference to ledger cash (should be nil)', null, null, 0, (select a from cc) - ((select a from oc) + (select a from op) + (select a from iv) + (select a from fn))
$$;

-- Public statement functions. p_level: 1 summary, 2 grouped, 3 detailed. Comparative arguments are optional.
create or replace function public.rpt_balance_sheet_levels(p_level int, p_as_of date, p_compare_as_of date default null)
returns table(sort bigint, line_type text, label text, account_id uuid, code text, depth int, amount numeric, compare_amount numeric)
language sql stable as $$
  select coalesce(c.sort, p.sort), coalesce(c.line_type, p.line_type),
    case when p_level = 3 and coalesce(c.sort, p.sort) % 1000000000 = 999999999 then 'Total ' || lower(coalesce(c.label, p.label)) else coalesce(c.label, p.label) end,
    coalesce(c.account_id, p.account_id), coalesce(c.code, p.code), coalesce(c.depth, p.depth),
    case when coalesce(c.line_type, p.line_type) = 'header' then null else coalesce(c.amount, 0) end,
    case when p_compare_as_of is null or coalesce(c.line_type, p.line_type) = 'header' then null else coalesce(p.amount, 0) end
  from public._bs_rows(p_as_of) c full join (select * from public._bs_rows(p_compare_as_of) where p_compare_as_of is not null) p on p.sort = c.sort
  where case when p_level >= 3 then true when p_level = 2 then coalesce(c.line_type, p.line_type) in ('group_total','total','check') else coalesce(c.line_type, p.line_type) in ('total','check') end
  order by 1
$$;

create or replace function public.rpt_income_statement_levels(p_level int, p_from date, p_to date, p_compare_from date default null, p_compare_to date default null)
returns table(sort bigint, line_type text, label text, account_id uuid, code text, depth int, amount numeric, compare_amount numeric)
language sql stable as $$
  select coalesce(c.sort, p.sort), coalesce(c.line_type, p.line_type),
    case when p_level = 3 and coalesce(c.sort, p.sort) % 1000000000 = 999999999 and coalesce(c.sort, p.sort) < 65000000000 then 'Total ' || lower(coalesce(c.label, p.label)) else coalesce(c.label, p.label) end,
    coalesce(c.account_id, p.account_id), coalesce(c.code, p.code), coalesce(c.depth, p.depth),
    case when coalesce(c.line_type, p.line_type) = 'header' then null else coalesce(c.amount, 0) end,
    case when p_compare_from is null or coalesce(c.line_type, p.line_type) = 'header' then null else coalesce(p.amount, 0) end
  from public._is_rows(p_from, p_to) c full join (select * from public._is_rows(coalesce(p_compare_from, p_from), coalesce(p_compare_to, p_to)) where p_compare_from is not null) p on p.sort = c.sort
  where case when p_level >= 3 then true when p_level = 2 then coalesce(c.line_type, p.line_type) in ('group_total','total','check') else coalesce(c.line_type, p.line_type) in ('total','check') end
  order by 1
$$;

create or replace function public.rpt_cash_flow_levels(p_level int, p_from date, p_to date, p_compare_from date default null, p_compare_to date default null, p_method text default 'indirect')
returns table(sort bigint, line_type text, label text, account_id uuid, code text, depth int, amount numeric, compare_amount numeric)
language sql stable as $$
  select coalesce(c.sort, p.sort), coalesce(c.line_type, p.line_type), coalesce(c.label, p.label), coalesce(c.account_id, p.account_id), coalesce(c.code, p.code), coalesce(c.depth, p.depth),
    coalesce(c.amount, 0), case when p_compare_from is null then null else coalesce(p.amount, 0) end
  from public._cf_rows(p_from, p_to, p_method) c
  full join (select * from public._cf_rows(coalesce(p_compare_from, p_from), coalesce(p_compare_to, p_to), p_method) where p_compare_from is not null) p on p.sort = c.sort
  where case when p_level >= 3 then true when p_level = 2 then coalesce(c.line_type, p.line_type) in ('group_total','total','check') else coalesce(c.line_type, p.line_type) in ('total','check') end
  order by 1
$$;

select public._secure_tables(array['statement_groups','report_notes']);
select public._audit_tables(array['report_notes']);

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
