\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','3ea90802-af4a-4163-b403-da7ee313eb6d',false);
-- Run this concurrently in two independent psql processes with distinct
-- payment_id values. Each tries to collect 5M from the same 7M open debt.
SELECT public.record_customer_payment_atomic(
  :'payment_id'::uuid,'Khach A','dtf','c_dtf_A',5000000,'Concurrent test',NULL
);
