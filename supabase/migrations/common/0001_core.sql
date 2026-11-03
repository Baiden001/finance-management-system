-- 0001_core: settings, profiles, authorization helper, audit log, security helpers.
-- Applied independently to EACH company's own Supabase project.

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

create table public.company_settings (
  id boolean primary key default true check (id),
  company_code text not null check (company_code in ('resilience','ashelite')),
  legal_name text not null,
  display_name text not null,
  base_currency char(3) not null default 'GHS',
  ghana_payroll_compliance boolean not null default false,
  ghana_compliance_changed_at timestamptz,
  tin text, address text, phone text, email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'accountant' check (role in ('accountant','disabled')),
  created_at timestamptz not null default now()
);

create or replace function public.is_accountant() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'accountant');
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger trg_company_settings_touch before update on public.company_settings
for each row execute function public.touch_updated_at();

-- company identity is fixed once set; compliance toggle changes are timestamped
create or replace function public.company_settings_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.company_code <> old.company_code then
      raise exception 'company_code cannot be changed (database is bound to company %)', old.company_code;
    end if;
    if new.ghana_payroll_compliance is distinct from old.ghana_payroll_compliance then
      new.ghana_compliance_changed_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger trg_company_settings_guard before update on public.company_settings
for each row execute function public.company_settings_guard();

-- ---------------------------------------------------------------- audit log
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  table_name text,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  meta jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_table_idx on public.audit_log (table_name, record_id);

create or replace function public.audit_redact(j jsonb) returns jsonb language sql immutable as $$
  select case when j is null then null
         else j - array['bank_account_number','momo_number','account_number','password']::text[] end
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  if tg_op = 'DELETE' then rid := to_jsonb(old)->>'id'; else rid := to_jsonb(new)->>'id'; end if;
  insert into public.audit_log(actor, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name, rid,
          case when tg_op in ('UPDATE','DELETE') then public.audit_redact(to_jsonb(old)) end,
          case when tg_op in ('INSERT','UPDATE') then public.audit_redact(to_jsonb(new)) end);
  return null;
end $$;

create or replace function public.audit_event(p_action text, p_meta jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_accountant() then raise exception 'Not authorised'; end if;
  insert into public.audit_log(actor, action, meta) values (auth.uid(), p_action, p_meta);
end $$;

create or replace function public.audit_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger trg_audit_immutable before update or delete on public.audit_log
for each row execute function public.audit_log_immutable();
create trigger trg_audit_no_truncate before truncate on public.audit_log
for each statement execute function public.audit_log_immutable();

-- ----------------------------------------------------- security helper fns
create or replace function public._secure_tables(tbls text[]) returns void language plpgsql as $$
declare t text;
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists accountant_all on public.%I', t);
    execute format('create policy accountant_all on public.%I for all to authenticated using (public.is_accountant()) with check (public.is_accountant())', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create or replace function public._audit_tables(tbls text[]) returns void language plpgsql as $$
declare t text;
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

select public._secure_tables(array['company_settings','profiles']);
select public._audit_tables(array['company_settings','profiles']);

-- audit log: read-only to the accountant
alter table public.audit_log enable row level security;
create policy audit_read on public.audit_log for select to authenticated using (public.is_accountant());
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- API exposure: only signed-in users may execute functions; anonymous and PUBLIC may not.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
