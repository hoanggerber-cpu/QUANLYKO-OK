-- Additive customer advance support: one credit_balance column on existing customers table.
-- No new tables, no backfill, no update of existing invoice or receipt amounts.
-- Newly created orders MUST call create_legacy_order_with_advance; old direct inserts do not consume credit.
-- IMPORTANT: Existing permissive RLS/grants are an unresolved security issue.
-- SECURITY INVOKER intentionally grants no additional underlying table access.
BEGIN;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS credit_balance numeric NOT NULL DEFAULT 0
  CHECK (credit_balance >= 0 AND credit_balance=trunc(credit_balance));
-- Existing production data has no duplicate (name,type); enforce one credit account.
CREATE UNIQUE INDEX IF NOT EXISTS customers_name_type_credit_key
  ON public.customers(name,type);

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
  v_credit numeric := 0;
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

  -- The remaining amount is an advance held for this exact customer and order type.
  -- Never overpay any invoice or rewrite its historical totals.
  IF v_remaining > 0 THEN
    INSERT INTO public.customers(id,name,type,credit_balance)
    VALUES('advance_' || md5(p_customer_type || chr(30) || p_customer_name),p_customer_name,p_customer_type,v_remaining)
    ON CONFLICT (name,type) DO UPDATE
      SET credit_balance=public.customers.credit_balance+EXCLUDED.credit_balance;
  END IF;

  -- Receipt and ALL invoice updates are one PostgreSQL transaction.
  INSERT INTO public.payment_history(
    id,customer_name,type,customer_id,amount,payment_method,created_at
  ) VALUES(
    p_payment_id,p_customer_name,p_customer_type,p_customer_id,p_amount,p_method,now()
  );
  RETURN jsonb_build_object(
    'payment_id',p_payment_id,'state','committed',
    'duplicate',false,'affected_orders',v_affected,'credit_added',v_remaining
  );
END;
$$;


-- Only explicit NEW order RPCs may consume customer advance.
-- Background recovery/backfill still inserts into orders directly without touching credit.
CREATE OR REPLACE FUNCTION public.create_legacy_order_with_advance(p_order jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
 v_name text := p_order->>'customer_name';
 v_type text := p_order->>'type';
 v_id text := p_order->>'id';
 v_total numeric := (p_order->>'total_price')::numeric;
 v_paid numeric := (p_order->>'paid_amount')::numeric;
 v_debt numeric := (p_order->>'debt_amount')::numeric;
 v_credit numeric := 0;
 v_use numeric := 0;
 v_existing public.orders%ROWTYPE;
BEGIN
 IF p_order IS NULL OR v_id IS NULL OR length(v_id)=0
    OR v_name IS NULL OR length(btrim(v_name)) NOT BETWEEN 1 AND 200
    OR v_type NOT IN ('dtf','tshirt')
    OR p_order->>'order_code' IS NULL OR length(p_order->>'order_code')=0
    OR v_total IS NULL OR v_paid IS NULL OR v_debt IS NULL
    OR v_total<0 OR v_paid<0 OR v_debt<0
    OR v_total<>v_paid+v_debt
    OR v_total<>trunc(v_total) OR v_paid<>trunc(v_paid) OR v_debt<>trunc(v_debt)
    OR v_total>9007199254740991
 THEN
   RAISE EXCEPTION 'Invalid new order values' USING ERRCODE='22023';
 END IF;

 PERFORM pg_advisory_xact_lock(hashtextextended(v_name||chr(30)||v_type,0));
 SELECT * INTO v_existing FROM public.orders WHERE id=v_id;
 IF FOUND THEN
   IF v_existing.customer_name IS DISTINCT FROM v_name
      OR v_existing.type IS DISTINCT FROM v_type
      OR v_existing.order_code IS DISTINCT FROM p_order->>'order_code'
      OR v_existing.total_price IS DISTINCT FROM v_total
   THEN RAISE EXCEPTION 'Order ID reused with different values' USING ERRCODE='23505'; END IF;
   RETURN jsonb_build_object('id',v_id,'paid_amount',v_existing.paid_amount,
     'debt_amount',v_existing.debt_amount,'status',v_existing.status,'duplicate',true);
 END IF;

 SELECT credit_balance INTO v_credit
 FROM public.customers
 WHERE name=v_name AND type=v_type
 FOR UPDATE;
 v_use:=least(coalesce(v_credit,0),v_debt);
 IF v_use>0 THEN
   UPDATE public.customers SET credit_balance=credit_balance-v_use
   WHERE name=v_name AND type=v_type;
 END IF;

 INSERT INTO public.orders(
   id,order_code,customer_name,type,product_name,color,quantity,unit_price,
   total_price,paid_amount,debt_amount,status,order_images,created_at
 ) VALUES(
   v_id,p_order->>'order_code',v_name,v_type,p_order->>'product_name',
   p_order->>'color',(p_order->>'quantity')::numeric,(p_order->>'unit_price')::numeric,
   v_total,v_paid+v_use,v_debt-v_use,
   CASE WHEN v_debt-v_use=0 THEN 'completed' ELSE coalesce(p_order->>'status','pending') END,
   p_order->>'order_images',(p_order->>'created_at')::timestamptz
 );
 RETURN jsonb_build_object('id',v_id,'paid_amount',v_paid+v_use,
   'debt_amount',v_debt-v_use,
   'status',CASE WHEN v_debt-v_use=0 THEN 'completed' ELSE coalesce(p_order->>'status','pending') END,
   'credit_used',v_use,'duplicate',false);
END;
$$;
REVOKE ALL ON FUNCTION public.create_legacy_order_with_advance(jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_legacy_order_with_advance(jsonb)
 TO anon,authenticated;

-- Existing orders/payment history remain untouched. These RPC roles
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
