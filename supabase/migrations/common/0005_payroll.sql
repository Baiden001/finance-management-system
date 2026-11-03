-- 0005: monthly payroll with optional, effective-dated Ghana statutory compliance.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  emp_no text not null unique,
  full_name text not null,
  employment_type text not null check (employment_type in ('permanent','casual','temporary')),
  status text not null default 'active' check (status in ('active','inactive','terminated')),
  hire_date date, end_date date,
  tin text, ssnit_no text,
  paye_applicable boolean not null default true,
  ssnit_applicable boolean not null default true,
  payment_method text not null default 'bank' check (payment_method in ('bank','momo')),
  bank_name text, bank_account_number text,
  momo_provider text, momo_number text,
  cost_centre_id uuid references public.cost_centres(id),
  created_at timestamptz not null default now()
);

create table public.employee_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  cost_centre_id uuid not null references public.cost_centres(id),
  percent numeric(5,2) not null check (percent > 0 and percent <= 100),
  unique (employee_id, cost_centre_id)
);

create table public.pay_components (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null,
  kind text not null check (kind in ('earning','deduction')),
  taxable boolean not null default true,
  pensionable boolean not null default false,
  is_active boolean not null default true
);

create table public.salary_structures (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  effective_from date not null,
  effective_to date,
  pay_basis text not null default 'monthly' check (pay_basis in ('monthly','daily','hourly','shift','work_based')),
  basic_amount numeric(20,4) not null check (basic_amount >= 0),   -- monthly salary, or the unit rate for non-monthly bases
  notes text,
  unique (employee_id, effective_from)
);
create table public.structure_components (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.salary_structures(id),
  component_id uuid not null references public.pay_components(id),
  amount numeric(20,4) not null check (amount >= 0),
  unique (structure_id, component_id)
);

create or replace function public.salary_structures_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Salary structures are history and cannot be deleted'; end if;
  if tg_op = 'UPDATE' and (new.employee_id, new.effective_from, new.pay_basis, new.basic_amount) is distinct from (old.employee_id, old.effective_from, old.pay_basis, old.basic_amount) then
    raise exception 'Salary structure history is immutable; add a new structure with a later effective date';
  end if;
  if tg_op = 'INSERT' then
    update public.salary_structures set effective_to = new.effective_from - 1
     where employee_id = new.employee_id and effective_to is null and effective_from < new.effective_from;
    if exists (select 1 from public.salary_structures where employee_id = new.employee_id and effective_from > new.effective_from) then
      raise exception 'A structure with a later effective date already exists';
    end if;
  end if;
  return new;
end $$;
create trigger trg_ss_guard before insert or update or delete on public.salary_structures for each row execute function public.salary_structures_guard();

create or replace function public.structure_components_guard() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.payroll_lines pl join public.employees e on e.id = pl.employee_id
             join public.salary_structures s on s.employee_id = e.id where s.id = coalesce(new.structure_id, old.structure_id)) and tg_op <> 'INSERT' then
    raise exception 'Structure components used in payroll are immutable; create a new structure';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Statutory rules: versioned, effective-dated, with verification status. NEVER hard-coded in functions.
create table public.statutory_rule_sets (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null check (rule_code in ('GH_PAYE','GH_SSNIT')),
  effective_from date not null,
  effective_to date,
  params jsonb not null,
  source_note text,
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (rule_code, effective_from)
);
create or replace function public.rules_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and exists (select 1 from public.payroll_runs where paye_rule_id = old.id or ssnit_rule_id = old.id) then
    raise exception 'Rule set is referenced by a payroll run and cannot be deleted';
  end if;
  if tg_op = 'UPDATE' and old.params is distinct from new.params and exists (select 1 from public.payroll_runs where paye_rule_id = old.id or ssnit_rule_id = old.id) then
    raise exception 'Rule parameters used by a payroll run are immutable; add a new effective-dated version';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  period_year int not null check (period_year between 2000 and 2200),
  period_month int not null check (period_month between 1 and 12),
  kind text not null default 'regular' check (kind in ('regular','supplementary')),
  seq int not null default 1,
  status text not null default 'draft' check (status in ('draft','calculated','finalized','posted','reversed')),
  ghana_compliance_applied boolean,
  paye_rule_id uuid references public.statutory_rule_sets(id),
  ssnit_rule_id uuid references public.statutory_rule_sets(id),
  unverified_rules_acknowledged boolean not null default false,
  parent_run_id uuid references public.payroll_runs(id),
  calculated_at timestamptz, finalized_at timestamptz, finalized_by uuid,
  journal_id uuid references public.journals(id),
  payment_journal_ids uuid[] not null default '{}',
  reversal_reason text,
  notes text,
  created_at timestamptz not null default now(),
  unique (period_year, period_month, kind, seq)
);
create trigger trg_rules_guard before update or delete on public.statutory_rule_sets for each row execute function public.rules_guard();

