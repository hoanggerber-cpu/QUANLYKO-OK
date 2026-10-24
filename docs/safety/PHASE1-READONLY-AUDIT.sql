-- PHASE 1: READ ONLY. Run manually in Supabase SQL Editor only after verifying project.
-- No UPDATE/DELETE/INSERT/ALTER, no changes to RLS.
BEGIN TRANSACTION READ ONLY;
SELECT 'orders' AS table_name, count(*) AS row_count FROM public.orders
UNION ALL SELECT 'order_items', count(*) FROM public.order_items
UNION ALL SELECT 'customers', count(*) FROM public.customers
UNION ALL SELECT 'payment_history', count(*) FROM public.payment_history
UNION ALL SELECT 'products', count(*) FROM public.products;
SELECT count(*) AS orphan_order_items
FROM public.order_items oi LEFT JOIN public.orders o ON o.id = oi.order_id
WHERE o.id IS NULL;
SELECT count(*) AS products_missing_images
FROM public.products WHERE image IS NULL OR btrim(image) = '';
COMMIT;
-- If a referenced table/column does not exist, transaction will fail without changing data.
-- Do not paste or share row-level customer data, secrets or exports into public GitHub.
