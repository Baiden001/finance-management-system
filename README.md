# Finance Management System (Ghana)

One codebase, **two fully separate deployments and databases**:

| | Resilience Estate Ltd | Ash Elite Enterprise / Block Factory |
|---|---|---|
| Supabase project | its own | its own |
| `NEXT_PUBLIC_COMPANY` | `resilience` | `ashelite` |
| Branding | supplied logo, deep green / gold | supplied logo, burgundy / gold / charcoal |
| Operations | projects, properties, sales, rentals | materials, production batches, finished blocks, equipment |

The accountant is the only application user. Management receives exported PDF/XLSX/CSV reports only. There is no `company_id` anywhere: isolation is by separate database, Auth users, storage, secrets, audit log and backups. To work in the other company the accountant logs out and signs in to the other deployment with different credentials.

Financial statements come at three levels of detail (summary, grouped, detailed) with comparative periods; see [`docs/REPORTS.md`](docs/REPORTS.md).

**Read first:** [`docs/STATUS.md`](docs/STATUS.md) says exactly what was built, what was tested, and what was *not* verified. [`docs/`](docs) also holds architecture, database, security, payroll, and backup/recovery guides.

## Repository layout

```
src/                     Next.js 15 (App Router, TypeScript) application
supabase/migrations/common/      0001-0005 shared schema, ledger, AR/AP, assets, payroll (applied to BOTH companies)
supabase/migrations/resilience/  0100 estate operations (Resilience only)
supabase/migrations/ashelite/    0100 factory operations (Ash Elite only)
supabase/seed/           safe, idempotent seeds (chart of accounts, mappings, fiscal year, components, PLACEHOLDER statutory rules)
supabase/config.toml     CLI/auth configuration template
scripts/                 apply-migrations, prepare-supabase-dir, create-accountant, verify-isolation, backup, restore-test, validate
tests/db/                database tests (run on in-process PostgreSQL via PGlite, as the `authenticated` role with RLS on)
tests/unit/              unit tests (exports, report registry vs SQL, security hygiene)
public/brand/            supplied logos (cropped/optimised)      docs/reference/  supplied UI reference images
.env.resilience.example  .env.ashelite.example  .env.example     placeholders only
```

## Prerequisites

Node 20+ (tested on 22), npm, a Supabase account (two projects), `psql`/`pg_dump` for backups, and a host that can run two Next.js deployments (Vercel, Cloudflare, a VM...).

## 1. Create two Supabase projects

Create **two separate projects**, e.g. `fms-resilience` and `fms-ashelite`, in your preferred region. Use a different strong database password for each. Do not share anything between them.

## 2. Apply the schema to each project independently

