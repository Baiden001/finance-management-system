# Database guide

Migrations (apply in this order; `scripts/lib-migrations.mjs` is the single source of ordering):

| File | Contents |
|---|---|
| common/0001_core | `company_settings`, `profiles`, `is_accountant()`, append-only `audit_log` + generic audit trigger (redacts bank/momo numbers), `_secure_tables` / `_audit_tables` helpers, default function privileges |
| common/0002_ledger | fiscal years/periods (no overlap), cost centres, chart of accounts, account mappings, FX rates, `journals`/`journal_lines`, posting trigger, `create_journal`, `post_journal`, `reverse_journal`, `set_period_status`, trial balance, GL, income statement, balance sheet, cash flow, journal listing, expense report, tax schedule |
| common/0003_ar_ap_banking | customers, suppliers, invoices/bills + lines, payments + allocations (realised FX), bank accounts, statement lines, reconciliations, aging reports |
| common/0004_assets_budgets_fx_docs | fixed assets, depreciation, disposal, budgets, FX schedule + unrealised revaluation, attachments, append-only `report_exports`, storage buckets/policies |
| common/0005_payroll | employees, components, effective-dated salary structures, versioned statutory rule sets, runs/inputs/lines, calculate/finalize/post/pay/reverse, payroll reports, payslip |
| resilience/0100_estate_ops | projects (own cost centre), properties, sales (revenue + cost of sale), rentals, profitability, rental roll |
| ashelite/0100_factory_ops | materials, products, movements, batches, weighted-average costing, COGS, equipment, maintenance, cost-per-block, inventory valuation |

## Rules enforced in the database
- Debits = credits in transaction **and** base currency (<= 0.05 rounding absorbed on the largest line; anything larger rejected).
- Money is `numeric(20,4)`; rates `numeric(20,10)`. No floats.
- Posted/reversed journals and their lines cannot be updated or deleted. Only `reverse_journal` may flip `posted` to `reversed` (guarded by a transaction-local setting and a column-diff check).
- Posting into `closed` or `locked` periods is rejected; re-opening a locked period needs a reason and is audited.
- Issued invoices / approved bills / payments / depreciation entries / completed batches / finalized payroll are immutable.
- Allocation cannot exceed the open balance; allocation currency must equal payment currency.
- `audit_log` and `report_exports` are append-only (triggers; no UPDATE/DELETE/TRUNCATE; clients have SELECT only).
- Every table has RLS enabled with a single policy: signed-in user **and** `is_accountant()`. `anon` has no table or function privileges.

## Accounting conventions
- Ledger = journals with status `posted` or `reversed` (a reversal offsets its original).
- Retained earnings on the balance sheet are derived (cumulative income less expenses); no year-end closing entries are required.
- Opening balances are ordinary journals (use source reference "opening" and the Opening Balance Equity account).
- Cash flow uses the **direct method**: each non-cash line in a journal touching a cash account is classified by that account's `cash_flow_category`.
- FX: documents carry a rate at issue; receipts/payments compute realised FX against the document rate; `revalue_foreign_accounts(date)` posts unrealised FX for foreign-currency accounts (not auto-reversed).
- Depreciation: straight-line monthly from the month of acquisition, capped at cost less residual.
- Seeded account mappings (`account_mappings`) route system postings; change them in Settings.
