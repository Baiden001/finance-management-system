-- 0102_ceo_read: CEO read-only access to Resilience estate data used by the operations reports.
select public._ceo_read(array['projects','properties','property_sales','rental_agreements','rental_charges','payment_plans','plan_instalments','customer_deposits','commissions']);
