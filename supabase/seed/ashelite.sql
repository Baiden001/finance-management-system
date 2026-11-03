insert into public.company_settings(company_code, legal_name, display_name, base_currency)
values ('ashelite', 'Ash Elite Enterprise', 'Ash Elite Enterprise - Block Factory', 'GHS') on conflict (id) do nothing;
insert into public.accounts (code, name, type, subtype, cash_flow_category, is_system) values
 ('1210','Raw Materials Inventory','asset','inventory','operating',true),
 ('1220','Finished Blocks Inventory','asset','inventory','operating',true),
 ('4100','Block Sales','income',null,'operating',true),
 ('5000','Cost of Goods Sold','expense',null,'operating',true),
 ('5150','Material Wastage','expense',null,'operating',true),
 ('5200','Production Labour Absorbed','expense',null,'operating',true),
 ('5210','Production Overhead Absorbed','expense',null,'operating',true),
 ('5300','Manufacturing Labour','expense',null,'operating',false),
 ('5310','Factory Overhead','expense',null,'operating',false)
on conflict (code) do nothing;
insert into public.account_mappings(key, account_id)
select m.key, a.id from (values ('RM_INVENTORY','1210'),('FG_INVENTORY','1220'),('COGS','5000'),('MATERIAL_WASTE','5150'),('LABOUR_ABSORBED','5200'),('OVERHEAD_ABSORBED','5210')) as m(key, code)
join public.accounts a on a.code = m.code on conflict (key) do nothing;
