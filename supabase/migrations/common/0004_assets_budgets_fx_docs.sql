-- 0004: fixed assets & depreciation, budgets, FX revaluation, attachments, report-export log, storage setup.

create table public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique,
  name text not null,
  category text not null,
  acquisition_date date not null,
  cost numeric(20,4) not null check (cost >= 0),
  residual_value numeric(20,4) not null default 0 check (residual_value >= 0),
  useful_life_months int not null default 60 check (useful_life_months >= 0),
  method text not null default 'straight_line' check (method in ('straight_line','none')),
  status text not null default 'active' check (status in ('active','disposed')),
  cost_account_id uuid not null references public.accounts(id),
  accum_account_id uuid not null references public.accounts(id),
  expense_account_id uuid not null references public.accounts(id),
  cost_centre_id uuid references public.cost_centres(id),
  acquisition_journal_id uuid references public.journals(id),
  disposal_date date, disposal_proceeds numeric(20,4), disposal_journal_id uuid references public.journals(id),
  created_at timestamptz not null default now(),
  check (residual_value <= cost)
);
create table public.depreciation_entries (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.fixed_assets(id),
  period_end date not null,
  amount numeric(20,4) not null check (amount > 0),
  journal_id uuid not null references public.journals(id),
  unique (asset_id, period_end)
);

create or replace function public.fixed_assets_guard() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.depreciation_entries where asset_id = old.id) and tg_op = 'UPDATE'
     and (new.cost <> old.cost or new.residual_value <> old.residual_value or new.useful_life_months <> old.useful_life_months or new.method <> old.method) then
    raise exception 'Asset % has depreciation posted; cost, life and method are locked', old.tag;
  end if;
  if tg_op = 'DELETE' and (old.acquisition_journal_id is not null or exists (select 1 from public.depreciation_entries where asset_id = old.id)) then
    raise exception 'Asset % has postings and cannot be deleted', old.tag;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_fa_guard before update or delete on public.fixed_assets for each row execute function public.fixed_assets_guard();
create or replace function public.dep_entries_immutable() returns trigger language plpgsql as $$
begin raise exception 'Depreciation entries are immutable; reverse the journal instead'; end $$;
create trigger trg_dep_immutable before update or delete on public.depreciation_entries for each row execute function public.dep_entries_immutable();

create or replace function public.post_asset_acquisition(p_asset uuid, p_credit_account uuid, p_date date default null) returns uuid language plpgsql as $$
declare a public.fixed_assets; jid uuid;
begin
  select * into a from public.fixed_assets where id = p_asset for update;
  if a.acquisition_journal_id is not null then raise exception 'Acquisition already posted'; end if;
  jid := public.create_journal(coalesce(p_date, a.acquisition_date), 'Asset acquisition ' || a.tag,
    jsonb_build_array(jsonb_build_object('account_id', a.cost_account_id, 'cost_centre_id', a.cost_centre_id, 'debit', a.cost),
                      jsonb_build_object('account_id', p_credit_account, 'credit', a.cost)),
    a.tag, null, null, true, 'asset', a.id);
  update public.fixed_assets set acquisition_journal_id = jid where id = p_asset;
  return jid;
end $$;

-- Straight-line monthly depreciation; starts in the month of acquisition; capped at depreciable amount.
create or replace function public.run_depreciation(p_month_end date) returns uuid language plpgsql as $$
declare a record; amt numeric; acc numeric; lines jsonb := '[]'::jsonb; jid uuid; total numeric := 0; n int := 0; ids uuid[] := '{}'; amts numeric[] := '{}'; pe date;
begin
  pe := (date_trunc('month', p_month_end) + interval '1 month - 1 day')::date;
  if p_month_end <> pe then raise exception 'Depreciation must be run for a month-end date (got %, expected %)', p_month_end, pe; end if;
  for a in select * from public.fixed_assets where status = 'active' and method = 'straight_line' and useful_life_months > 0 and acquisition_date <= pe order by tag loop
    continue when exists (select 1 from public.depreciation_entries where asset_id = a.id and period_end = pe);
    continue when a.acquisition_journal_id is null;
    select coalesce(sum(amount),0) into acc from public.depreciation_entries where asset_id = a.id;
    amt := least(round((a.cost - a.residual_value) / a.useful_life_months, 2), a.cost - a.residual_value - acc);
    continue when amt <= 0;
    lines := lines || jsonb_build_object('account_id', a.expense_account_id, 'cost_centre_id', a.cost_centre_id, 'debit', amt, 'description', 'Depreciation ' || a.tag)
                   || jsonb_build_object('account_id', a.accum_account_id, 'cost_centre_id', a.cost_centre_id, 'credit', amt, 'description', 'Depreciation ' || a.tag);
    ids := ids || a.id; amts := amts || amt; total := total + amt; n := n + 1;
  end loop;
  if n = 0 then return null; end if;
  jid := public.create_journal(pe, 'Depreciation for ' || to_char(pe, 'Mon YYYY'), lines, 'DEP-' || to_char(pe,'YYYYMM'), null, null, true, 'depreciation');
  for i in 1 .. n loop
    insert into public.depreciation_entries(asset_id, period_end, amount, journal_id) values (ids[i], pe, amts[i], jid);
  end loop;
  return jid;
