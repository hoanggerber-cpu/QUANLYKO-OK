-- READ ONLY reconciliation report. Safe to run against production.
-- Every query is SELECT-only. Do not use results to auto-correct historical balances.
-- A history/order difference is a reconciliation flag, not proof that money was lost.

-- 1) Global control totals.
SELECT
  (SELECT count(*) FROM public.orders) AS order_count,
  (SELECT sum(total_price) FROM public.orders) AS order_total_vnd,
  (SELECT sum(paid_amount) FROM public.orders) AS paid_on_orders_vnd,
  (SELECT sum(debt_amount) FROM public.orders) AS outstanding_debt_vnd,
  (SELECT count(*) FROM public.payment_history) AS receipt_count,
  (SELECT sum(amount) FROM public.payment_history) AS receipt_history_vnd,
  (SELECT sum(amount) FROM public.payment_history)
    - (SELECT sum(paid_amount) FROM public.orders) AS history_minus_paid_vnd;

-- 2) Customer-level reconciliation. Normalizes case and repeated whitespace only.
-- It intentionally does NOT guess that differently spelled names are the same person.
WITH receipts AS (
  SELECT type, lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g')) AS normalized_name,
         min(customer_name) AS sample_name, count(*) AS receipt_count,
         sum(amount) AS receipt_history_vnd, min(created_at) AS first_receipt,
         max(created_at) AS last_receipt
  FROM public.payment_history
  GROUP BY type, lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g'))
), invoices AS (
  SELECT type, lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g')) AS normalized_name,
         min(customer_name) AS sample_name, count(*) AS order_count,
         sum(total_price) AS order_total_vnd, sum(paid_amount) AS paid_on_orders_vnd,
         sum(debt_amount) AS outstanding_debt_vnd
  FROM public.orders
  GROUP BY type, lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g'))
)
SELECT coalesce(r.sample_name, i.sample_name) AS customer_name,
       coalesce(r.type, i.type) AS type,
       coalesce(r.receipt_count, 0) AS receipt_count,
       coalesce(r.receipt_history_vnd, 0) AS receipt_history_vnd,
       coalesce(i.order_count, 0) AS order_count,
       coalesce(i.order_total_vnd, 0) AS order_total_vnd,
       coalesce(i.paid_on_orders_vnd, 0) AS paid_on_orders_vnd,
       coalesce(i.outstanding_debt_vnd, 0) AS outstanding_debt_vnd,
       coalesce(r.receipt_history_vnd, 0) - coalesce(i.paid_on_orders_vnd, 0) AS difference_vnd,
       r.first_receipt AT TIME ZONE 'Asia/Ho_Chi_Minh' AS first_receipt_vn,
       r.last_receipt AT TIME ZONE 'Asia/Ho_Chi_Minh' AS last_receipt_vn
FROM receipts r FULL JOIN invoices i USING (type, normalized_name)
WHERE coalesce(r.receipt_history_vnd, 0) <> coalesce(i.paid_on_orders_vnd, 0)
ORDER BY abs(coalesce(r.receipt_history_vnd, 0) - coalesce(i.paid_on_orders_vnd, 0)) DESC,
         customer_name;

-- 3) Full receipt lookup, including stable database ID, date, payment method and amount.
SELECT id AS receipt_id, customer_id, customer_name, type, amount AS amount_vnd,
       payment_method,
       created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS created_at_vn
FROM public.payment_history
ORDER BY created_at, id;

-- 4) Invoice rows whose paid amount looks unusually small compared with invoice total.
-- Review manually. A small payment can be legitimate; never auto-scale by 1,000.
SELECT id AS order_id, order_code, customer_name, type, total_price AS total_vnd,
       paid_amount AS paid_vnd, debt_amount AS debt_vnd, status,
       created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS created_at_vn
FROM public.orders
WHERE paid_amount > 0 AND paid_amount < 1000 AND total_price >= 10000
ORDER BY created_at, customer_name;

-- 5) Orders with a recorded paid balance but no same-name/type receipt history.
-- This is a review list, not proof that a receipt is missing: older workflows may
-- have marked invoices paid directly or used a customer-level receipt instead.
SELECT o.id AS order_id, o.order_code, o.customer_name, o.type,
       o.total_price AS total_vnd, o.paid_amount AS paid_vnd, o.debt_amount AS debt_vnd,
       o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS created_at_vn
FROM public.orders o
WHERE o.paid_amount > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_history p
    WHERE p.type=o.type
      AND lower(regexp_replace(btrim(p.customer_name), '\s+', ' ', 'g')) =
          lower(regexp_replace(btrim(o.customer_name), '\s+', ' ', 'g'))
  )
ORDER BY o.created_at, o.customer_name;

-- 6) Existing spelling variants that may need a human-confirmed alias.
-- Only identical normalized forms are grouped; similar spellings are shown separately.
SELECT type,
       lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g')) AS normalized_name,
       array_agg(DISTINCT customer_name ORDER BY customer_name) AS observed_names,
       count(*) AS row_count
FROM (
  SELECT customer_name, type FROM public.orders
  UNION ALL
  SELECT customer_name, type FROM public.payment_history
) all_names
GROUP BY type, lower(regexp_replace(btrim(customer_name), '\s+', ' ', 'g'))
HAVING count(DISTINCT customer_name) > 1
ORDER BY type, normalized_name;
