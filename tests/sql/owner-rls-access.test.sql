\set ON_ERROR_STOP on
-- Executed only against the disposable CI Postgres after applying owner RLS.
-- Owner must be able to access all existing records.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '3ea90802-af4a-4163-b403-da7ee313eb6d';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.orders) < 3 THEN
    RAISE EXCEPTION 'Owner cannot read seeded orders after prior accounting tests';
  END IF;
  IF NOT has_table_privilege(current_user,'public.orders','INSERT') THEN
    RAISE EXCEPTION 'Owner authenticated role has no order insert permission';
  END IF;
  IF has_table_privilege(current_user,'public.admin_users','SELECT') THEN
    RAISE EXCEPTION 'Owner browser unexpectedly reads admin_users';
  END IF;
END $$;
ROLLBACK;

-- Authenticated as a different user: table privileges exist but RLS hides all.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
DO $$
DECLARE affected integer;
BEGIN
  IF (SELECT count(*) FROM public.orders) <> 0 THEN
    RAISE EXCEPTION 'Non-owner can SELECT other customers orders';
  END IF;
  IF (SELECT count(*) FROM public.payment_history) <> 0 THEN
    RAISE EXCEPTION 'Non-owner can SELECT payment history';
  END IF;
  UPDATE public.orders SET status = 'completed' WHERE id = 'a-old';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Non-owner can UPDATE other customers orders';
  END IF;
  BEGIN
    INSERT INTO public.orders(id,order_code,customer_name,type,total_price,paid_amount,debt_amount,status,created_at)
    VALUES('unauthorized','ORD-DTF-X','Intruder','dtf',1000,0,1000,'pending',now());
    RAISE EXCEPTION 'Non-owner INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL;
  END;
END $$;
ROLLBACK;

-- Anonymous cannot access financial tables OR the credential table.
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF has_table_privilege(current_user,'public.orders','SELECT') THEN
    RAISE EXCEPTION 'Anonymous still has SELECT grant on orders';
  END IF;
  IF has_table_privilege(current_user,'public.orders','INSERT') THEN
    RAISE EXCEPTION 'Anonymous still has INSERT grant on orders';
  END IF;
  IF has_table_privilege(current_user,'public.admin_users','SELECT') THEN
    RAISE EXCEPTION 'Anonymous still has SELECT grant on admin_users';
  END IF;
  IF has_table_privilege(current_user,'public.payment_history','SELECT') OR
     has_table_privilege(current_user,'public.payment_history','INSERT') THEN
    RAISE EXCEPTION 'Anonymous still has finance grants';
  END IF;
  IF has_table_privilege(current_user,'public.products','SELECT') OR
     has_table_privilege(current_user,'public.customers','SELECT') THEN
    RAISE EXCEPTION 'Anonymous can read products or customers';
  END IF;
END $$;
ROLLBACK;
\echo Owner RLS negative/positive access regression passed
