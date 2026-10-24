-- DESIGN DRAFT FOR ISOLATED STAGING ONLY, NOT DEPLOYED TO PRODUCTION.
-- Requires tested owner-only RLS on orders and payment_history.
-- Only new receipts are supported. Historical payments must be reconciled separately.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  payment_id uuid NOT NULL REFERENCES public.payment_history(id) ON DELETE RESTRICT,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0 AND amount = trunc(amount)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, order_id)
);
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_allocations FROM PUBLIC, anon, authenticated;
CREATE POLICY owner_payment_allocations ON public.payment_allocations
 FOR ALL TO authenticated
 USING ((select auth.uid()) = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
 WITH CHECK ((select auth.uid()) = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
GRANT SELECT, INSERT ON public.payment_allocations TO authenticated;

-- This function never uses SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.record_customer_payment_atomic(
 p_payment_id uuid,
 p_customer_name text,
 p_customer_type text,
 p_amount numeric,
 p_method text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
 v_previous public.payment_history%ROWTYPE;
 v_order record;
 v_remaining numeric;
 v_apply numeric;
 v_applied numeric;
 v_new_paid numeric;
 v_new_debt numeric;
 v_affected integer := 0;
BEGIN
 IF auth.uid() IS DISTINCT FROM '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid THEN
   RAISE EXCEPTION 'Owner authorization required' USING ERRCODE = '42501';
 END IF;
 IF p_payment_id IS NULL OR p_customer_name IS NULL OR length(trim(p_customer_name)) = 0
    OR p_customer_type NOT IN ('dtf', 'tshirt')
    OR p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount)
    OR p_method IS NULL OR length(trim(p_method)) = 0 THEN
   RAISE EXCEPTION 'Invalid receipt fields' USING ERRCODE = '22023';
 END IF;

 -- Serialize all new receipts for one exact customer/type.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_name || chr(30) || p_customer_type, 0));

 SELECT * INTO v_previous
 FROM public.payment_history WHERE id = p_payment_id FOR UPDATE;
 IF FOUND THEN
   IF v_previous.customer_name IS DISTINCT FROM p_customer_name
      OR v_previous.type IS DISTINCT FROM p_customer_type
      OR v_previous.amount IS DISTINCT FROM p_amount
      OR v_previous.payment_method IS DISTINCT FROM p_method THEN
     RAISE EXCEPTION 'Receipt idempotency ID reused for a different payment';
   END IF;
   SELECT coalesce(sum(amount),0) INTO v_applied
   FROM public.payment_allocations WHERE payment_id = p_payment_id;
   IF v_applied <> p_amount THEN
     RAISE EXCEPTION 'Existing historical receipt has no matching allocation journal';
   END IF;
   RETURN jsonb_build_object('id',p_payment_id,'applied',v_applied,'duplicate',true);
 END IF;

 -- Any later error rolls back this insert AND all following order updates.
 INSERT INTO public.payment_history
   (id, customer_name, type, customer_id, amount, payment_method, created_at)
 VALUES
   (p_payment_id,p_customer_name,p_customer_type,
    'c_' || p_customer_type || '_' || replace(replace(encode(convert_to(p_customer_name,'UTF8'),'base64'),E'\n',''),'=',''),
    p_amount,p_method,now());

 v_remaining := p_amount;
 FOR v_order IN
   SELECT id,total_price,paid_amount,debt_amount
   FROM public.orders
   WHERE customer_name = p_customer_name
     AND type = p_customer_type AND debt_amount > 0
   ORDER BY created_at ASC, id ASC
   FOR UPDATE
 LOOP
   IF v_order.total_price IS DISTINCT FROM (v_order.paid_amount + v_order.debt_amount)
      OR v_order.paid_amount < 0 OR v_order.debt_amount < 0 THEN
     RAISE EXCEPTION 'Invalid invoice accounting invariant: %', v_order.id;
   END IF;
   v_apply := least(v_order.debt_amount,v_remaining);
   EXIT WHEN v_apply <= 0;
   v_new_paid := v_order.paid_amount + v_apply;
   v_new_debt := v_order.debt_amount - v_apply;
   UPDATE public.orders SET
       paid_amount = v_new_paid,
       debt_amount = v_new_debt,
       status = CASE WHEN v_new_debt = 0 THEN 'completed' ELSE 'pending' END
     WHERE id = v_order.id
       AND paid_amount = v_order.paid_amount
       AND debt_amount = v_order.debt_amount;
   IF NOT FOUND THEN
     RAISE EXCEPTION 'Concurrent invoice change: %', v_order.id;
   END IF;
   INSERT INTO public.payment_allocations(payment_id,order_id,amount)
     VALUES(p_payment_id,v_order.id,v_apply);
   v_affected := v_affected + 1;
   v_remaining := v_remaining - v_apply;
   EXIT WHEN v_remaining = 0;
 END LOOP;
 IF v_remaining <> 0 THEN
   RAISE EXCEPTION 'Payment exceeds verified outstanding customer debt';
 END IF;
 RETURN jsonb_build_object('id',p_payment_id,'applied',p_amount,'affected_orders',v_affected,'duplicate',false);
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_payment_atomic(uuid,text,text,numeric,text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_atomic(uuid,text,text,numeric,text)
 TO authenticated;

COMMIT;

-- REQUIRED BEFORE INTEGRATION:
-- 1. Use a durable client-generated UUID (pending outbox entry) for retries.
-- 2. Test concurrent browsers, timeout-after-commit, amount overflow,
--    rollback-on-bad-item, negative authorization, and RLS permissions.
-- 3. Support single-invoice payments with a separate journaled transactional RPC.
-- 4. Implement allocation-aware reversal; DO NOT use legacy blanket FIFO reset.
-- 5. Test all of the above on a staging database before any production change.
