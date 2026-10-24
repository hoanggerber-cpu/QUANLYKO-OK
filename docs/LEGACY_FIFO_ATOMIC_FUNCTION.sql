-- Non-destructive compatibility release.
-- Keeps public.orders and public.payment_history as they are.
-- Does NOT create or alter tables, balances, login, or historic receipts.
-- IMPORTANT: Existing permissive RLS/grants are an unresolved security issue.
-- SECURITY INVOKER intentionally grants no additional underlying table access.
BEGIN;

CREATE OR REPLACE FUNCTION public.record_legacy_payment_atomic(
  p_payment_id uuid,
  p_customer_name text,
  p_customer_type text,
  p_customer_id text,
  p_amount numeric,
  p_method text,
  p_target_order_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.payment_history%ROWTYPE;
  v_order record;
  v_remaining numeric;
  v_amount numeric;
  v_affected integer := 0;
  v_total_debt numeric;
BEGIN
  IF p_payment_id IS NULL
     OR p_customer_name IS NULL OR length(btrim(p_customer_name)) NOT BETWEEN 1 AND 200
     OR p_customer_type NOT IN ('dtf','tshirt')
     OR p_customer_id IS NULL OR length(btrim(p_customer_id))=0
     OR p_amount IS NULL OR p_amount <= 0 OR p_amount<>trunc(p_amount)
     OR p_amount > 9007199254740991
     OR p_method IS NULL OR length(btrim(p_method)) NOT BETWEEN 1 AND 500
     OR (p_target_order_id IS NOT NULL AND length(btrim(p_target_order_id))=0)
  THEN
    RAISE EXCEPTION 'Invalid VND receipt' USING ERRCODE='22023';
  END IF;

  -- Serialize a customer's receipts across browser tabs and devices.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_customer_name || chr(30) || p_customer_type, 0
  ));

  -- Fixed immutable UUID is the idempotency key. After an uncertain timeout,
  -- a retry sees the exact previously committed receipt and MUST NOT pay twice.
  SELECT * INTO v_old FROM public.payment_history WHERE id=p_payment_id;
  IF FOUND THEN
    IF v_old.customer_name IS DISTINCT FROM p_customer_name
       OR v_old.type IS DISTINCT FROM p_customer_type
       OR v_old.customer_id IS DISTINCT FROM p_customer_id
       OR v_old.amount IS DISTINCT FROM p_amount
       OR v_old.payment_method IS DISTINCT FROM p_method
    THEN
      RAISE EXCEPTION 'Receipt identity collision' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('payment_id',p_payment_id,'state','committed','duplicate',true);
  END IF;

  -- Lock all customer invoices in FIFO order. Reject any corrupt baseline.
  -- A direct legacy writer not using this function is still a remaining risk
  -- until ALL writers are switched over; do not call this a global DB lock.
  SELECT coalesce(sum(o.debt_amount),0) INTO v_total_debt
    FROM public.orders o
    WHERE o.customer_name=p_customer_name AND o.type=p_customer_type
      AND (p_target_order_id IS NULL OR o.id=p_target_order_id);

  IF v_total_debt < p_amount THEN
    RAISE EXCEPTION 'Receipt exceeds current customer debt' USING ERRCODE='22023';
  END IF;

  v_remaining := p_amount;
  FOR v_order IN
    SELECT id,total_price,paid_amount,debt_amount
    FROM public.orders
    WHERE customer_name=p_customer_name AND type=p_customer_type
      AND (p_target_order_id IS NULL OR id=p_target_order_id)
    ORDER BY created_at ASC NULLS LAST,id ASC
    FOR UPDATE
  LOOP
    IF v_order.total_price IS NULL OR v_order.paid_amount IS NULL OR v_order.debt_amount IS NULL
       OR v_order.total_price <> v_order.paid_amount + v_order.debt_amount
       OR v_order.paid_amount < 0 OR v_order.debt_amount < 0
       OR v_order.total_price <> trunc(v_order.total_price)
       OR v_order.paid_amount <> trunc(v_order.paid_amount)
       OR v_order.debt_amount <> trunc(v_order.debt_amount)
    THEN
      RAISE EXCEPTION 'Invoice balance is invalid: %',v_order.id;
    END IF;
    EXIT WHEN v_remaining = 0;
    v_amount := least(v_order.debt_amount,v_remaining);
    IF v_amount <= 0 THEN CONTINUE; END IF;
    UPDATE public.orders
    SET paid_amount=v_order.paid_amount+v_amount,
        debt_amount=v_order.debt_amount-v_amount,
        status=CASE WHEN v_order.debt_amount=v_amount THEN 'completed' ELSE 'pending' END
    WHERE id=v_order.id
      AND paid_amount=v_order.paid_amount
      AND debt_amount=v_order.debt_amount;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent or stale invoice edit: %',v_order.id;
    END IF;
    v_affected := v_affected+1;
    v_remaining := v_remaining-v_amount;
  END LOOP;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Debt changed during allocation; rolling back receipt';
  END IF;

  -- Receipt and ALL invoice updates are one PostgreSQL transaction.
  INSERT INTO public.payment_history(
    id,customer_name,type,customer_id,amount,payment_method,created_at
  ) VALUES(
    p_payment_id,p_customer_name,p_customer_type,p_customer_id,p_amount,p_method,now()
  );
  RETURN jsonb_build_object(
    'payment_id',p_payment_id,'state','committed',
    'duplicate',false,'affected_orders',v_affected
  );
END;
$$;

-- No change to existing tables or their current grants. These RPC roles
-- already have table read/write privileges in the legacy deployment.
REVOKE ALL ON FUNCTION public.record_legacy_payment_atomic(
  uuid,text,text,text,numeric,text,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_legacy_payment_atomic(
  uuid,text,text,text,numeric,text,text
) TO anon,authenticated;

COMMIT;

-- No retroactive correction/reallocation. Historical balance adjustment,
-- receipt reversal and owner-only RLS are intentionally NOT activated.
