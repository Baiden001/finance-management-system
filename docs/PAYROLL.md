# Payroll

## Scope
Monthly payroll only. Permanent, casual and temporary workers; bank and mobile-money payment methods; earnings (basic, allowances, overtime, bonus, commission, other), deductions (authorised deductions, advances/loan repayments), gross, taxable pay, employee deductions, net pay, employer contributions and total employer cost. Non-monthly workers are paid by configurable **daily, hourly, shift or work-based (unit)** rates from approved monthly inputs.

## Workflow (all enforced in `0005_payroll.sql`)
1. Create run for a month (`payroll_create_run`): active employees get an input row.
2. Enter/import attendance and variable pay; tick **approved**. Non-monthly workers require approval or the run reports a blocking exception.
3. `payroll_calculate`: snapshots the compliance setting and statutory rule ids on the run, writes lines with a per-line exceptions list. May be repeated while draft/calculated.
4. Review exceptions (`no_salary_structure`, `input_not_approved`, `negative_net`, `missing_bank`, `missing_momo`, `zero_basic`, `statutory_rule_unverified`). Errors block finalization.
5. `payroll_finalize`: locks inputs, lines and the run. Unverified rules additionally require explicit acknowledgement.
6. Payslips (PDF) and bank / mobile-money schedules; mark each line **paid** (reference required) or **failed**.
7. `payroll_post_journal`: DR gross pay and employer pension (by cost centre) / CR net salaries payable, PAYE payable, pension payable, other deductions payable, staff advances.
8. `payroll_post_payments`: DR net salaries payable / CR bank for lines marked paid.
9. Reports: register, earnings/deductions, net list, bank and MoMo schedules, statutory schedule (only when compliance was applied), employer cost, temp-worker earnings, monthly variance, failed payments, payroll-to-ledger reconciliation.

## Corrections
Finalized or posted runs are never edited. `payroll_reverse` reverses the run's payroll and payment journals (traceable, with reason) and marks the run `reversed`; restate pay with a new regular run (allowed once the earlier one is reversed) or a **supplementary** run that references the original.

## Optional Ghana payroll compliance (Settings > Company)
- **Enabled:** SSNIT employee/employer contributions and graduated PAYE are computed from **effective-dated rule sets** (`statutory_rule_sets`, `GH_PAYE`, `GH_SSNIT`) chosen by the payroll month-end. Per-employee flags `paye_applicable` and `ssnit_applicable` (e.g. off for some casual workers) apply.
- **Disabled:** no PAYE or pension is calculated automatically. Everything else (earnings, authorised deductions, payslips, schedules, ledger posting, reports) works. The UI states that disabling does not remove legal obligations.
- **Rules are data, not code.** Used rule versions are immutable and cannot be deleted; to change rates add a new version with a later `effective_from`. Each run stores which rule ids it used, so finalized payroll is never recalculated after a rule change (tested).
- **Verification:** seeded values are **placeholders** (monthly PAYE bands and 5.5% / 13% SSNIT rates as commonly published) and are marked unverified. The accountant must check them against current official GRA/SSNIT guidance and record the verification (Payroll > Statutory rules > Mark verified). Finalizing a run with unverified rules requires an explicit acknowledgement.
- **Not modelled:** concessional tax on bonuses/overtime, casual-worker flat-rate regimes, tier-2/tier-3 pension splits, tax reliefs beyond pension deduction, NHIS/other levies. Add them as new rule parameters or components after confirming current rules.
- **No filing or payment integrations.** The system produces schedules; it does not file returns or move money.
