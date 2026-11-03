-- Safe seed: structure only. No real people, balances or secrets. Idempotent.
-- Statutory rule values below are PLACEHOLDERS for structure and testing and are NOT verified.
-- The accountant must verify them against official GRA / SSNIT guidance and record verification before production use.

insert into public.accounts (code, name, type, subtype, cash_flow_category, is_bank, is_system) values
 ('1010','Bank - Main Account','asset','bank','cash',true,true),
 ('1020','Mobile Money Wallet','asset','bank','cash',true,true),
 ('1030','Petty Cash','asset','cash','cash',true,true),
 ('1100','Accounts Receivable','asset','receivable','operating',false,true),
 ('1150','Staff Advances and Loans','asset','receivable','operating',false,true),
 ('1160','VAT and Levies Input','asset','tax','operating',false,true),
 ('1170','Withholding Tax Receivable','asset','tax','operating',false,true),
 ('1500','Fixed Assets - Cost','asset','fixed_asset','investing',false,true),
 ('1510','Accumulated Depreciation','asset','fixed_asset','investing',false,true),
 ('2000','Accounts Payable','liability','payable','operating',false,true),
 ('2100','VAT and Levies Output','liability','tax','operating',false,true),
 ('2200','PAYE Payable','liability','payroll','operating',false,true),
 ('2210','Pension Contributions Payable','liability','payroll','operating',false,true),
 ('2220','Net Salaries Payable','liability','payroll','operating',false,true),
 ('2230','Other Payroll Deductions Payable','liability','payroll','operating',false,true),
 ('2240','Withholding Tax Payable','liability','tax','operating',false,true),
 ('2300','Customer Deposits','liability',null,'operating',false,true),
 ('2400','Retention Payable','liability',null,'operating',false,true),
 ('3000','Share Capital','equity',null,'financing',false,false),
 ('3900','Opening Balance Equity','equity',null,'financing',false,true),
 ('4000','Sales Revenue','income',null,'operating',false,false),
 ('4900','Other Income','income',null,'operating',false,false),
 ('6000','Salaries and Wages','expense','payroll','operating',false,true),
 ('6010','Employer Pension Contributions','expense','payroll','operating',false,true),
 ('6100','Rent and Premises','expense',null,'operating',false,false),
 ('6200','Utilities','expense',null,'operating',false,false),
 ('6300','Depreciation Expense','expense',null,'operating',false,true),
 ('6400','Repairs and Maintenance','expense',null,'operating',false,false),
 ('6500','Transport and Fuel','expense',null,'operating',false,false),
 ('6600','Professional Fees','expense',null,'operating',false,false),
 ('6700','Bank and Mobile Money Charges','expense',null,'operating',false,false),
 ('6800','Office and Administration','expense',null,'operating',false,false),
 ('7000','Gain or Loss on Asset Disposal','expense',null,'investing',false,true),
 ('7900','Realised FX Gain or Loss','expense',null,'operating',false,true),
 ('7910','Unrealised FX Gain or Loss','expense',null,'operating',false,true)
on conflict (code) do nothing;

insert into public.account_mappings(key, account_id)
select m.key, a.id from (values
 ('AR','1100'),('AP','2000'),('VAT_OUTPUT','2100'),('VAT_INPUT','1160'),('STAFF_ADVANCES','1150'),
 ('PAYROLL_EXPENSE','6000'),('PAYROLL_PENSION_EXPENSE','6010'),('PAYROLL_NET_PAYABLE','2220'),('PAYE_PAYABLE','2200'),
 ('PENSION_PAYABLE','2210'),('PAYROLL_OTHER_DED_PAYABLE','2230'),('FX_GAIN_LOSS','7900'),('FX_UNREALISED','7910'),
 ('ASSET_DISPOSAL_GL','7000'),('DEPRECIATION_EXPENSE','6300'),('ACCUMULATED_DEPRECIATION','1510'),('WHT_RECEIVABLE','1170'),('WHT_PAYABLE','2240'),('CUSTOMER_DEPOSITS','2300'),('RETENTION_PAYABLE','2400'),('FIXED_ASSET_COST','1500'),('OPENING_BALANCE_EQUITY','3900')
) as m(key, code) join public.accounts a on a.code = m.code
on conflict (key) do nothing;

insert into public.bank_accounts(account_id, name, bank_name, kind)
select id, name, null, case when code = '1020' then 'momo' when code = '1030' then 'cash' else 'bank' end
from public.accounts where code in ('1010','1020','1030') on conflict (account_id) do nothing;

insert into public.pay_components(code, name, kind, taxable, pensionable) values
 ('ALLOW_TRANSPORT','Transport allowance','earning',true,false),
 ('ALLOW_HOUSING','Housing allowance','earning',true,false),
 ('ALLOW_PENSIONABLE','Pensionable allowance','earning',true,true),
 ('DED_UNION','Union / welfare dues','deduction',false,false),
 ('DED_OTHER','Other authorised deduction','deduction',false,false)
on conflict (code) do nothing;

-- PLACEHOLDER statutory parameters (monthly PAYE bands as commonly published; SSNIT rates). UNVERIFIED.
insert into public.statutory_rule_sets(rule_code, effective_from, params, source_note) values
 ('GH_PAYE', '2024-01-01', '{"pension_deductible": true, "bands": [
    {"upto": 490, "rate": 0}, {"upto": 600, "rate": 0.05}, {"upto": 730, "rate": 0.10}, {"upto": 3896.67, "rate": 0.175},
    {"upto": 19896.67, "rate": 0.25}, {"upto": 50416.67, "rate": 0.30}, {"upto": null, "rate": 0.35}]}',
  'PLACEHOLDER - verify against current GRA PAYE guidance before production use'),
 ('GH_SSNIT', '2024-01-01', '{"employee_rate": 0.055, "employer_rate": 0.13}',
  'PLACEHOLDER - verify against current SSNIT guidance before production use')
on conflict (rule_code, effective_from) do nothing;

do $$
begin
  if not exists (select 1 from public.fiscal_years where name = 'FY2026') then perform public.create_fiscal_year(2026); end if;
end $$;
