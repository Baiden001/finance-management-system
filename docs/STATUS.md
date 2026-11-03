# Feature and test status

Generated for PRD v2.0 (29 Oct 2026). "Verified" means executed and passing in the author's sandbox. Nothing below is claimed beyond that.

## Added in the second round (statements, documents, extra features)
- **Three-level statements** (summary / grouped / detailed) for the balance sheet, income statement and cash flow (direct and indirect), comparative periods, drill-down to the ledger, notes to the statements, branded PDF/Excel/CSV exports. See `docs/REPORTS.md`.
- **Printable** receipts, payment vouchers, invoices, credit/debit notes, customer statements, delivery notes.
- **Documents:** credit notes and supplier debit notes, voiding unsettled invoices/bills, retention on contractor bills, withholding tax on payments, VAT and withholding schedules.
- **Ledger tools:** recurring entries, guided opening balances, CSV import (customers, suppliers, chart of accounts, employees), fiscal-year close.
- **Resilience:** buyer instalment plans with a FIFO schedule, customer deposits, agent commissions, project cost allocation.
- **Ash Elite:** delivery notes, customer price lists, credit limits enforced at invoicing, recipes, stock counts, sales returns.
- **Login screens** use the supplied photographs (block yard for Ash Elite, house at sunset for Resilience).
- Screenshots of the new statements, receipt and login screens were taken against the real app running on a stand-in backend with fictional demo data (not a live Supabase project). The other new screens (credit-note, void, retention, recurring, deposits, plans, price list, stock count, returns forms) are covered by database tests but were **not** individually viewed in a browser.

## Validation actually run (all passed)
- `npm run lint` (ESLint, Next config): clean.
- `npm run typecheck` (tsc strict): clean.
- `npm test`: **68 tests passed** (54 database + 14 unit), see below.
- `next build` for **both** companies (`resilience`, `ashelite`): succeeded.
- Runtime smoke test of a built server: `/api/health` OK, `/login` renders with the correct company palette and logo, unauthenticated `/dashboard` and `/api/export` redirect to `/login`, security headers present. Screenshot of the Resilience login page reviewed.

## Database tests (54) — PostgreSQL via PGlite, run as the `authenticated` role with RLS on
Both companies' migration sets apply cleanly from empty (including seeds). Covered: unbalanced / single-line / debit+credit lines rejected; posting metadata; exact decimal money; posted journals and lines immutable (update, delete, insert); drafts editable; reversal with reason, mirror entry, net-zero, double-reversal blocked; locked/closed periods reject posting, reopen needs a reason; dates outside periods; inactive accounts; trial balance balances; balance sheet equation; cash-flow reconciles opening to closing; RLS denies non-accountants and `anon`; function exposure (anon cannot call RPCs or forge audit events); append-only audit log with actor; company identity immutable; storage buckets private with accountant-only policy; invoices (tax, locking, issued immutability); receipts with allocation, over-allocation rejected; AR aging equals control account; bills and AP aging equals control account; USD invoice with realised FX gain; currency-mismatch rejection; unrealised FX revaluation and schedule reconciling to zero; bank statement matching and reconciliation (completes only at zero difference); fixed-asset depreciation (monthly, idempotent, capped, terms locked), disposal gain, delete blocked; budget vs actual; export log append-only; payroll with Ghana compliance **disabled** and **enabled** (SSNIT 5.5%/13%, PAYE worked example 904.75), casual daily-rate and unapproved-input exceptions, negative-net exception, unverified-rule acknowledgement, finalize/lock (lines, inputs, run frozen), journal balanced and equal to the payroll register (ledger reconciliation zero), payment tracking and payment journal, MoMo/bank schedules, payslip data, audit redaction of account numbers, one regular run per month, **historical stability** (used rule versions immutable; later rule version changes only later months; finalized month untouched and not recalculable), no-rule-for-month error, compliance toggle audited, reversal + supplementary run, cost-centre allocation split (exact, 100% check), salary-structure history immutable; Resilience property sale / cost of sale / project profitability / rent invoicing; Ash Elite weighted-average costing, batch costing, stock tracking, COGS, over-draw blocked, write-off, perpetual-inventory ledger agreement; two-database isolation and schema separation, no `company_id`.

