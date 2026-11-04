# Finance Management System (Ghana)

A dual-company finance management system built on one codebase with two fully separate deployments and Supabase databases.

## 1. Project overview

| | Resilience Estate Ltd | Ash Elite Enterprise / Block Factory |
|---|---|---|
| Supabase project | `sedddarwudrsngyazifr` | `yyqzrctwbgqxhapzattj` |
| `NEXT_PUBLIC_COMPANY` | `resilience` | `ashelite` |
| Branding | Deep green and gold | Burgundy, gold and charcoal |
| Operations | Projects, properties, sales and rentals | Materials, production batches, finished blocks and equipment |
| Deployment | Pending | Pending |
| Accountant account | Not created | Not created |

Each company has its own database, Auth users, storage, secrets, audit records and backups.

There is no `company_id` in the application database. The accountant uses separate credentials for each company and must sign out before accessing the other deployment.

Management does not receive application accounts. The accountant exports PDF, XLSX and CSV reports for management.

Financial statements support summary, grouped and detailed views with comparative periods. See [docs/REPORTS.md](docs/REPORTS.md).

## 2. Current project status

### Completed and verified

- Both Supabase projects created.
- Nine migrations applied to each project.
- Resilience database has 51 public application tables.
- Ash Elite database has 57 public application tables.
- No seed data has been applied.
- Email authentication configured for both projects.
- Public sign-ups disabled.
- Email confirmation enabled.
- TOTP MFA enabled.
- Password requirements configured.
- Private `documents` and `exports` storage buckets configured.
- Local environment files created for both companies.
- Both local login pages tested successfully.
- ESLint passed.
- TypeScript checks passed.
- 88 automated tests passed.
- Resilience production build passed.
- Ash Elite production build passed.
- Git repository created and pushed to GitHub.

### Pending

- Configure SMTP for both Supabase projects.
- Create the two accountant accounts.
- Configure and deploy both Vercel projects.
- Configure production authentication URLs.
- Test login and MFA on both live deployments.
- Run live company isolation verification.
- Configure a suitable backup and recovery process.
- Test backup restoration.

See [docs/STATUS.md](docs/STATUS.md) for the detailed implementation status and limitations.

## 3. Repository structure

```text
src/                              Next.js 15 application
supabase/migrations/common/       Shared database schema
supabase/migrations/resilience/   Resilience-specific schema
supabase/migrations/ashelite/     Ash Elite-specific schema
supabase/seed/                    Optional initial data
supabase/config.toml              Supabase CLI configuration
scripts/                          Database and administration scripts
tests/db/                         Database tests using PGlite
tests/unit/                       Unit tests
public/brand/                     Company logos and login images
docs/                             Technical documentation
.env.example                      General environment template
.env.resilience.example           Resilience environment template
.env.ashelite.example             Ash Elite environment template
```

## 4. Prerequisites

- Node.js 20 or later.
- npm.
- Two Supabase projects.
- Git and GitHub.
- A hosting provider supporting Next.js deployments.
- `psql` and `pg_dump` for database backup operations.

The project was tested using Node.js 22.

## 5. Local development

Install dependencies:

```bash
npm ci
cp .env.resilience.example .env.resilience.local
cp .env.ashelite.example .env.ashelite.local
```

Start Resilience:

```bash
npm run dev:resilience
```

Open:

```text
http://localhost:3001
```

Start Ash Elite:

```bash
npm run dev:ashelite
```

Open:

```text
http://localhost:3002
```

Each script copies its company's local environment file into `.env.local` before starting Next.js.

Use separate working copies if both applications need to run simultaneously. Both scripts use `.env.local`.

Never commit local environment files or expose database passwords and service-role keys.

## 6. Environment configuration