end $$;

create or replace function public.dispose_asset(p_asset uuid, p_date date, p_proceeds numeric, p_proceeds_account uuid) returns uuid language plpgsql as $$
declare a public.fixed_assets; acc numeric; gl numeric; lines jsonb; jid uuid;
begin
  select * into a from public.fixed_assets where id = p_asset for update;
  if a.status <> 'active' then raise exception 'Asset already disposed'; end if;
  select coalesce(sum(amount),0) into acc from public.depreciation_entries where asset_id = p_asset;
  gl := p_proceeds - (a.cost - acc);       -- positive = gain
  lines := jsonb_build_array(jsonb_build_object('account_id', a.cost_account_id, 'credit', a.cost, 'description', 'Disposal ' || a.tag));
  if acc > 0 then lines := lines || jsonb_build_object('account_id', a.accum_account_id, 'debit', acc, 'description', 'Disposal ' || a.tag); end if;
  if p_proceeds > 0 then lines := lines || jsonb_build_object('account_id', p_proceeds_account, 'debit', p_proceeds, 'description', 'Disposal proceeds'); end if;
  if gl > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('ASSET_DISPOSAL_GL'), 'credit', gl, 'description', 'Gain on disposal');
  elsif gl < 0 then lines := lines || jsonb_build_object('account_id', public.map_account('ASSET_DISPOSAL_GL'), 'debit', -gl, 'description', 'Loss on disposal'); end if;
  jid := public.create_journal(p_date, 'Disposal of asset ' || a.tag, lines, a.tag, null, null, true, 'asset', a.id);
  update public.fixed_assets set status = 'disposed', disposal_date = p_date, disposal_proceeds = p_proceeds, disposal_journal_id = jid where id = p_asset;
  return jid;
end $$;

create or replace function public.rpt_asset_schedule(p_as_of date)
returns table(tag text, name text, category text, acquisition_date date, cost numeric, accumulated numeric, net_book_value numeric, status text)
language sql stable as $$
  select a.tag, a.name, a.category, a.acquisition_date, a.cost,
    coalesce((select sum(d.amount) from public.depreciation_entries d where d.asset_id = a.id and d.period_end <= p_as_of),0),
    a.cost - coalesce((select sum(d.amount) from public.depreciation_entries d where d.asset_id = a.id and d.period_end <= p_as_of),0),
    case when a.status = 'disposed' and a.disposal_date <= p_as_of then 'disposed' else 'active' end
  from public.fixed_assets a where a.acquisition_date <= p_as_of order by a.tag
$$;

-- ------------------------------------------------------------------ budgets
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references public.fiscal_years(id),
  period_id uuid not null references public.fiscal_periods(id),
  account_id uuid not null references public.accounts(id),
  cost_centre_id uuid references public.cost_centres(id),
  amount numeric(20,4) not null
);
create unique index budgets_unique_idx on public.budgets (period_id, account_id, coalesce(cost_centre_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.rpt_budget_vs_actual(p_from date, p_to date)
returns table(account_code text, account_name text, budget numeric, actual numeric, variance numeric, variance_pct numeric)
language sql stable as $$
  with b as (
    select bu.account_id, sum(bu.amount) as amt from public.budgets bu join public.fiscal_periods p on p.id = bu.period_id
    where p.start_date >= p_from and p.end_date <= p_to group by bu.account_id),
  a as (
    select l.account_id, sum(case when ac.type = 'income' then l.base_credit - l.base_debit else l.base_debit - l.base_credit end) as amt
    from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
    join public.accounts ac on ac.id = l.account_id where j.entry_date between p_from and p_to group by l.account_id)
  select ac.code, ac.name, coalesce(b.amt,0), coalesce(a.amt,0), coalesce(a.amt,0) - coalesce(b.amt,0),
         case when coalesce(b.amt,0) = 0 then null else round((coalesce(a.amt,0) - b.amt) / b.amt * 100, 2) end
  from public.accounts ac left join b on b.account_id = ac.id left join a on a.account_id = ac.id
  where ac.type in ('income','expense') and (b.amt is not null or a.amt is not null) order by ac.code
$$;

-- --------------------------------------------------------------------- FX
create or replace function public.rpt_fx_schedule(p_as_of date)
returns table(account_code text, account_name text, currency char, foreign_balance numeric, rate numeric, revalued_base numeric, carrying_base numeric, difference numeric)
language sql stable as $$
  select x.code, x.name, x.currency, x.fb, x.rate, round(x.fb * x.rate, 2), x.cb, round(x.fb * x.rate, 2) - x.cb
  from (
    select a.code, a.name, a.currency,
      coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
                where l.account_id = a.id and j.currency = a.currency and j.entry_date <= p_as_of),0) as fb,
      coalesce((select sum(l.base_debit - l.base_credit) from public.journal_lines l join public.journals j on j.id = l.journal_id and j.status in ('posted','reversed')
                where l.account_id = a.id and j.entry_date <= p_as_of),0) as cb,
      public.get_fx_rate(a.currency, public.base_currency(), p_as_of) as rate
    from public.accounts a where a.currency is not null and a.currency <> public.base_currency()) x
  order by x.code