create table public.payroll_inputs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  days_worked numeric(8,2) not null default 0,
  hours_worked numeric(8,2) not null default 0,
  shifts_worked numeric(8,2) not null default 0,
  units_completed numeric(12,2) not null default 0,
  overtime_amount numeric(20,4) not null default 0,
  bonus numeric(20,4) not null default 0,
  commission numeric(20,4) not null default 0,
  other_earnings numeric(20,4) not null default 0,
  other_deductions numeric(20,4) not null default 0,
  advance_repayment numeric(20,4) not null default 0,
  approved boolean not null default false,
  notes text,
  unique (run_id, employee_id)
);

create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  emp_no text not null, full_name text not null, employment_type text not null,
  pay_basis text not null,
  basic_pay numeric(20,4) not null default 0,
  allowances numeric(20,4) not null default 0,
  overtime numeric(20,4) not null default 0,
  bonus numeric(20,4) not null default 0,
  commission numeric(20,4) not null default 0,
  other_earnings numeric(20,4) not null default 0,
  gross_pay numeric(20,4) not null default 0,
  pensionable_pay numeric(20,4) not null default 0,
  taxable_pay numeric(20,4) not null default 0,
  paye numeric(20,4) not null default 0,
  employee_pension numeric(20,4) not null default 0,
  other_deductions numeric(20,4) not null default 0,
  advance_repayment numeric(20,4) not null default 0,
  total_deductions numeric(20,4) not null default 0,
  net_pay numeric(20,4) not null default 0,
  employer_pension numeric(20,4) not null default 0,
  employer_cost numeric(20,4) not null default 0,
  cost_centre_id uuid references public.cost_centres(id),
  payment_method text not null,
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed')),
  payment_reference text,
  paid_at timestamptz,
  payment_posted boolean not null default false,
  exceptions jsonb not null default '[]'::jsonb,
  calc_detail jsonb not null default '{}'::jsonb,
  unique (run_id, employee_id)
);
create index payroll_lines_run_idx on public.payroll_lines (run_id);

create trigger trg_sc_guard before update or delete on public.structure_components for each row execute function public.structure_components_guard();

-- Finalized/posted/reversed runs: lines and inputs are frozen (payment tracking fields excepted)
create or replace function public.payroll_children_guard() returns trigger language plpgsql as $$
declare st text; rid uuid; payfields text[] := array['payment_status','payment_reference','paid_at','payment_posted'];
begin
  rid := case when tg_op = 'DELETE' then old.run_id else new.run_id end;
  select status into st from public.payroll_runs where id = rid;
  if st in ('finalized','posted','reversed') then
    if tg_table_name = 'payroll_lines' and tg_op = 'UPDATE' and (to_jsonb(new) - payfields) = (to_jsonb(old) - payfields) then return new; end if;
    raise exception 'Payroll run is % - records are frozen. Use a reversal or a supplementary run.', st;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_pl_guard before insert or update or delete on public.payroll_lines for each row execute function public.payroll_children_guard();
create trigger trg_pi_guard before insert or update or delete on public.payroll_inputs for each row execute function public.payroll_children_guard();

create or replace function public.payroll_runs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only draft payroll runs can be deleted'; end if;
    return old;
  end if;
  if old.status in ('finalized','posted','reversed') and current_setting('fms.payroll_internal', true) <> 'on' then
    raise exception 'Payroll run is % and cannot be edited', old.status;
  end if;
  return new;
end $$;
create trigger trg_pr_guard before update or delete on public.payroll_runs for each row execute function public.payroll_runs_guard();

-- --------------------------------------------------------------- calculation
create or replace function public._paye_tax(p_taxable numeric, p_params jsonb) returns numeric language plpgsql immutable as $$
declare b jsonb; prev numeric := 0; tax numeric := 0; upto numeric; slice numeric;
begin
  if p_taxable <= 0 then return 0; end if;
  for b in select * from jsonb_array_elements(p_params->'bands') loop
    upto := nullif(b->>'upto','')::numeric;
    if upto is null or p_taxable <= upto then
      tax := tax + (p_taxable - prev) * (b->>'rate')::numeric; exit;
    end if;
    tax := tax + (upto - prev) * (b->>'rate')::numeric; prev := upto;
  end loop;
  return round(tax, 2);
