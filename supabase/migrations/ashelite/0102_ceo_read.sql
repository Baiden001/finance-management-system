-- 0102_ceo_read: CEO read-only access to Ash Elite factory data used by the operations reports.
select public._ceo_read(array['materials','products','material_movements','production_batches','batch_materials','product_movements','equipment','maintenance_logs','delivery_notes','delivery_note_lines','price_list','recipes','recipe_materials']);