$$;

-- Unrealised FX revaluation of foreign-currency accounts (balance sheet date). Posts one base-currency journal.
create or replace function public.revalue_foreign_accounts(p_as_of date) returns uuid language plpgsql as $$
declare r record; lines jsonb := '[]'::jsonb; net numeric := 0; jid uuid;
begin
  for r in select * from public.rpt_fx_schedule(p_as_of) where abs(difference) >= 0.01 loop
    if r.difference > 0 then
      lines := lines || jsonb_build_object('account_id', (select id from public.accounts where code = r.account_code), 'debit', r.difference, 'description', 'FX revaluation ' || r.account_code);
    else
      lines := lines || jsonb_build_object('account_id', (select id from public.accounts where code = r.account_code), 'credit', -r.difference, 'description', 'FX revaluation ' || r.account_code);
    end if;
    net := net + r.difference;
  end loop;
  if jsonb_array_length(lines) = 0 then return null; end if;
  if net > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FX_UNREALISED'), 'credit', net, 'description', 'Unrealised FX gain');
  elsif net < 0 then lines := lines || jsonb_build_object('account_id', public.map_account('FX_UNREALISED'), 'debit', -net, 'description', 'Unrealised FX loss'); end if;
  jid := public.create_journal(p_as_of, 'Unrealised FX revaluation at ' || p_as_of, lines, 'FXREVAL-' || to_char(p_as_of,'YYYYMMDD'), public.base_currency(), 1, true, 'fx_revaluation');
  return jid;
end $$;

-- ------------------------------------------------- documents, export log
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  record_table text not null,
  record_id uuid not null,
  bucket text not null default 'documents',
  storage_path text not null unique,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index attachments_record_idx on public.attachments (record_table, record_id);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  format text not null check (format in ('pdf','xlsx','csv')),
  params jsonb not null default '{}'::jsonb,
  row_count int,
  sha256 text,
  sensitive boolean not null default false,
  company_code text,
  exported_by uuid default auth.uid(),
  exported_at timestamptz not null default now()
);
create or replace function public.report_exports_immutable() returns trigger language plpgsql as $$
begin raise exception 'report_exports is append-only'; end $$;
create trigger trg_exports_immutable before update or delete on public.report_exports for each row execute function public.report_exports_immutable();

create or replace function public.log_export(p_key text, p_format text, p_params jsonb, p_rows int, p_sha text, p_sensitive boolean) returns uuid language plpgsql as $$
declare id uuid;
begin
  insert into public.report_exports(report_key, format, params, row_count, sha256, sensitive, company_code)
  values (p_key, p_format, coalesce(p_params,'{}'::jsonb), p_rows, p_sha, p_sensitive, (select company_code from public.company_settings limit 1)) returning report_exports.id into id;
  return id;
end $$;

select public._secure_tables(array['fixed_assets','depreciation_entries','budgets','attachments','report_exports']);
select public._audit_tables(array['fixed_assets','depreciation_entries','budgets','attachments','report_exports']);

-- Supabase Storage: private buckets + accountant-only policies (skipped where the storage schema is absent)
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do update set public = false;
    insert into storage.buckets (id, name, public) values ('exports', 'exports', false) on conflict (id) do update set public = false;
    execute 'drop policy if exists "fms accountant documents" on storage.objects';
    execute $p$create policy "fms accountant documents" on storage.objects for all to authenticated
      using (bucket_id in ('documents','exports') and public.is_accountant())
      with check (bucket_id in ('documents','exports') and public.is_accountant())$p$;
  end if;
end $$;

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