Either use the included runner (needs each project's *direct* Postgres connection string from Project Settings > Database):

```bash
npm ci
SUPABASE_DB_URL='postgresql://postgres:***@db.<RESILIENCE-REF>.supabase.co:5432/postgres' npm run db:apply -- resilience --seed
SUPABASE_DB_URL='postgresql://postgres:***@db.<ASHELITE-REF>.supabase.co:5432/postgres'    npm run db:apply -- ashelite --seed
```

`npm run db:apply -- <company> --dry-run` prints the plan. The runner records applied files in `fms_admin.migrations`, is re-runnable, and **refuses to apply a company's schema to a database already bound to the other company**.

Or use the Supabase CLI: `npm run db:prepare -- resilience` generates `build/resilience/supabase/` (timestamped migrations, `seed.sql`, `config.toml`); then `cd build/resilience && supabase link --project-ref <REF> && supabase db push`, and run `seed.sql` once in the SQL editor. Repeat for `ashelite`.

## 3. Configure Auth, Storage and security (dashboard steps; cannot be automated here)

For **each** project:

1. Authentication > Providers > Email: **disable "Allow new users to sign up"**; keep email confirmation on.
2. Authentication > Multi-factor: enable **TOTP**.
3. Authentication > Policies: minimum password length 12, require upper/lower/digits/symbols; enable leaked-password protection if your plan has it.
4. Authentication > Rate limits: keep sign-in limits tight (template in `supabase/config.toml`).
5. Authentication > URL configuration: set Site URL to that company's deployed URL only.
6. Authentication > SMTP: configure a sender for that company (password resets).
7. Storage: confirm buckets `documents` and `exports` exist and are **not public** (created by migration 0004).
8. Database > Backups: enable daily backups; enable **Point-in-Time Recovery** on paid plans. See `docs/BACKUP_RECOVERY.md`.
9. Project Settings > API: copy the URL and **anon** key into that company's deployment env only. Keep the **service-role key** out of the web deployment entirely.

## 4. Create each accountant (separate credentials per company)

```bash
SUPABASE_URL=https://<RESILIENCE-REF>.supabase.co SUPABASE_SERVICE_ROLE_KEY=*** \
ACCOUNTANT_EMAIL=accountant.resilience@yourdomain.com ACCOUNTANT_PASSWORD='<12+ chars, unique>' \
node scripts/create-accountant.mjs resilience "Full Name"
# repeat with the Ash Elite project's URL/key, a different email and a different password
```

The script confirms the project is bound to the named company before creating anything. After first sign-in, enrol an authenticator app at `/security/mfa`.

## 5. Configure branding

Branding is automatic from `NEXT_PUBLIC_COMPANY`: logo, palette, login, navigation, PDFs and exports. To adjust colours or names edit `src/lib/company.ts`; to replace a logo, overwrite `public/brand/<company>-logo.png` (keep the file name). Legal name, TIN, address etc. are edited in-app at Settings > Company.

## 6. Run locally

```bash
cp .env.resilience.example .env.local   # fill in Resilience URL + anon key
npm run dev                              # or: npm run dev:resilience (port 3001)
# second terminal / separate checkout:
cp .env.ashelite.example .env.local      # fill in Ash Elite URL + anon key
```

Use `npm run dev:resilience` and `npm run dev:ashelite` from **separate working copies** if you want both running at once, because both read `.env.local`. If a deployment's Supabase URL points at the other company's database the app shows a configuration error and refuses to operate.

## 7. Test and validate

```bash
npm run validate     # lint + typecheck + all tests + production build for both companies
npm run test:db      # database tests only (PGlite, no external services needed)
```

## 8. Deploy

Create **two deployments** of this repository (e.g. two Vercel projects), each with its own environment variables from `.env.<company>.example` (`NEXT_PUBLIC_COMPANY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `REQUIRE_MFA=true`). `NEXT_PUBLIC_*` values are compiled in at build time, so each deployment builds for exactly one company. Serve each on its own domain over HTTPS. Never add the service-role key or DB URL to these deployments.

## 9. Verify isolation (live)

```bash
RES_URL=... RES_ANON=... RES_EMAIL=... RES_PASSWORD=... ASH_URL=... ASH_ANON=... ASH_EMAIL=... ASH_PASSWORD=... npm run verify:isolation
```

It checks that each accountant can sign in only to their own company, that a session token from one project cannot read the other, that anonymous users cannot read ledgers, and that the documents bucket is not public. **This script requires your two live projects and has not been run by the author.**

## 10. Test backup and recovery

Follow `docs/BACKUP_RECOVERY.md`: `scripts/backup.sh` per company, then `scripts/restore-test.sh` into a scratch database, which verifies the checksum and that the restored ledger balances.

## Day-to-day flow (accountant)

Set up accounts, cost centres, FX rates, bank accounts and opening balances (Settings; Transactions) > record invoices, bills, receipts and payments > import bank statements and reconcile > run monthly depreciation > run payroll (Payroll) > lock the period (Settings > Fiscal periods) > export reports for management (Reports).

## Important limitations

See `docs/STATUS.md`. In particular: statutory PAYE/SSNIT values shipped in the seed are **unverified placeholders**; the system does **not** file returns or make payments; no void workflow for issued invoices/bills yet (use a reversal journal plus a new document); live Supabase behaviour has not been verified by the author.
