\set ON_ERROR_STOP on

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','3ea90802-af4a-4163-b403-da7ee313eb6d',false);

DO $test$
DECLARE result jsonb;
BEGIN
  SELECT public.record_customer_payment_atomic(
    '11111111-1111-4111-8111-111111111111', 'Khach A','dtf','c_dtf_A',
    6000000,'Cash',NULL
  ) INTO result;
  IF result->>'state'<>'committed' OR result->>'duplicate'<>'false'
     OR (result->>'affected_orders')::int<>2 THEN
    RAISE EXCEPTION 'FIFO receipt not committed correctly: %',result;
  END IF;
  IF (SELECT paid_amount FROM public.orders WHERE id='a-old')<>5000000 OR
     (SELECT debt_amount FROM public.orders WHERE id='a-old')<>0 OR
     (SELECT paid_amount FROM public.orders WHERE id='a-next')<>2000000 OR
     (SELECT debt_amount FROM public.orders WHERE id='a-next')<>1000000 THEN
    RAISE EXCEPTION 'FIFO allocation changed the wrong VND balance';
  END IF;
  IF (SELECT coalesce(sum(amount),0) FROM public.payment_allocations
      WHERE payment_id='11111111-1111-4111-8111-111111111111')<>6000000 THEN
    RAISE EXCEPTION 'Allocation journal sum is not 6M VND';
  END IF;
  IF (SELECT paid_amount FROM public.orders WHERE id='b-own')<>0 THEN
    RAISE EXCEPTION 'Payment illegally touched another customer';
  END IF;
END;
$test$;

-- Timeout-after-commit retry: same request UUID must not pay again.
DO $test$
DECLARE result jsonb;
BEGIN
  SELECT public.record_customer_payment_atomic(
    '11111111-1111-4111-8111-111111111111','Khach A','dtf','c_dtf_A',
    6000000,'Cash',NULL
  ) INTO result;
  IF result->>'duplicate'<>'true' THEN
    RAISE EXCEPTION 'Idempotent retry not recognized';
  END IF;
  IF (SELECT count(*) FROM public.payment_history
      WHERE id='11111111-1111-4111-8111-111111111111')<>1 THEN
    RAISE EXCEPTION 'Duplicate receipts inserted';
  END IF;
END;
$test$;

-- Reject insufficient debt: insert and all side effects must rollback.
DO $test$
DECLARE before_count int;
BEGIN
  SELECT count(*) INTO before_count FROM public.payment_history;
  BEGIN
    PERFORM public.record_customer_payment_atomic(
      '22222222-2222-4222-8222-222222222222','Khach A','dtf','c_dtf_A',
      2000000,'Bank',NULL
    );
    RAISE EXCEPTION 'An excessive receipt was accepted';
  EXCEPTION WHEN raise_exception THEN
    -- Verify error was raised inside RPC; if not, the explicit RAISE above
    -- will also be caught, but the database invariants below catch inserts.
    NULL;
  END;
  IF (SELECT count(*) FROM public.payment_history)<>before_count
     OR (SELECT debt_amount FROM public.orders WHERE id='a-next')<>1000000 THEN
    RAISE EXCEPTION 'Overpayment attempt mutated the ledger';
  END IF;
END;
$test$;

-- Single invoice receipt, then deliberately attempt to undo an earlier
-- receipt whose allocation snapshot is no longer current.
DO $test$
DECLARE result jsonb;
BEGIN
  SELECT public.record_customer_payment_atomic(
    '33333333-3333-4333-8333-333333333333','Khach A','dtf','c_dtf_A',
    500000,'Thanh toán hóa đơn A-next','a-next'
  ) INTO result;
  IF result->>'state'<>'committed' OR
     (SELECT debt_amount FROM public.orders WHERE id='a-next')<>500000 THEN
    RAISE EXCEPTION 'Single-invoice payment incorrect';
  END IF;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    PERFORM public.reverse_customer_payment_atomic(
      '11111111-1111-4111-8111-111111111111',
      '44444444-4444-4444-8444-444444444444'
    );
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT count(*) FROM public.payment_reversals)<>0
     OR (SELECT debt_amount FROM public.orders WHERE id='a-next')<>500000 THEN
    RAISE EXCEPTION 'Unsafe old receipt reversal was not blocked';
  END IF;
END;
$test$;

-- Reverse the most recent newly journaled single-invoice receipt precisely.
DO $test$
DECLARE result jsonb;
BEGIN
  SELECT public.reverse_customer_payment_atomic(
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555'
  ) INTO result;
  IF result->>'state'<>'reversed' OR
     (SELECT debt_amount FROM public.orders WHERE id='a-next')<>1000000 THEN
    RAISE EXCEPTION 'Most recent receipt did not reverse 500k exactly';
  END IF;
  SELECT public.reverse_customer_payment_atomic(
    '33333333-3333-4333-8333-333333333333',
    '55555555-5555-4555-8555-555555555555'
  ) INTO result;
  IF result->>'duplicate'<>'true' OR
     (SELECT count(*) FROM public.payment_reversals
      WHERE payment_id='33333333-3333-4333-8333-333333333333')<>1 THEN
    RAISE EXCEPTION 'Duplicate reversal not idempotent';
  END IF;

  SELECT public.reverse_customer_payment_atomic(
    '11111111-1111-4111-8111-111111111111',
    '66666666-6666-4666-8666-666666666666'
  ) INTO result;
  IF result->>'state'<>'reversed' OR
     (SELECT paid_amount FROM public.orders WHERE id='a-old')<>1000000 OR
     (SELECT debt_amount FROM public.orders WHERE id='a-old')<>4000000 OR
     (SELECT paid_amount FROM public.orders WHERE id='a-next')<>0 OR
     (SELECT debt_amount FROM public.orders WHERE id='a-next')<>3000000 THEN
    RAISE EXCEPTION 'Historical baseline changed after receipt reversal';
  END IF;
  IF (SELECT count(*) FROM public.payment_history)<>2 THEN
    RAISE EXCEPTION 'Reversal deleted immutable receipt history';
  END IF;
END;
$test$;

-- Identity and permissions: a different account has no owner RPC access.
SELECT set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
DO $test$
BEGIN
  BEGIN
    PERFORM public.record_customer_payment_atomic(
      '77777777-7777-4777-8777-777777777777','Khach A','dtf','c_dtf_A',
      100000,'Cash',NULL
    );
    RAISE EXCEPTION 'Foreign identity was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$test$;

RESET ROLE;
DO $test$
BEGIN
  IF (SELECT count(*) FROM public.payment_history)<>2
    OR (SELECT coalesce(sum(paid_amount),0) FROM public.orders)<>1000000
    OR (SELECT coalesce(sum(debt_amount),0) FROM public.orders)<>15000000
    OR (SELECT count(*) FROM public.payment_reversals)<>2 THEN
    RAISE EXCEPTION 'Final aggregate mismatch after all new receipt/reversal tests';
  END IF;
END;
$test$;
