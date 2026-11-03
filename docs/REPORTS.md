# Financial statements and documents

## Three levels of detail (balance sheet, income statement, cash flow)
Choose the level on the Reports page or in the export:

| Level | Shows | Example (balance sheet) |
|---|---|---|
| 1 Summary | headline totals only | Total assets, total liabilities, total equity, total liabilities and equity |
| 2 Grouped | groups with sub-totals plus the headline totals | Current assets, Non-current assets, Current liabilities, Total equity ... |
| 3 Detailed | every account (code, name, amount) under its group | Bank - Main Account, Accounts Receivable ... ; click an account to open its general ledger |

- **Comparative period:** tick "Compare with a prior period" to add a second column (prior year by default; any dates can be chosen).
- **Income statement:** Revenue, cost of sales, **gross profit**, other income, operating expenses, **operating profit**, other expenses, finance costs, **profit before tax**, income tax, **net profit**.
- **Balance sheet:** assets (current / non-current), liabilities (current / non-current), equity including derived retained earnings, a balance check line (must be 0.00).
- **Cash flow:** **indirect** (from net profit, with depreciation add-back and working-capital changes) or **direct** (cash receipts and payments by account). Both reconcile to ledger cash; the last line shows any difference (must be nil).
- **Grouping:** by default from account type, subtype and code range (5xxx cost of sales, 6xxx operating expenses, 7xxx other, 8xxx tax). Override any account via `accounts.statement_group`.
- **Notes:** Settings > Statement notes. Text is printed under the statement in PDF and Excel exports.
- Implemented in `supabase/migrations/common/0006_statements.sql` (`rpt_balance_sheet_levels`, `rpt_income_statement_levels`, `rpt_cash_flow_levels`).

Limits: cost-of-sales grouping is by account code (5xxx); unrealised FX on cash is included in profit rather than shown as a separate "effect of exchange rates" line; no segment or consolidated reporting.

## Printable documents (PDF, branded per company)
Receipts and vouchers: every customer payment has an Official Receipt (invoice(s) it settled, balance remaining, tax withheld, amount in words, signature lines); every supplier payment has a Payment Voucher. Also: invoices, credit and debit notes, customer statements of account, delivery notes (Ash Elite), payslips. Opened through `/api/doc?type=receipt|invoice|credit_note|statement|delivery_note&id=...`; each print is audit-logged.

## Tax schedules
VAT / levies return schedule (output and input tax by rate, net payable) and a withholding tax schedule. Withholding is recorded when a payment is posted (amount entered by the accountant); the system does not calculate WHT rates or file returns.
