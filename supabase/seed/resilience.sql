insert into public.company_settings(company_code, legal_name, display_name, base_currency)
values ('resilience', 'Resilience Estate Ltd', 'Resilience Estate Ltd', 'GHS') on conflict (id) do nothing;
insert into public.accounts (code, name, type, subtype, cash_flow_category, is_system) values
 ('1200','Property Inventory (Development in Progress)','asset','inventory','operating',true),
 ('4100','Property Sales','income',null,'operating',true),
 ('4200','Rental Income','income',null,'operating',true),
 ('5100','Cost of Property Sold','expense',null,'operating',true),
 ('5200','Development and Contractor Costs','expense',null,'operating',false),
 ('5210','Property Expenses','expense',null,'operating',false)
on conflict (code) do nothing;
insert into public.account_mappings(key, account_id)
select m.key, a.id from (values ('PROPERTY_INVENTORY','1200'),('PROPERTY_SALES','4100'),('RENTAL_INCOME','4200'),('PROPERTY_COGS','5100')) as m(key, code)
join public.accounts a on a.code = m.code on conflict (key) do nothing;