end $$;

create or replace function public.payroll_create_run(p_year int, p_month int, p_kind text default 'regular', p_parent uuid default null) returns uuid language plpgsql as $$
declare rid uuid; s int;
begin
  if p_kind = 'supplementary' and p_parent is null then raise exception 'A supplementary run must reference the run it supplements'; end if;
  select coalesce(max(seq),0) + 1 into s from public.payroll_runs where period_year = p_year and period_month = p_month and kind = p_kind;
  if p_kind = 'regular' and exists (select 1 from public.payroll_runs where period_year = p_year and period_month = p_month and kind = 'regular' and status <> 'reversed') then
    raise exception 'A regular payroll run already exists for %-%', p_year, p_month;
  end if;
  insert into public.payroll_runs(period_year, period_month, kind, seq, parent_run_id) values (p_year, p_month, p_kind, s, p_parent) returning payroll_runs.id into rid;
  -- seed one input row per active employee (permanent staff on monthly pay need no input)
  insert into public.payroll_inputs(run_id, employee_id)
  select rid, e.id from public.employees e where e.status = 'active' and (e.hire_date is null or e.hire_date <= (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date)
    and (e.end_date is null or e.end_date >= make_date(p_year, p_month, 1));
  return rid;
end $$;

create or replace function public.payroll_calculate(p_run uuid) returns int language plpgsql as $$
declare
  r public.payroll_runs; s public.company_settings; mstart date; mend date; paye_rule public.statutory_rule_sets; ssnit_rule public.statutory_rule_sets;
  e record; st public.salary_structures; i public.payroll_inputs; basic numeric; allow numeric; allow_taxable numeric; pens_allow numeric; ded numeric;
  gross numeric; pensionable numeric; taxable numeric; paye numeric; ee numeric; er numeric; net numeric; exc jsonb; n int := 0; comp_det jsonb; ee_rate numeric; er_rate numeric; pens_ded boolean;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found'; end if;
  if r.status not in ('draft','calculated') then raise exception 'Run is % and cannot be recalculated', r.status; end if;
  select * into s from public.company_settings limit 1;
  mstart := make_date(r.period_year, r.period_month, 1);
  mend := (mstart + interval '1 month - 1 day')::date;
  if s.ghana_payroll_compliance then
    select * into paye_rule from public.statutory_rule_sets where rule_code = 'GH_PAYE' and effective_from <= mend and (effective_to is null or effective_to >= mend) order by effective_from desc limit 1;
    select * into ssnit_rule from public.statutory_rule_sets where rule_code = 'GH_SSNIT' and effective_from <= mend and (effective_to is null or effective_to >= mend) order by effective_from desc limit 1;
    if paye_rule.id is null or ssnit_rule.id is null then raise exception 'Ghana payroll compliance is enabled but no effective PAYE/SSNIT rule set covers %', mend; end if;
    ee_rate := (ssnit_rule.params->>'employee_rate')::numeric; er_rate := (ssnit_rule.params->>'employer_rate')::numeric;
    pens_ded := coalesce((paye_rule.params->>'pension_deductible')::boolean, true);
  end if;
  perform set_config('fms.payroll_internal', 'on', true);
  delete from public.payroll_lines where run_id = p_run;
  for e in select em.*, pi.id as input_id from public.payroll_inputs pi join public.employees em on em.id = pi.employee_id where pi.run_id = p_run order by em.emp_no loop
    select * into i from public.payroll_inputs where id = e.input_id;
    select * into st from public.salary_structures where employee_id = e.id and effective_from <= mend and (effective_to is null or effective_to >= mstart) order by effective_from desc limit 1;
    exc := '[]'::jsonb;
    if st.id is null then
      exc := exc || jsonb_build_object('severity','error','code','no_salary_structure','message','No salary structure effective for this month');
      basic := 0; allow := 0; allow_taxable := 0; pens_allow := 0; ded := 0;
    else
      basic := case st.pay_basis
        when 'monthly' then st.basic_amount
        when 'daily' then round(st.basic_amount * i.days_worked, 2)
        when 'hourly' then round(st.basic_amount * i.hours_worked, 2)
        when 'shift' then round(st.basic_amount * i.shifts_worked, 2)
        else round(st.basic_amount * i.units_completed, 2) end;
      if st.pay_basis <> 'monthly' then
        if not i.approved then exc := exc || jsonb_build_object('severity','error','code','input_not_approved','message','Attendance / work-based input is not approved'); end if;
        if basic = 0 then exc := exc || jsonb_build_object('severity','warning','code','zero_basic','message','No work recorded for a ' || st.pay_basis || ' worker'); end if;
      end if;
      select coalesce(sum(sc.amount) filter (where c.kind = 'earning'),0),
             coalesce(sum(sc.amount) filter (where c.kind = 'earning' and c.taxable),0),
             coalesce(sum(sc.amount) filter (where c.kind = 'earning' and c.pensionable),0),
             coalesce(sum(sc.amount) filter (where c.kind = 'deduction'),0)
        into allow, allow_taxable, pens_allow, ded
        from public.structure_components sc join public.pay_components c on c.id = sc.component_id where sc.structure_id = st.id;
    end if;
    gross := basic + allow + i.overtime_amount + i.bonus + i.commission + i.other_earnings;
    pensionable := basic + pens_allow;
    ee := 0; er := 0; paye := 0;
    taxable := basic + allow_taxable + i.overtime_amount + i.bonus + i.commission + i.other_earnings;
    if s.ghana_payroll_compliance then
      if e.ssnit_applicable then ee := round(pensionable * ee_rate, 2); er := round(pensionable * er_rate, 2); end if;
      if pens_ded then taxable := taxable - ee; end if;
      if e.paye_applicable then paye := public._paye_tax(taxable, paye_rule.params); end if;
      if paye_rule.verified_at is null or ssnit_rule.verified_at is null then
        exc := exc || jsonb_build_object('severity','warning','code','statutory_rule_unverified','message','Statutory rule set has not been verified against official guidance');
      end if;
    end if;
    net := gross - paye - ee - (ded + i.other_deductions) - i.advance_repayment;
    if net < 0 then exc := exc || jsonb_build_object('severity','error','code','negative_net','message','Deductions exceed gross pay'); end if;
    if e.payment_method = 'bank' and coalesce(e.bank_account_number,'') = '' then exc := exc || jsonb_build_object('severity','warning','code','missing_bank','message','No bank account on file'); end if;
    if e.payment_method = 'momo' and coalesce(e.momo_number,'') = '' then exc := exc || jsonb_build_object('severity','warning','code','missing_momo','message','No mobile money number on file'); end if;
    insert into public.payroll_lines(run_id, employee_id, emp_no, full_name, employment_type, pay_basis, basic_pay, allowances, overtime, bonus, commission, other_earnings,
        gross_pay, pensionable_pay, taxable_pay, paye, employee_pension, other_deductions, advance_repayment, total_deductions, net_pay, employer_pension, employer_cost,
        cost_centre_id, payment_method, exceptions, calc_detail)
    values (p_run, e.id, e.emp_no, e.full_name, e.employment_type, coalesce(st.pay_basis,'monthly'), basic, allow, i.overtime_amount, i.bonus, i.commission, i.other_earnings,
        gross, pensionable, greatest(taxable,0), paye, ee, ded + i.other_deductions, i.advance_repayment, paye + ee + ded + i.other_deductions + i.advance_repayment, net, er, gross + er,
        e.cost_centre_id, e.payment_method, exc,
        jsonb_build_object('structure_id', st.id, 'structure_effective_from', st.effective_from, 'paye_rule_id', paye_rule.id, 'ssnit_rule_id', ssnit_rule.id,
                           'compliance_enabled', s.ghana_payroll_compliance));
    n := n + 1;
  end loop;
  update public.payroll_runs set status = 'calculated', calculated_at = now(), ghana_compliance_applied = s.ghana_payroll_compliance,
         paye_rule_id = paye_rule.id, ssnit_rule_id = ssnit_rule.id where id = p_run;
  perform set_config('fms.payroll_internal', 'off', true);
  return n;
end $$;

create or replace function public.payroll_exceptions(p_run uuid)
returns table(emp_no text, full_name text, severity text, code text, message text)
language sql stable as $$
  select l.emp_no, l.full_name, x->>'severity', x->>'code', x->>'message'
  from public.payroll_lines l, jsonb_array_elements(l.exceptions) x where l.run_id = p_run order by l.emp_no
$$;

create or replace function public.payroll_finalize(p_run uuid, p_ack_unverified boolean default false) returns void language plpgsql as $$
declare r public.payroll_runs; errs int; unver int;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status <> 'calculated' then raise exception 'Only a calculated run can be finalized (status: %)', r.status; end if;
  select count(*) into errs from public.payroll_lines l, jsonb_array_elements(l.exceptions) x where l.run_id = p_run and x->>'severity' = 'error';
  if errs > 0 then raise exception '% blocking payroll exception(s) must be corrected before finalizing', errs; end if;
  select count(*) into unver from public.payroll_lines l, jsonb_array_elements(l.exceptions) x where l.run_id = p_run and x->>'code' = 'statutory_rule_unverified';
  if unver > 0 and not p_ack_unverified then raise exception 'Statutory rules are unverified. Verify them against official guidance, or finalize with explicit acknowledgement.'; end if;
  if not exists (select 1 from public.payroll_lines where run_id = p_run) then raise exception 'Run has no payroll lines'; end if;
  perform set_config('fms.payroll_internal', 'on', true);
  update public.payroll_runs set status = 'finalized', finalized_at = now(), finalized_by = auth.uid(), unverified_rules_acknowledged = (unver > 0 and p_ack_unverified) where id = p_run;
  perform set_config('fms.payroll_internal', 'off', true);
end $$;

create or replace function public.payroll_post_journal(p_run uuid) returns uuid language plpgsql as $$
declare r public.payroll_runs; lines jsonb := '[]'::jsonb; x record; t record; jid uuid; mend date;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status <> 'finalized' then raise exception 'Only a finalized run can be posted (status: %)', r.status; end if;
  mend := (make_date(r.period_year, r.period_month, 1) + interval '1 month - 1 day')::date;
  if exists (select 1 from public.employee_cost_allocations a join public.payroll_lines l on l.employee_id = a.employee_id and l.run_id = p_run
             group by a.employee_id having sum(a.percent) <> 100) then
    raise exception 'Cost allocations must total 100%% for every allocated employee';
  end if;
  declare tg numeric; ter numeric; sg numeric := 0; ser numeric := 0; first_g int; first_er int;
  begin
    select sum(gross_pay), sum(employer_pension) into tg, ter from public.payroll_lines where run_id = p_run;
    for x in
      select coalesce(a.cost_centre_id, l.cost_centre_id) cc, sum(round(l.gross_pay * coalesce(a.percent,100) / 100, 2)) g, sum(round(l.employer_pension * coalesce(a.percent,100) / 100, 2)) er
      from public.payroll_lines l left join public.employee_cost_allocations a on a.employee_id = l.employee_id
      where l.run_id = p_run group by 1 order by 1 nulls last loop
      sg := sg + x.g; ser := ser + x.er;
      if x.g > 0 or x.er > 0 then
        lines := lines || jsonb_build_object('account_id', public.map_account('PAYROLL_EXPENSE'), 'cost_centre_id', x.cc, 'debit', x.g, 'description', 'Gross pay')
                       || jsonb_build_object('account_id', public.map_account('PAYROLL_PENSION_EXPENSE'), 'cost_centre_id', x.cc, 'debit', x.er, 'description', 'Employer pension');
      end if;
    end loop;
    -- absorb allocation rounding on the first cost centre so expense equals the payroll register exactly
    if sg <> tg then lines := jsonb_set(lines, '{0,debit}', to_jsonb((lines->0->>'debit')::numeric + (tg - sg))); end if;
    if ser <> ter then lines := jsonb_set(lines, '{1,debit}', to_jsonb((lines->1->>'debit')::numeric + (ter - ser))); end if;
  end;
  select sum(net_pay) net, sum(paye) paye, sum(employee_pension) ee, sum(employer_pension) er, sum(other_deductions) od, sum(advance_repayment) adv into t from public.payroll_lines where run_id = p_run;
  if t.net > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('PAYROLL_NET_PAYABLE'), 'credit', t.net, 'description', 'Net salaries payable'); end if;
  if t.paye > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('PAYE_PAYABLE'), 'credit', t.paye, 'description', 'PAYE payable'); end if;
  if t.ee + t.er > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('PENSION_PAYABLE'), 'credit', t.ee + t.er, 'description', 'Pension contributions payable'); end if;
  if t.od > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('PAYROLL_OTHER_DED_PAYABLE'), 'credit', t.od, 'description', 'Other deductions payable'); end if;
  if t.adv > 0 then lines := lines || jsonb_build_object('account_id', public.map_account('STAFF_ADVANCES'), 'credit', t.adv, 'description', 'Advance / loan recoveries'); end if;
  jid := public.create_journal(mend, 'Payroll ' || to_char(mend, 'Mon YYYY') || case when r.kind = 'supplementary' then ' (supplementary ' || r.seq || ')' else '' end, lines,
           'PAYROLL-' || r.period_year || lpad(r.period_month::text, 2, '0') || '-' || r.seq, null, null, true, 'payroll', p_run);
  perform set_config('fms.payroll_internal', 'on', true);
  update public.payroll_runs set status = 'posted', journal_id = jid where id = p_run;
  perform set_config('fms.payroll_internal', 'off', true);
  return jid;
