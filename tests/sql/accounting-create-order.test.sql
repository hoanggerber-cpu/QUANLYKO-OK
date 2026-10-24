\set ON_ERROR_STOP on

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','3ea90802-af4a-4163-b403-da7ee313eb6d',false);

-- A new invoice and its initial payment must commit as one unit.
DO $test$
DECLARE result jsonb; retry_result jsonb;
BEGIN
  SELECT public.create_order_atomic(
    'new-atomic-order-1','ORD-DTF-9001','New Customer','dtf','c_dtf_NewCustomer',
    'In PET phim','Mặc định',10,20000,200000,50000,150000,'pending',
    '{"images":[],"notes":"","surcharge":0}','2026-10-24T10:00:00+07:00',
    'aaaaaaaa-1111-4111-8111-111111111111','Chuyển khoản',
    '[{"id":"new-atomic-item-1","type":"dtf","product_name":"In PET phim","color":"Mặc định","size":null,"quantity":10,"unit_price":20000,"total_price":200000,"image":null}]'::jsonb
  ) INTO result;
  IF result->>'state'<>'committed' OR result->>'duplicate'<>'false' THEN
    RAISE EXCEPTION 'Atomic invoice creation failed: %',result;
  END IF;
  IF (SELECT paid_amount FROM public.orders WHERE id='new-atomic-order-1')<>50000
     OR (SELECT debt_amount FROM public.orders WHERE id='new-atomic-order-1')<>150000
     OR (SELECT count(*) FROM public.payment_history WHERE id='aaaaaaaa-1111-4111-8111-111111111111')<>1
     OR (SELECT coalesce(sum(amount),0) FROM public.payment_allocations WHERE payment_id='aaaaaaaa-1111-4111-8111-111111111111')<>50000 THEN
    RAISE EXCEPTION 'Initial payment, opening balance, and receipt journal disagree';
  END IF;

  SELECT public.create_order_atomic(
    'new-atomic-order-1','ORD-DTF-9001','New Customer','dtf','c_dtf_NewCustomer',
    'In PET phim','Mặc định',10,20000,200000,50000,150000,'pending',
    '{"images":[],"notes":"","surcharge":0}','2026-10-24T10:00:00+07:00',
    'aaaaaaaa-1111-4111-8111-111111111111','Chuyển khoản',
    '[{"id":"new-atomic-item-1","type":"dtf","product_name":"In PET phim","color":"Mặc định","size":null,"quantity":10,"unit_price":20000,"total_price":200000,"image":null}]'::jsonb
  ) INTO retry_result;
  IF retry_result->>'duplicate'<>'true' OR
     (SELECT count(*) FROM public.payment_history WHERE id='aaaaaaaa-1111-4111-8111-111111111111')<>1 THEN
    RAISE EXCEPTION 'Retrying invoice creation duplicated the initial receipt';
  END IF;
END;
$test$;

-- A later receipt must allocate against the exact debt, not the initial paid amount.
DO $test$
DECLARE result jsonb;
BEGIN
  SELECT public.record_customer_payment_atomic(
    'bbbbbbbb-2222-4222-8222-222222222222','New Customer','dtf','c_dtf_NewCustomer',
    150000,'Cash',NULL
  ) INTO result;
  IF result->>'state'<>'committed' OR
     (SELECT total_price FROM public.orders WHERE id='new-atomic-order-1')<>200000 OR
     (SELECT paid_amount FROM public.orders WHERE id='new-atomic-order-1')<>200000 OR
     (SELECT debt_amount FROM public.orders WHERE id='new-atomic-order-1')<>0 OR
     (SELECT coalesce(sum(amount),0) FROM public.payment_allocations a
       JOIN public.payment_history p ON p.id=a.payment_id
       WHERE a.order_id='new-atomic-order-1'
         AND NOT EXISTS (SELECT 1 FROM public.payment_reversals r WHERE r.payment_id=p.id))<>200000 THEN
    RAISE EXCEPTION 'New invoice does not reconcile to exactly 200,000 VND';
  END IF;
END;
$test$;

-- Direct edits/deletes of financial state must be refused outside atomic RPCs.
DO $test$
DECLARE before_paid numeric;
BEGIN
  SELECT paid_amount INTO before_paid FROM public.orders WHERE id='new-atomic-order-1';
  BEGIN
    UPDATE public.orders SET paid_amount=199999,debt_amount=1 WHERE id='new-atomic-order-1';
    RAISE EXCEPTION 'Direct balance edit unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Direct balance edit unexpectedly succeeded' THEN RAISE; END IF;
  END;
  IF (SELECT paid_amount FROM public.orders WHERE id='new-atomic-order-1')<>before_paid THEN
    RAISE EXCEPTION 'Rejected direct edit changed invoice balance';
  END IF;
  BEGIN
    DELETE FROM public.payment_history WHERE id='aaaaaaaa-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'Direct receipt deletion unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Direct receipt deletion unexpectedly succeeded' THEN RAISE; END IF;
  END;
  IF (SELECT count(*) FROM public.payment_history WHERE id='aaaaaaaa-1111-4111-8111-111111111111')<>1 THEN
    RAISE EXCEPTION 'Rejected receipt deletion changed history';
  END IF;
END;
$test$;

-- Reverse only the newest receipt. The initial payment remains as the baseline
-- payment for the invoice, and the receipt itself stays in immutable history.
DO $test$
DECLARE result jsonb;
BEGIN
  SELECT public.reverse_customer_payment_atomic(
    'bbbbbbbb-2222-4222-8222-222222222222',
    'cccccccc-3333-4333-8333-333333333333'
  ) INTO result;
  IF result->>'state'<>'reversed' OR
     (SELECT paid_amount FROM public.orders WHERE id='new-atomic-order-1')<>50000 OR
     (SELECT debt_amount FROM public.orders WHERE id='new-atomic-order-1')<>150000 OR
     (SELECT count(*) FROM public.payment_history WHERE id='bbbbbbbb-2222-4222-8222-222222222222')<>1 THEN
    RAISE EXCEPTION 'Reversal did not restore the exact pre-receipt balance';
  END IF;
END;
$test$;

RESET ROLE;