Each deployment requires its own environment variables.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_COMPANY` | `resilience` or `ashelite` |
| `NEXT_PUBLIC_SUPABASE_URL` | Company's Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Company's legacy anon key |
| `NEXT_PUBLIC_OTHER_COMPANY_URL` | Optional link to the other deployment |
| `REQUIRE_MFA` | `true` |

`SUPABASE_DB_URL` is reserved for local database administration and migration operations.

`SUPABASE_SERVICE_ROLE_KEY` is reserved for trusted server-side administration scripts. Never add it to Vercel environment variables or expose it to browser code.

## 7. Accountant account creation

Two separate accountant accounts are required.

One account belongs to Resilience Estate Ltd. The other belongs to Ash Elite Enterprise.

Accounts have not yet been created.

The project includes:

```text
scripts/create-accountant.mjs
```

The script checks the target project's company binding before creating an account.

Account creation requires the relevant company's Supabase URL and service-role key, plus a unique email and password.

Use different credentials for both companies. Do not share credentials or commit them to GitHub.

After the first sign-in, enrol an authenticator app through:

```text
/security/mfa
```

## 8. Authentication and security

The following settings have been configured on both Supabase projects:

- Email provider enabled.
- Public sign-ups disabled.
- Email confirmation enabled.
- Secure email changes enabled.
- TOTP MFA enabled.
- Minimum password length of 12 characters.
- Uppercase, lowercase, digits and symbols required.
- Secure password changes enabled.
- Current password required for password updates.
- Private storage buckets.

SMTP is not yet configured.

Leaked-password protection is restricted by the current Supabase plan.

Production authentication URLs must be updated after deployment.

## 9. Validation and testing

The following checks have passed:

- ESLint.
- TypeScript.
- 88 automated tests across nine test files.
- Resilience production build.
- Ash Elite production build.

Run:

```bash
npm run lint
npm run typecheck
npm test
```

The command below runs the complete validation script, including production builds for both companies:

```bash
bash scripts/validate.sh
```

Note: `npm run validate` currently runs lint, typecheck, tests and one production build using the active environment. It does not automatically run both company builds.

Database tests use PGlite and do not require external Supabase connections.

## 10. Deployment

Two separate Vercel projects will be created from this repository.

Both will use the `main` branch.

### Resilience deployment

Configure:

```text
NEXT_PUBLIC_COMPANY=resilience
NEXT_PUBLIC_SUPABASE_URL=<RESILIENCE_SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<RESILIENCE_ANON_KEY>
REQUIRE_MFA=true
```

### Ash Elite deployment

Configure:

```text
NEXT_PUBLIC_COMPANY=ashelite
NEXT_PUBLIC_SUPABASE_URL=<ASHELITE_SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ASHELITE_ANON_KEY>
REQUIRE_MFA=true
```

Each deployment must have its own environment variables and production URL.

Do not add `SUPABASE_DB_URL` or `SUPABASE_SERVICE_ROLE_KEY` to either deployment.

`NEXT_PUBLIC_` variables are compiled into the application during the build process. Each deployment must therefore build for its own company.

Deployment has not yet been completed.

## 11. Live isolation verification

The repository includes:

```bash
RES_URL=<RESILIENCE_URL> \
RES_ANON=<RESILIENCE_ANON_KEY> \
RES_EMAIL=<RESILIENCE_ACCOUNTANT_EMAIL> \
RES_PASSWORD=<RESILIENCE_ACCOUNTANT_PASSWORD> \
ASH_URL=<ASHELITE_URL> \
ASH_ANON=<ASHELITE_ANON_KEY> \
ASH_EMAIL=<ASHELITE_ACCOUNTANT_EMAIL> \
ASH_PASSWORD=<ASHELITE_ACCOUNTANT_PASSWORD> \
npm run verify:isolation
```

The verification script checks:

- Each accountant can authenticate with the correct Supabase project.
- A session from one project cannot access the other company's database.
- Anonymous users cannot read financial records.
- The documents storage bucket is not publicly accessible.

This test requires both accountant accounts and live project credentials.

It has not yet been run.

## 12. Backup and recovery

The project includes:

```text
scripts/backup.sh
scripts/restore-test.sh
```

The backup process uses PostgreSQL tools.

Both Supabase projects currently use the Free Plan. Scheduled backups and Point-in-Time Recovery are not available under the current plan.

A separate backup and recovery arrangement must be established before production use.

See [docs/BACKUP_RECOVERY.md](docs/BACKUP_RECOVERY.md).

## 13. Accountant workflow

The intended workflow is:

1. Configure company details.
2. Set up accounts and cost centres.
3. Configure FX rates and bank accounts.
4. Enter opening balances.
5. Record invoices, bills, receipts and payments.
6. Import and reconcile bank statements.
7. Record assets and monthly depreciation.
8. Process payroll.
9. Lock completed financial periods.
10. Export reports for management.

## 14. Important limitations

- PAYE and SSNIT statutory values in the seed files are unverified placeholders.
- The application does not file statutory returns or make payments.
- Issued invoices and bills do not yet have a dedicated void workflow. Use a reversal journal and a replacement document where appropriate.
- Live company isolation verification has not been completed.
- Production deployment has not been completed.
- Accountant accounts have not been created.
- SMTP is not configured.
- Backup restoration has not yet been tested against production databases.

Review the documentation in `docs/` before production use.

## 15. Documentation

| Document | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Application architecture |
| [DATABASE.md](docs/DATABASE.md) | Database design and migrations |
| [SECURITY.md](docs/SECURITY.md) | Security configuration |
| [PAYROLL.md](docs/PAYROLL.md) | Payroll implementation |
| [REPORTS.md](docs/REPORTS.md) | Financial reports |
| [BACKUP_RECOVERY.md](docs/BACKUP_RECOVERY.md) | Backup and recovery |
| [STATUS.md](docs/STATUS.md) | Implementation and verification status |