end $$;

create or replace function public.payroll_record_payment(p_line uuid, p_status text, p_reference text default null) returns void language plpgsql as $$
begin
  if p_status not in ('pending','paid','failed') then raise exception 'Invalid payment status'; end if;
  if p_status = 'paid' and coalesce(trim(p_reference),'') = '' then raise exception 'A payment reference is required when marking as paid'; end if;
  update public.payroll_lines set payment_status = p_status, payment_reference = p_reference, paid_at = case when p_status = 'paid' then now() end
   where id = p_line and payment_posted = false;
  if not found then raise exception 'Payroll line not found or its payment is already posted to the ledger'; end if;
end $$;

-- Books the cash payment of net salaries that have been marked paid: DR net salaries payable / CR bank
create or replace function public.payroll_post_payments(p_run uuid, p_bank_account uuid, p_date date) returns uuid language plpgsql as $$
declare r public.payroll_runs; amt numeric; jid uuid; ba uuid;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status <> 'posted' then raise exception 'Post the payroll journal before recording payments'; end if;
  select account_id into ba from public.bank_accounts where id = p_bank_account;
  select coalesce(sum(net_pay),0) into amt from public.payroll_lines where run_id = p_run and payment_status = 'paid' and payment_posted = false;
  if amt <= 0 then raise exception 'No paid, unposted payroll lines'; end if;
  jid := public.create_journal(p_date, 'Salary payments ' || r.period_year || '-' || lpad(r.period_month::text,2,'0'),
    jsonb_build_array(jsonb_build_object('account_id', public.map_account('PAYROLL_NET_PAYABLE'), 'debit', amt, 'description', 'Net salaries paid'),
                      jsonb_build_object('account_id', ba, 'credit', amt, 'description', 'Net salaries paid')),
    'PAYROLLPAY-' || r.period_year || lpad(r.period_month::text,2,'0'), null, null, true, 'payroll_payment', p_run);
  update public.payroll_lines set payment_posted = true where run_id = p_run and payment_status = 'paid' and payment_posted = false;
  perform set_config('fms.payroll_internal', 'on', true);
  update public.payroll_runs set payment_journal_ids = payment_journal_ids || jid where id = p_run;
  perform set_config('fms.payroll_internal', 'off', true);
  return jid;