## Unit tests (14)
Branding assets and palettes; company-specific navigation; every report maps to a real SQL function with matching parameters for each company and no cross-company leakage; payroll reports flagged sensitive; CSV/XLSX/PDF/payslip generation and formula-injection guard; helpers; rate limiter; no service-role key in `src/`; env examples contain placeholders only; every created table is RLS-secured; no `company_id` in migrations.

## Feature status
| PRD area | Status |
|---|---|
| Two isolated company environments, shared codebase, binding guard | Built; DB isolation tested; **live two-project check not run** |
| Chart of accounts, fiscal years/periods, cost centres, FX rates | Built + tested |
| Double-entry journals, balanced posting, reversals, period locks, audit | Built + tested |
| Invoices, bills, receipts, supplier payments, AR/AP, aging | Built + tested |
| Cash/bank, statement import (CSV), matching, reconciliation | Built; matching/reconciliation tested in DB; CSV import UI not browser-tested |
| Multi-currency, realised and unrealised FX | Built + tested |
| Fixed assets, depreciation, disposal | Built + tested |
| Budgets, budget vs actual, cost centres | Built + tested |
| Attachments (private storage, signed URLs) | Built; DB policy tested on a stub schema; **upload/download not run against real Storage** |
| Financial reports (TB, IS, BS, cash flow, GL, journals, aging, bank rec, assets, budget, expense, FX, tax) | SQL tested; PDF/XLSX/CSV generation tested; **UI preview/export not exercised against a live backend** |
| Payroll (monthly; permanent/casual/temporary; bank + MoMo; payslips; schedules; journals; reports) | Built + tested |
| Optional Ghana payroll compliance, effective-dated rules, verification gate | Built + tested; **rate values are unverified placeholders** |
| Resilience Estate operations (projects, properties, sales, rentals, profitability) | Built + tested (DB); UI forms not browser-tested |
| Ash Elite operations (materials, batches, stock, COGS, equipment, cost per block) | Built + tested (DB); UI forms not browser-tested |
| Exports with branding, restricted payroll exports, export audit | Built; MFA gate and audit implemented; not run live |
| Auth, MFA enrolment, logout confirmation, security headers | Built; sign-in/MFA **not run against Supabase Auth** |
| Backup / recovery scripts and docs | Written; **never executed** (no pg_dump/live DB in sandbox) |

## Not verified / not done
- No live Supabase project was available. `apply-migrations.mjs`, `create-accountant.mjs`, `verify-isolation.mjs`, `backup.sh`, `restore-test.sh`, Auth/MFA flows, real Storage, and PostgREST behaviour were **not executed**. Database tests ran on PGlite (embedded PostgreSQL) with stubbed `auth`/`storage` schemas and roles, not on Supabase's own Postgres.
- Authenticated screens (dashboard, forms, payroll run page, reports page) were type-checked and built but **not visually reviewed or browser-tested** against data. Only the login page was screenshotted. Expect some layout/behaviour polish when first run live.
- UI fidelity: layout hierarchy, navigation, KPI cards, charts, tables, quick actions, audit/settings/logout follow the reference; it is not pixel-matched, and the login hero uses a gradient rather than photography (no licensed images were supplied). The Resilience logo supplied is small (292 px wide) and looks soft when enlarged; a higher-resolution file would improve PDFs and the login page.
- Statutory PAYE/SSNIT parameters are placeholders and must be verified against official guidance.
- Not implemented: void workflow for issued invoices/bills and credit notes (correct via reversal journal + new document; a reversed invoice's document status is not changed automatically); automatic goods-received posting for raw materials (purchase by bill, then receive stock manually); year-end closing entries (not needed because retained earnings are derived); recurring invoices; electronic filing and automatic payments (explicitly out of scope); Supabase generated TypeScript types; CSP header; database-level AAL2 enforcement; column-level encryption of bank details; browser E2E tests; load/performance tests.
