-- 0008_roles: read-only CEO role.
-- The CEO signs in to THIS company's deployment only and may VIEW financial results (dashboard and
-- non-payroll reports). The CEO can never write: no insert/update/delete policy grants it anything,
-- except logging their own non-sensitive report exports. Payroll, employees, bank statement lines,
-- reconciliations, attachments, recurring entries and the audit log stay accountant-only.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('accountant','ceo','disabled'));

create or replace function public.is_ceo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ceo');
$$;

-- Role of the signed-in user for the app's UI and route guards ('accountant', 'ceo' or null).
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.role in ('accountant','ceo');
$$;

-- Adds a SELECT-only policy for the CEO to each listed table (idempotent; skips tables that do not exist).
create or replace function public._ceo_read(tbls text[]) returns void language plpgsql as $$
declare t text;
begin
  foreach t in array tbls loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists ceo_read on public.%I', t);
    execute format('create policy ceo_read on public.%I for select to authenticated using (public.is_ceo())', t);
  end loop;
end $$;

select public._ceo_read(array[
  'company_settings',
  'fiscal_years','fiscal_periods','cost_centres','accounts','account_mappings','fx_rates','journals','journal_lines',
  'customers','suppliers','invoices','invoice_lines','bills','bill_lines','bank_accounts','payments','payment_allocations',
  'credit_notes','credit_note_lines','document_credits',
  'fixed_assets','depreciation_entries','budgets',
  'statement_groups','report_notes'
]);

-- The CEO may read only their own profile row.
drop policy if exists ceo_own_profile on public.profiles;
create policy ceo_own_profile on public.profiles for select to authenticated using (public.is_ceo() and id = auth.uid());

-- The CEO's exports are logged like the accountant's, but never for restricted (payroll) reports.
drop policy if exists ceo_log_export on public.report_exports;
create policy ceo_log_export on public.report_exports for insert to authenticated with check (public.is_ceo() and not sensitive and exported_by = auth.uid());
drop policy if exists ceo_own_exports on public.report_exports;
create policy ceo_own_exports on public.report_exports for select to authenticated using (public.is_ceo() and exported_by = auth.uid());

revoke execute on function public.is_ceo(), public.app_role(), public._ceo_read(text[]) from public, anon;
grant execute on function public.is_ceo(), public.app_role() to authenticated;
revoke execute on function public._ceo_read(text[]) from authenticated;