end $$;

-- Controlled correction: reverse the run's journals, mark the run reversed. A supplementary / new run then re-states the pay.
create or replace function public.payroll_reverse(p_run uuid, p_date date, p_reason text) returns void language plpgsql as $$
declare r public.payroll_runs; pj uuid;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.status not in ('finalized','posted') then raise exception 'Only finalized or posted runs can be reversed'; end if;
  foreach pj in array r.payment_journal_ids loop perform public.reverse_journal(pj, p_date, p_reason); end loop;
  if r.journal_id is not null then perform public.reverse_journal(r.journal_id, p_date, p_reason); end if;
  perform set_config('fms.payroll_internal', 'on', true);
  update public.payroll_runs set status = 'reversed', reversal_reason = p_reason where id = p_run;
  perform set_config('fms.payroll_internal', 'off', true);
  perform public.audit_event('payroll_reversed', jsonb_build_object('run', p_run, 'reason', p_reason));
end $$;

-- ------------------------------------------------------------------ reports
create or replace function public.rpt_payroll_register(p_run uuid)
returns table(emp_no text, full_name text, employment_type text, basic_pay numeric, allowances numeric, overtime numeric, bonus numeric, commission numeric, other_earnings numeric,
              gross_pay numeric, paye numeric, employee_pension numeric, other_deductions numeric, advance_repayment numeric, net_pay numeric, employer_pension numeric, employer_cost numeric)
