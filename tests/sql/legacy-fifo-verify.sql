\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon,authenticated;
CREATE TABLE public.orders (
  id text PRIMARY KEY,order_code text NOT NULL,customer_name text NOT NULL,type text NOT NULL,
  product_name text,color text,quantity numeric,unit_price numeric,order_images text,
  created_at timestamptz,total_price numeric,paid_amount numeric,debt_amount numeric,status text
);
CREATE TABLE public.payment_history (
  id uuid PRIMARY KEY,customer_id text NOT NULL,customer_name text NOT NULL,type text NOT NULL,
  amount numeric NOT NULL,payment_method text,created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.orders,public.payment_history TO anon,authenticated;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_orders ON public.orders FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
CREATE POLICY legacy_payments ON public.payment_history FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
\i docs/LEGACY_FIFO_ATOMIC_FUNCTION.sql

INSERT INTO public.orders(id,order_code,customer_name,type,created_at,total_price,paid_amount,debt_amount,status)
SELECT 'legacy-'||lpad(i::text,4,'0'),'ORD-'||i,'Khach FIFO','dtf',
  '2026-01-01'::timestamptz+i*interval '1 minute',
  100000,0,100000,'pending'
FROM generate_series(1,1000) i;
INSERT INTO public.orders(id,order_code,customer_name,type,created_at,total_price,paid_amount,debt_amount,status)
VALUES ('other','ORD-OTHER','Khach Khac','dtf','2026-01-01',1000000,0,1000000,'pending');

SET ROLE anon;
DO $test$
DECLARE
 v_result jsonb;
BEGIN
 SELECT public.record_legacy_payment_atomic(
   'a0000001-1111-4111-8111-000000000001','Khach FIFO','dtf','c_dtf_fifo',10000000,'cash',NULL
 ) INTO v_result;
 IF v_result->>'state'<>'committed' OR
    (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach FIFO')<>90000000 THEN
   RAISE EXCEPTION 'Receipt #1 incorrect';
 END IF;
 SELECT public.record_legacy_payment_atomic(
   'a0000002-1111-4111-8111-000000000002','Khach FIFO','dtf','c_dtf_fifo',20000000,'bank',NULL
 ) INTO v_result;
 IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach FIFO')<>70000000 THEN
   RAISE EXCEPTION 'Receipt #2 incorrect';
 END IF;
 SELECT public.record_legacy_payment_atomic(
   'a0000003-1111-4111-8111-000000000003','Khach FIFO','dtf','c_dtf_fifo',20000000,'cash',NULL
 ) INTO v_result;
 IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach FIFO')<>50000000 OR
    (SELECT count(*) FROM public.orders WHERE customer_name='Khach FIFO' AND status='completed')<>500 OR
    (SELECT count(*) FROM public.orders WHERE customer_name='Khach FIFO' AND debt_amount=100000)<>500 OR
    (SELECT count(*) FROM public.orders WHERE customer_name='Khach FIFO' AND right(id,4)::int<=500 AND debt_amount<>0)<>0 OR
    (SELECT count(*) FROM public.orders WHERE customer_name='Khach FIFO' AND right(id,4)::int>500 AND debt_amount<>100000)<>0 THEN
   RAISE EXCEPTION 'FIFO must pay oldest 500 invoices: still owe 50M';
 END IF;
 IF (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach Khac')<>1000000 THEN
   RAISE EXCEPTION 'Another customer was altered';
 END IF;
END;
$test$;
RESET ROLE;

INSERT INTO public.orders(id,order_code,customer_name,type,created_at,total_price,paid_amount,debt_amount,status)
VALUES ('legacy-new','ORD-NEW','Khach FIFO','dtf','2026-10-24',5000000,0,5000000,'pending');
SET ROLE anon;
DO $test$
DECLARE v_result jsonb; v_count integer;
BEGIN
 SELECT public.record_legacy_payment_atomic(
   'a0000003-1111-4111-8111-000000000003','Khach FIFO','dtf','c_dtf_fifo',20000000,'cash',NULL
 ) INTO v_result;
 IF v_result->>'duplicate'<>'true'
   OR (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach FIFO')<>55000000
   OR (SELECT count(*) FROM public.payment_history WHERE customer_name='Khach FIFO')<>3
 THEN RAISE EXCEPTION 'Retry duplicate changed debt or history'; END IF;

 SELECT count(*) INTO v_count FROM public.payment_history;
 BEGIN
   PERFORM public.record_legacy_payment_atomic(
     'a0000004-1111-4111-8111-000000000004','Khach FIFO','dtf','c_dtf_fifo',100000000,'cash',NULL
   );
   RAISE EXCEPTION 'Overpayment was accepted';
 EXCEPTION WHEN others THEN
   IF SQLERRM='Overpayment was accepted' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.payment_history)<>v_count
    OR (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach FIFO')<>55000000 THEN
    RAISE EXCEPTION 'Overpayment mutated ledger despite rollback';
 END IF;

 BEGIN
   PERFORM public.record_legacy_payment_atomic(
     'a0000003-1111-4111-8111-000000000003','Khach FIFO','dtf','c_dtf_fifo',20000000,'forged',NULL
   );
   RAISE EXCEPTION 'Changed receipt identity reused';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
END;
$test$;
RESET ROLE;

-- Atomic rollback after some invoice updates, before receipt insertion.
CREATE FUNCTION public.fail_after_tenth_paid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id='legacy-0510' AND OLD.debt_amount>NEW.debt_amount THEN
   RAISE EXCEPTION 'Injected failure';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fail_payment_trigger BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.fail_after_tenth_paid();
SET ROLE anon;
DO $test$
DECLARE v_count integer;
BEGIN
 SELECT count(*) INTO v_count FROM public.payment_history;
 BEGIN
  PERFORM public.record_legacy_payment_atomic(
    'a0000005-1111-4111-8111-000000000005','Khach FIFO','dtf','c_dtf_fifo',2000000,'cash',NULL
  );
  RAISE EXCEPTION 'Injected failure did not stop payment';
 EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='Injected failure did not stop payment' THEN RAISE; END IF;
 END;
 IF (SELECT count(*) FROM public.payment_history)<>v_count OR
    (SELECT sum(debt_amount) FROM public.orders WHERE customer_name='Khach FIFO')<>55000000
 THEN RAISE EXCEPTION 'Rollback must restore every order and history'; END IF;
END;$test$;
RESET ROLE;


-- Customer overpayment and automatic application to future invoices.
-- This migration adds only one column to existing customers and one INSERT trigger.
CREATE TABLE public.customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  pin_code text,
  created_at timestamptz DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.customers TO anon,authenticated;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_customer_access ON public.customers FOR ALL TO anon,authenticated
  USING(true) WITH CHECK(true);
\i docs/CUSTOMER_OVERPAYMENT_CREDIT.sql

INSERT INTO public.orders(id,order_code,customer_name,type,created_at,total_price,paid_amount,debt_amount,status)
VALUES ('advance-old','ADV-OLD','Advance Test','dtf','2026-01-01',5000000,0,5000000,'pending');

SET ROLE anon;
DO $test$
DECLARE v_result jsonb;
BEGIN
 SELECT public.record_legacy_payment_atomic(
   'c1000001-1111-4111-8111-000000000001',
   'Advance Test','dtf','c_dtf_advance',7000000,'Cash',NULL
 ) INTO v_result;
 IF v_result->>'state'<>'committed'
    OR (SELECT debt_amount FROM public.orders WHERE id='advance-old')<>0
    OR (SELECT paid_amount FROM public.orders WHERE id='advance-old')<>5000000
    OR (SELECT credit_balance FROM public.customers WHERE name='Advance Test' AND type='dtf')<>2000000
 THEN RAISE EXCEPTION 'Overpayment must close 5M old debt and leave +2M'; END IF;

 SELECT public.record_legacy_payment_atomic(
   'c1000001-1111-4111-8111-000000000001',
   'Advance Test','dtf','c_dtf_advance',7000000,'Cash',NULL
 ) INTO v_result;
 IF v_result->>'duplicate'<>'true' OR
    (SELECT credit_balance FROM public.customers WHERE name='Advance Test' AND type='dtf')<>2000000
 THEN RAISE EXCEPTION 'Duplicate receipt cannot double positive credit'; END IF;
END;
$test$;
RESET ROLE;

SELECT public.create_legacy_order_with_advance('{"id":"advance-new-1","order_code":"ADV-NEW-1","customer_name":"Advance Test","type":"dtf","product_name":"In phim","color":"Mặc định","quantity":1,"unit_price":1000000,"total_price":1000000,"paid_amount":0,"debt_amount":1000000,"status":"pending","created_at":"2026-10-24"}'::jsonb);
DO $test$
BEGIN
 IF (SELECT credit_balance FROM public.customers WHERE name='Advance Test' AND type='dtf')<>1000000 OR
    (SELECT debt_amount FROM public.orders WHERE id='advance-new-1')<>0 OR
    (SELECT paid_amount FROM public.orders WHERE id='advance-new-1')<>1000000
 THEN RAISE EXCEPTION 'New 1M invoice must draw 1M of 2M advance'; END IF;
END;
$test$;

SELECT public.create_legacy_order_with_advance('{"id":"advance-new-2","order_code":"ADV-NEW-2","customer_name":"Advance Test","type":"dtf","product_name":"In phim","color":"Mặc định","quantity":1,"unit_price":3000000,"total_price":3000000,"paid_amount":0,"debt_amount":3000000,"status":"pending","created_at":"2026-10-25"}'::jsonb);
DO $test$
BEGIN
 IF (SELECT credit_balance FROM public.customers WHERE name='Advance Test' AND type='dtf')<>0 OR
    (SELECT debt_amount FROM public.orders WHERE id='advance-new-2')<>2000000 OR
    (SELECT paid_amount FROM public.orders WHERE id='advance-new-2')<>1000000 OR
    (SELECT total_price FROM public.orders WHERE id='advance-old')<>5000000 OR
    (SELECT sum(amount) FROM public.payment_history WHERE customer_name='Advance Test')<>7000000
 THEN RAISE EXCEPTION 'Second new invoice must consume last credit and owe 2M, original receipt intact'; END IF;
END;
$test$;

-- Customer who owes zero may still prepay without an invoice.
SET ROLE anon;
DO $test$
BEGIN
 PERFORM public.record_legacy_payment_atomic(
   'c1000002-1111-4111-8111-000000000002',
   'No Orders Yet','dtf','c_dtf_empty',1000000,'Bank',NULL
 );
 IF (SELECT credit_balance FROM public.customers WHERE name='No Orders Yet' AND type='dtf')<>1000000
 THEN RAISE EXCEPTION 'Advance without existing debt not stored'; END IF;
END;
$test$;
RESET ROLE;

-- Verify untouched legacy invoices remain in their prior final state.
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.orders WHERE customer_name='Khach FIFO' AND status='completed')<>500
    OR (SELECT sum(total_price) FROM public.orders WHERE customer_name='Khach FIFO')<>105000000
 THEN RAISE EXCEPTION 'Migration changed historical customer orders'; END IF;
END;
$test$;
