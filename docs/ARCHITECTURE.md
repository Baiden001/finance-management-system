# Architecture

## Isolation model
- **Shared codebase, separate everything else.** One Next.js app is deployed twice. `NEXT_PUBLIC_COMPANY` (compiled in) selects branding and navigation; `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` point at that company's own Supabase project.
- Each project has its own Postgres, Auth users and sessions, Storage buckets, secrets, audit log, configuration and backups.
- **No `company_id` multi-tenancy.** A unit test asserts no migration contains `company_id`, and that company-specific tables exist only in that company's schema.
- **Binding guard:** `company_settings.company_code` is set by the seed and cannot be changed (trigger). The app layout compares it to `NEXT_PUBLIC_COMPANY` on every page and shows a configuration error on mismatch; `apply-migrations` and `create-accountant` refuse to act on a database bound to the other company.
- Logging out of one deployment and into the other requires different credentials because the Auth user tables are different projects.

## Layers
1. **PostgreSQL (authoritative).** All accounting rules live in SQL: balanced posting, period locks, immutability, reversals, document issuing, payment allocation, depreciation, FX revaluation, payroll calculation/finalization/posting, inventory costing. Functions run with the caller's rights (SECURITY INVOKER) so RLS always applies. The UI cannot bypass a rule because the rules are triggers and constraints.
2. **Next.js server (Route Handlers, Server Components).** Session handling (`@supabase/ssr`), MFA enforcement, report export (PDF/XLSX/CSV), payslips, rate limiting, export audit. Uses the user's session and anon key only.
3. **Browser.** Forms and tables call Supabase with the user's session; RLS decides access.

There are **no Supabase Edge Functions**: everything that needs trusted execution is either a Postgres function/trigger or a Next.js route handler, which keeps secrets out of the browser and avoids a third runtime. `scripts/` holds admin tooling that uses the service-role key and is never imported by the app (enforced by a test).

## Data flow for a posting
UI > `rpc('create_journal')` > insert draft + lines (line trigger derives base amounts) > `UPDATE status='posted'` > journal trigger checks: period open, >= 2 lines, balanced in transaction and base currency, accounts postable > immutable afterwards. Corrections: `reverse_journal` creates a linked mirror entry and marks the original `reversed`.

## Reports
Pure SQL functions `rpt_*` (stable, invoker rights). `src/lib/reports.ts` is the single registry of reports (title, parameters, columns, sensitivity, company scope); a unit test checks each entry against the real SQL signature. Export route re-runs the function with the user's session, builds the file, hashes it, and writes `report_exports` + audit entry.

## UI
Layout hierarchy follows the supplied reference (sidebar navigation, KPI cards, charts, tables, quick actions, audit log, settings, logout confirmation) using the correct brand per company. Charts are inline SVG rendered from live query results on the server. Tables are server-rendered first and hydrate afterwards. The reference images are layout guidance only; the generic blue "Finance Portal" mockup's in-app company switcher was intentionally **not** implemented because it contradicts the PRD's logout/login rule.