language sql stable as $$
  select emp_no, full_name, employment_type, basic_pay, allowances, overtime, bonus, commission, other_earnings, gross_pay, paye, employee_pension, other_deductions, advance_repayment, net_pay, employer_pension, employer_cost
  from public.payroll_lines where run_id = p_run order by emp_no $$;

create or replace function public.rpt_payroll_earnings_deductions(p_run uuid)
returns table(item text, kind text, amount numeric) language sql stable as $$
  select 'Basic pay','earning', coalesce(sum(basic_pay),0) from public.payroll_lines where run_id = p_run
  union all select 'Allowances','earning', coalesce(sum(allowances),0) from public.payroll_lines where run_id = p_run
  union all select 'Overtime','earning', coalesce(sum(overtime),0) from public.payroll_lines where run_id = p_run
  union all select 'Bonus','earning', coalesce(sum(bonus),0) from public.payroll_lines where run_id = p_run
  union all select 'Commission','earning', coalesce(sum(commission),0) from public.payroll_lines where run_id = p_run
  union all select 'Other earnings','earning', coalesce(sum(other_earnings),0) from public.payroll_lines where run_id = p_run
  union all select 'PAYE','deduction', coalesce(sum(paye),0) from public.payroll_lines where run_id = p_run
  union all select 'Employee pension','deduction', coalesce(sum(employee_pension),0) from public.payroll_lines where run_id = p_run
  union all select 'Other deductions','deduction', coalesce(sum(other_deductions),0) from public.payroll_lines where run_id = p_run
  union all select 'Advance / loan repayment','deduction', coalesce(sum(advance_repayment),0) from public.payroll_lines where run_id = p_run
  union all select 'Employer pension','employer', coalesce(sum(employer_pension),0) from public.payroll_lines where run_id = p_run $$;

