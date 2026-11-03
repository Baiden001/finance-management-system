import type { CompanyCode } from './company';

export type ParamName = 'from' | 'to' | 'as_of' | 'run' | 'year' | 'month' | 'account' | 'bank' | 'statement_balance' | 'method' | 'level' | 'compare_as_of' | 'compare_from' | 'compare_to';
export type ColType = 'text' | 'money' | 'number' | 'date' | 'pct';
export interface Col { key: string; label: string; type?: ColType }
export interface ReportDef {
  key: string; title: string; group: string; rpc: string; params: ParamName[]; cols: Col[];
  sensitive?: boolean; company?: CompanyCode; landscape?: boolean;
  optional?: ParamName[]; statement?: boolean;
}
const t = (key: string, label: string): Col => ({ key, label, type: 'text' });
const m = (key: string, label: string): Col => ({ key, label, type: 'money' });
const d = (key: string, label: string): Col => ({ key, label, type: 'date' });
const n = (key: string, label: string): Col => ({ key, label, type: 'number' });

export const REPORTS: ReportDef[] = [
  { key: 'trial_balance', title: 'Trial Balance', group: 'Financial statements', rpc: 'rpt_trial_balance', params: ['from', 'to'],
    cols: [t('code', 'Code'), t('name', 'Account'), t('type', 'Type'), m('opening', 'Opening'), m('debit', 'Debit'), m('credit', 'Credit'), m('closing', 'Closing')] },
  { key: 'balance_sheet', title: 'Balance Sheet (statement of financial position)', group: 'Financial statements', rpc: 'rpt_balance_sheet_levels', statement: true, params: ['level', 'as_of', 'compare_as_of'], optional: ['compare_as_of'],
    cols: [t('label', 'Line'), t('code', 'Code'), m('amount', 'Current'), m('compare_amount', 'Comparative')] },
  { key: 'income_statement', title: 'Income Statement (profit or loss)', group: 'Financial statements', rpc: 'rpt_income_statement_levels', statement: true, params: ['level', 'from', 'to', 'compare_from', 'compare_to'], optional: ['compare_from', 'compare_to'],
    cols: [t('label', 'Line'), t('code', 'Code'), m('amount', 'Current period'), m('compare_amount', 'Comparative period')] },
  { key: 'cash_flow', title: 'Cash Flow Statement', group: 'Financial statements', rpc: 'rpt_cash_flow_levels', statement: true, params: ['level', 'from', 'to', 'method', 'compare_from', 'compare_to'], optional: ['compare_from', 'compare_to'],
    cols: [t('label', 'Line'), t('code', 'Code'), m('amount', 'Current period'), m('compare_amount', 'Comparative period')] },
  { key: 'general_ledger', title: 'General Ledger', group: 'Ledger', rpc: 'rpt_general_ledger', params: ['account', 'from', 'to'],
    cols: [d('entry_date', 'Date'), n('journal_no', 'JE #'), t('description', 'Description'), t('reference', 'Reference'), m('debit', 'Debit'), m('credit', 'Credit'), m('balance', 'Balance')] },
  { key: 'journal_listing', title: 'Journal Listing', group: 'Ledger', rpc: 'rpt_journal_listing', params: ['from', 'to'], landscape: true,
    cols: [n('journal_no', 'JE #'), d('entry_date', 'Date'), t('status', 'Status'), t('source_type', 'Source'), t('description', 'Description'), t('account_code', 'Acct'), t('account_name', 'Account'), m('debit', 'Debit'), m('credit', 'Credit')] },
  { key: 'ar_aging', title: 'Accounts Receivable Aging', group: 'Receivables & payables', rpc: 'rpt_ar_aging', params: ['as_of'],
    cols: [t('customer', 'Customer'), m('current_amt', 'Current'), m('d1_30', '1-30'), m('d31_60', '31-60'), m('d61_90', '61-90'), m('over_90', '90+'), m('total', 'Total')] },
  { key: 'ap_aging', title: 'Accounts Payable Aging', group: 'Receivables & payables', rpc: 'rpt_ap_aging', params: ['as_of'],
    cols: [t('supplier', 'Supplier'), m('current_amt', 'Current'), m('d1_30', '1-30'), m('d31_60', '31-60'), m('d61_90', '61-90'), m('over_90', '90+'), m('total', 'Total')] },
  { key: 'bank_reconciliation', title: 'Bank Reconciliation', group: 'Bank', rpc: 'rpt_bank_reconciliation', params: ['bank', 'as_of', 'statement_balance'],
    cols: [t('section', 'Section'), d('item_date', 'Date'), t('description', 'Description'), m('amount', 'Amount')] },
  { key: 'asset_schedule', title: 'Fixed Asset Schedule', group: 'Assets & budgets', rpc: 'rpt_asset_schedule', params: ['as_of'], landscape: true,
    cols: [t('tag', 'Tag'), t('name', 'Asset'), t('category', 'Category'), d('acquisition_date', 'Acquired'), m('cost', 'Cost'), m('accumulated', 'Accum. depreciation'), m('net_book_value', 'Net book value'), t('status', 'Status')] },
  { key: 'budget_vs_actual', title: 'Budget vs Actual', group: 'Assets & budgets', rpc: 'rpt_budget_vs_actual', params: ['from', 'to'],
    cols: [t('account_code', 'Code'), t('account_name', 'Account'), m('budget', 'Budget'), m('actual', 'Actual'), m('variance', 'Variance'), { key: 'variance_pct', label: 'Var %', type: 'pct' }] },
  { key: 'expense_report', title: 'Expense Report', group: 'Assets & budgets', rpc: 'rpt_expense_report', params: ['from', 'to'],
    cols: [t('account_code', 'Code'), t('account_name', 'Account'), t('cost_centre', 'Cost centre'), m('amount', 'Amount')] },
  { key: 'vat_return', title: 'VAT / Levies Return Schedule', group: 'Tax & FX', rpc: 'rpt_vat_return', params: ['from', 'to'],
    cols: [t('section', 'Section'), { key: 'rate', label: 'Rate %', type: 'number' }, m('base_amount', 'Value (excl. tax)'), m('tax_amount', 'Tax')] },
  { key: 'wht_schedule', title: 'Withholding Tax Schedule', group: 'Tax & FX', rpc: 'rpt_wht_schedule', params: ['from', 'to'], landscape: true,
    cols: [d('payment_date', 'Date'), t('direction', 'Direction'), t('party', 'Party'), t('reference', 'Reference'), m('gross_amount', 'Gross'), m('tax_withheld', 'Tax withheld'), m('cash_amount', 'Cash paid / received')] },
  { key: 'fx_schedule', title: 'FX Revaluation Schedule', group: 'Tax & FX', rpc: 'rpt_fx_schedule', params: ['as_of'], landscape: true,
    cols: [t('account_code', 'Code'), t('account_name', 'Account'), t('currency', 'Cur'), n('foreign_balance', 'Foreign balance'), n('rate', 'Rate'), m('revalued_base', 'Revalued (base)'), m('carrying_base', 'Carrying (base)'), m('difference', 'Difference')] },
  { key: 'tax_schedule', title: 'Tax Schedule (VAT / levies)', group: 'Tax & FX', rpc: 'rpt_tax_schedule', params: ['from', 'to'],
    cols: [t('account_code', 'Code'), t('account_name', 'Account'), m('debit', 'Debit'), m('credit', 'Credit'), m('net_payable', 'Net payable')] },
  // payroll (restricted + audited)
  { key: 'payroll_register', title: 'Payroll Register', group: 'Payroll', rpc: 'rpt_payroll_register', params: ['run'], sensitive: true, landscape: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), t('employment_type', 'Type'), m('basic_pay', 'Basic'), m('allowances', 'Allow.'), m('overtime', 'OT'), m('bonus', 'Bonus'), m('commission', 'Comm.'), m('gross_pay', 'Gross'), m('paye', 'PAYE'), m('employee_pension', 'Emp. pension'), m('other_deductions', 'Other ded.'), m('advance_repayment', 'Advances'), m('net_pay', 'Net'), m('employer_cost', 'Employer cost')] },
  { key: 'payroll_earnings_deductions', title: 'Earnings & Deductions Summary', group: 'Payroll', rpc: 'rpt_payroll_earnings_deductions', params: ['run'], sensitive: true,
    cols: [t('item', 'Item'), t('kind', 'Kind'), m('amount', 'Amount')] },
  { key: 'payroll_net_list', title: 'Net Salary List', group: 'Payroll', rpc: 'rpt_payroll_net_list', params: ['run'], sensitive: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), t('payment_method', 'Method'), m('net_pay', 'Net pay'), t('payment_status', 'Status')] },
  { key: 'payroll_bank_schedule', title: 'Bank Transfer Schedule', group: 'Payroll', rpc: 'rpt_payroll_payment_schedule', params: ['run'], sensitive: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), t('institution', 'Bank'), t('account_or_number', 'Account'), m('net_pay', 'Net pay'), t('payment_status', 'Status'), t('payment_reference', 'Reference')] },
  { key: 'payroll_momo_schedule', title: 'Mobile Money Schedule', group: 'Payroll', rpc: 'rpt_payroll_payment_schedule', params: ['run'], sensitive: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), t('institution', 'Network'), t('account_or_number', 'Number'), m('net_pay', 'Net pay'), t('payment_status', 'Status'), t('payment_reference', 'Reference')] },
  { key: 'payroll_statutory', title: 'Statutory Schedule (PAYE / SSNIT)', group: 'Payroll', rpc: 'rpt_payroll_statutory', params: ['run'], sensitive: true, landscape: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), t('tin', 'TIN'), t('ssnit_no', 'SSNIT no.'), m('pensionable_pay', 'Pensionable'), m('employee_pension', 'Employee'), m('employer_pension', 'Employer'), m('taxable_pay', 'Taxable'), m('paye', 'PAYE')] },
  { key: 'payroll_employer_cost', title: 'Employer Cost by Cost Centre', group: 'Payroll', rpc: 'rpt_payroll_employer_cost', params: ['run'], sensitive: true,
    cols: [t('cost_centre', 'Cost centre'), n('headcount', 'Headcount'), m('gross_pay', 'Gross'), m('employer_pension', 'Employer pension'), m('employer_cost', 'Employer cost')] },
  { key: 'payroll_temp_workers', title: 'Casual & Temporary Worker Earnings', group: 'Payroll', rpc: 'rpt_payroll_temp_workers', params: ['year', 'month'], sensitive: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Worker'), t('employment_type', 'Type'), t('pay_basis', 'Basis'), m('gross_pay', 'Gross'), m('net_pay', 'Net')] },
  { key: 'payroll_variance', title: 'Monthly Payroll Variance', group: 'Payroll', rpc: 'rpt_payroll_variance', params: ['year', 'month'], sensitive: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), m('previous_net', 'Previous net'), m('current_net', 'Current net'), m('change', 'Change')] },
  { key: 'payroll_failed_payments', title: 'Failed Payments', group: 'Payroll', rpc: 'rpt_payroll_failed_payments', params: ['run'], sensitive: true,
    cols: [t('emp_no', 'No.'), t('full_name', 'Employee'), t('payment_method', 'Method'), m('net_pay', 'Net pay'), t('payment_status', 'Status')] },
  { key: 'payroll_ledger_reconciliation', title: 'Payroll-to-Ledger Reconciliation', group: 'Payroll', rpc: 'rpt_payroll_ledger_reconciliation', params: ['run'], sensitive: true,
    cols: [t('item', 'Item'), m('payroll_total', 'Payroll'), m('ledger_total', 'Ledger'), m('difference', 'Difference')] },
  // Resilience Estate
  { key: 'project_profitability', title: 'Project Profitability', group: 'Operations', rpc: 'rpt_project_profitability', params: ['from', 'to'], company: 'resilience',
    cols: [t('project_code', 'Code'), t('project_name', 'Project'), m('budget', 'Budget'), m('revenue', 'Revenue'), m('costs', 'Costs'), m('profit', 'Profit'), { key: 'budget_used_pct', label: 'Budget used %', type: 'pct' }] },
  { key: 'property_sales', title: 'Property Sales', group: 'Operations', rpc: 'rpt_property_sales', params: ['from', 'to'], company: 'resilience', landscape: true,
    cols: [d('sale_date', 'Date'), t('property_code', 'Code'), t('property_name', 'Property'), t('customer', 'Customer'), m('price', 'Price'), t('invoice_number', 'Invoice'), m('received', 'Received'), m('outstanding', 'Outstanding')] },
  { key: 'instalment_schedule', title: 'Buyer Instalment Schedule', group: 'Operations', rpc: 'rpt_instalment_schedule', params: ['as_of'], company: 'resilience', landscape: true,
    cols: [t('property', 'Property'), t('customer', 'Buyer'), n('seq', 'No.'), d('due_date', 'Due'), m('amount', 'Amount'), m('settled', 'Settled'), m('outstanding', 'Outstanding'), t('status', 'Status')] },
  { key: 'rental_roll', title: 'Rental Roll', group: 'Operations', rpc: 'rpt_rental_roll', params: ['as_of'], company: 'resilience',
    cols: [t('property_code', 'Property'), t('tenant', 'Tenant'), m('rent_amount', 'Rent'), d('start_date', 'Start'), d('end_date', 'End'), m('billed_to_date', 'Billed'), m('outstanding', 'Outstanding')] },
  // Ash Elite
  { key: 'cost_per_block', title: 'Production Cost per Block', group: 'Operations', rpc: 'rpt_cost_per_block', params: ['from', 'to'], company: 'ashelite', landscape: true,
    cols: [t('batch_no', 'Batch'), d('batch_date', 'Date'), t('product', 'Product'), n('qty_good', 'Good'), n('qty_damaged', 'Damaged'), m('material_cost', 'Materials'), m('labour_cost', 'Labour'), m('overhead_cost', 'Overhead'), m('total_cost', 'Total'), n('cost_per_good', 'Cost / block')] },
  { key: 'inventory_valuation', title: 'Inventory Valuation', group: 'Operations', rpc: 'rpt_inventory_valuation', params: [], company: 'ashelite',
    cols: [t('kind', 'Kind'), t('sku', 'SKU'), t('name', 'Item'), n('qty', 'Qty'), n('avg_cost', 'Avg cost'), m('value', 'Value')] },
  { key: 'material_usage', title: 'Material Usage', group: 'Operations', rpc: 'rpt_material_usage', params: ['from', 'to'], company: 'ashelite',
    cols: [t('sku', 'SKU'), t('name', 'Material'), n('received', 'Received'), n('consumed', 'Consumed'), n('wasted', 'Wasted'), n('closing', 'Closing stock')] },
];

export const reportsFor = (c: CompanyCode) => REPORTS.filter((r) => !r.company || r.company === c);
export const findReport = (key: string) => REPORTS.find((r) => r.key === key);

/** Builds the named-argument object for the Postgres function from request params. */
export function rpcArgs(def: ReportDef, p: Record<string, string>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const name of def.params) {
    const v = p[name];
    if (v === undefined || v === '') { if (def.optional?.includes(name)) continue; throw new Error(`Missing parameter: ${name}`); }
    if (name === 'statement_balance' || name === 'year' || name === 'month' || name === 'level') {
      const x = Number(v); if (!Number.isFinite(x)) throw new Error(`Invalid number for ${name}`); out[`p_${name}`] = x;
    } else out[`p_${name}`] = v;
  }
  if (def.key === 'payroll_bank_schedule') out.p_method = 'bank';
  if (def.key === 'payroll_momo_schedule') out.p_method = 'momo';
  return out;
}
