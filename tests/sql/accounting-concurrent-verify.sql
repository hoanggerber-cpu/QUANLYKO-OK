\set ON_ERROR_STOP on
-- Executed after two concurrent independent 5,000,000 VND receipts
-- on 7,000,000 VND open debt. Exactly one must have committed.
DO $test$
DECLARE active_count integer;
DECLARE live_total numeric;
DECLARE live_paid numeric;
DECLARE live_debt numeric;
BEGIN
  SELECT count(*) INTO active_count
  FROM public.payment_history h
  WHERE h.payment_method='Concurrent test'
    AND NOT EXISTS (SELECT 1 FROM public.payment_reversals r WHERE r.payment_id=h.id);
  SELECT coalesce(sum(total_price),0),coalesce(sum(paid_amount),0),coalesce(sum(debt_amount),0)
    INTO live_total,live_paid,live_debt
  FROM public.orders WHERE customer_name='Khach A' AND type='dtf';
  IF active_count<>1 OR live_total<>8000000 OR live_paid<>6000000 OR live_debt<>2000000 THEN
    RAISE EXCEPTION 'Concurrent cash collection produced incorrect ledger: receipts %, paid %, debt %',
      active_count,live_paid,live_debt;
  END IF;
  IF (SELECT coalesce(sum(paid_amount),0) FROM public.orders WHERE customer_name='Khach B')<>0 THEN
    RAISE EXCEPTION 'Concurrent collection affected another customer';
  END IF;
  RAISE NOTICE 'PASS: exactly one 5,000,000 VND receipt, final debt 2,000,000 VND';
END;
$test$;