create or replace function public.rpt_payroll_net_list(p_run uuid)
returns table(emp_no text, full_name text, payment_method text, net_pay numeric, payment_status text) language sql stable as $$
  select emp_no, full_name, payment_method, net_pay, payment_status from public.payroll_lines where run_id = p_run order by emp_no $$;

create or replace function public.rpt_payroll_payment_schedule(p_run uuid, p_method text)
returns table(emp_no text, full_name text, institution text, account_or_number text, net_pay numeric, payment_status text, payment_reference text)
language sql stable as $$
  select l.emp_no, l.full_name, case when p_method = 'bank' then e.bank_name else e.momo_provider end,
         case when p_method = 'bank' then e.bank_account_number else e.momo_number end, l.net_pay, l.payment_status, l.payment_reference
  from public.payroll_lines l join public.employees e on e.id = l.employee_id where l.run_id = p_run and l.payment_method = p_method order by l.emp_no $$;

create or replace function public.rpt_payroll_statutory(p_run uuid)
returns table(emp_no text, full_name text, tin text, ssnit_no text, pensionable_pay numeric, employee_pension numeric, employer_pension numeric, taxable_pay numeric, paye numeric)
language sql stable as $$
  select l.emp_no, l.full_name, e.tin, e.ssnit_no, l.pensionable_pay, l.employee_pension, l.employer_pension, l.taxable_pay, l.paye
  from public.payroll_lines l join public.employees e on e.id = l.employee_id join public.payroll_runs r on r.id = l.run_id
  where l.run_id = p_run and r.ghana_compliance_applied is true order by l.emp_no $$;

create or replace function public.rpt_payroll_employer_cost(p_run uuid)
returns table(cost_centre text, headcount bigint, gross_pay numeric, employer_pension numeric, employer_cost numeric) language sql stable as $$
  select coalesce(c.name,'Unallocated'), count(*), sum(l.gross_pay), sum(l.employer_pension), sum(l.employer_cost)
  from public.payroll_lines l left join public.cost_centres c on c.id = l.cost_centre_id where l.run_id = p_run group by c.name order by 1 $$;

create or replace function public.rpt_payroll_temp_workers(p_year int, p_month int)
returns table(emp_no text, full_name text, employment_type text, pay_basis text, gross_pay numeric, net_pay numeric) language sql stable as $$
  select l.emp_no, l.full_name, l.employment_type, l.pay_basis, l.gross_pay, l.net_pay
  from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id
  where r.period_year = p_year and r.period_month = p_month and r.status in ('finalized','posted') and l.employment_type in ('casual','temporary') order by l.emp_no $$;

create or replace function public.rpt_payroll_variance(p_year int, p_month int)
returns table(emp_no text, full_name text, previous_net numeric, current_net numeric, change numeric) language sql stable as $$
  with cur as (select l.emp_no, l.full_name, sum(l.net_pay) n from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id
               where r.period_year = p_year and r.period_month = p_month and r.status in ('finalized','posted') group by 1,2),
       pm as (select (make_date(p_year, p_month, 1) - interval '1 month')::date d),
       prev as (select l.emp_no, sum(l.net_pay) n from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id, pm
               where r.period_year = extract(year from pm.d) and r.period_month = extract(month from pm.d) and r.status in ('finalized','posted') group by 1)
  select coalesce(cur.emp_no, prev.emp_no), cur.full_name, coalesce(prev.n,0), coalesce(cur.n,0), coalesce(cur.n,0) - coalesce(prev.n,0)
  from cur full join prev on prev.emp_no = cur.emp_no order by 1 $$;

create or replace function public.rpt_payroll_failed_payments(p_run uuid)
returns table(emp_no text, full_name text, payment_method text, net_pay numeric, payment_status text) language sql stable as $$
  select emp_no, full_name, payment_method, net_pay, payment_status from public.payroll_lines where run_id = p_run and payment_status = 'failed' order by emp_no $$;

create or replace function public.rpt_payroll_ledger_reconciliation(p_run uuid)
returns table(item text, payroll_total numeric, ledger_total numeric, difference numeric) language sql stable as $$
  with r as (select journal_id from public.payroll_runs where id = p_run),
  jl as (select a.id account_id, sum(l.base_debit) d, sum(l.base_credit) c from public.journal_lines l join public.accounts a on a.id = l.account_id where l.journal_id = (select journal_id from r) group by a.id),
  p as (select sum(gross_pay) g, sum(employer_pension) er, sum(net_pay) net, sum(paye) paye, sum(employee_pension + employer_pension) pen, sum(other_deductions) od, sum(advance_repayment) adv from public.payroll_lines where run_id = p_run),
  m as (select key, account_id from public.account_mappings)
  select x.item, x.pv, coalesce(x.lv,0), x.pv - coalesce(x.lv,0) from (
    select 'Gross pay expense' item, (select g from p) pv, (select d from jl join m on m.account_id = jl.account_id and m.key = 'PAYROLL_EXPENSE') lv
    union all select 'Employer pension expense', (select er from p), (select d from jl join m on m.account_id = jl.account_id and m.key = 'PAYROLL_PENSION_EXPENSE')
    union all select 'Net salaries payable', (select net from p), (select c from jl join m on m.account_id = jl.account_id and m.key = 'PAYROLL_NET_PAYABLE')
    union all select 'PAYE payable', (select paye from p), (select c from jl join m on m.account_id = jl.account_id and m.key = 'PAYE_PAYABLE')
    union all select 'Pension payable', (select pen from p), (select c from jl join m on m.account_id = jl.account_id and m.key = 'PENSION_PAYABLE')
    union all select 'Other deductions payable', (select od from p), (select c from jl join m on m.account_id = jl.account_id and m.key = 'PAYROLL_OTHER_DED_PAYABLE')
    union all select 'Advance / loan recoveries', (select adv from p), (select c from jl join m on m.account_id = jl.account_id and m.key = 'STAFF_ADVANCES')
  ) x $$;

create or replace function public.payslip(p_line uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'company', (select jsonb_build_object('name', display_name, 'legal_name', legal_name, 'currency', base_currency, 'code', company_code) from public.company_settings limit 1),
    'period', r.period_year || '-' || lpad(r.period_month::text, 2, '0'), 'run_status', r.status, 'compliance_applied', r.ghana_compliance_applied,
    'employee', jsonb_build_object('emp_no', l.emp_no, 'name', l.full_name, 'type', l.employment_type, 'tin', e.tin, 'ssnit_no', e.ssnit_no, 'payment_method', l.payment_method),
    'earnings', jsonb_build_object('basic', l.basic_pay, 'allowances', l.allowances, 'overtime', l.overtime, 'bonus', l.bonus, 'commission', l.commission, 'other', l.other_earnings, 'gross', l.gross_pay),
    'deductions', jsonb_build_object('paye', l.paye, 'employee_pension', l.employee_pension, 'other', l.other_deductions, 'advances', l.advance_repayment, 'total', l.total_deductions),
    'net_pay', l.net_pay, 'employer_pension', l.employer_pension)
  from public.payroll_lines l join public.payroll_runs r on r.id = l.run_id join public.employees e on e.id = l.employee_id where l.id = p_line $$;

select public._secure_tables(array['employee_cost_allocations','employees','pay_components','salary_structures','structure_components','statutory_rule_sets','payroll_runs','payroll_inputs','payroll_lines']);
select public._audit_tables(array['employee_cost_allocations','employees','pay_components','salary_structures','structure_components','statutory_rule_sets','payroll_runs','payroll_inputs','payroll_lines']);

-- Records that the accountant verified a statutory rule set against official guidance (audited via table trigger).
create or replace function public.verify_rule_set(p_id uuid, p_note text) returns void language plpgsql as $$
begin
  if coalesce(trim(p_note),'') = '' then raise exception 'A verification note (source and date) is required'; end if;
  update public.statutory_rule_sets set verified_at = now(), verified_by = coalesce((select full_name from public.profiles where id = auth.uid()), 'accountant'),
         source_note = coalesce(source_note,'') || ' | VERIFIED: ' || p_note where id = p_id;
end $$;

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
