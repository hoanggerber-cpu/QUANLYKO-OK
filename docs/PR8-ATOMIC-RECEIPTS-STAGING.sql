-- STAGING ONLY. DO NOT APPLY TO PRODUCTION OR MERGE PR #8 UNTIL
-- AUTH, RLS, OFFLINE RETRY, FINANCIAL RECONCILIATION AND E2E GATES PASS.
-- This migration is ADDITIVE: no existing payment history, invoices or paid/debt
-- columns are rewritten. Test in an isolated database with synthetic orders.
-- Use the existing owner-only RLS migration before enabling these RPCs.

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_allocations (
  payment_id uuid NOT NULL REFERENCES public.payment_history(id) ON DELETE RESTRICT,
  order_id text NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0 AND amount = trunc(amount)),
  paid_before numeric NOT NULL,
  debt_before numeric NOT NULL,
  paid_after numeric NOT NULL,
  debt_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_id, order_id),
  CHECK (paid_after - paid_before = amount),
  CHECK (debt_before - debt_after = amount),
  CHECK (paid_before >= 0 AND debt_after >= 0)
);
CREATE INDEX IF NOT EXISTS payment_allocations_order_idx
  ON public.payment_allocations(order_id);

CREATE TABLE IF NOT EXISTS public.payment_reversals (
  payment_id uuid PRIMARY KEY REFERENCES public.payment_history(id) ON DELETE RESTRICT,
  reversal_id uuid NOT NULL UNIQUE,
  reversed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_reversals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_allocations, public.payment_reversals
  FROM PUBLIC, anon, authenticated;

CREATE POLICY owner_payment_allocations ON public.payment_allocations
  FOR ALL TO authenticated
  USING ((select auth.uid()) = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid()) = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
CREATE POLICY owner_payment_reversals ON public.payment_reversals
  FOR ALL TO authenticated
  USING ((select auth.uid()) = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid()) = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
GRANT SELECT, INSERT ON public.payment_allocations, public.payment_reversals
  TO authenticated;

-- Only owner may execute. SECURITY INVOKER intentionally respects RLS.
-- No external/public role may call this function.
CREATE OR REPLACE FUNCTION public.record_customer_payment_atomic(
  p_payment_id uuid,
  p_customer_name text,
  p_customer_type text,
  p_customer_id text,
  p_amount numeric,
  p_method text,
  p_target_order_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.payment_history%ROWTYPE;
  v_row record;
  v_remaining numeric;
  v_apply numeric;
  v_count integer := 0;
  v_reversed boolean;
BEGIN
  IF auth.uid() IS DISTINCT FROM '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid THEN
    RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501';
  END IF;
  IF p_payment_id IS NULL OR p_customer_name IS NULL
    OR length(trim(p_customer_name)) NOT BETWEEN 1 AND 200
    OR p_customer_type NOT IN ('dtf', 'tshirt')
    OR p_customer_id IS NULL OR length(trim(p_customer_id))=0
    OR p_amount IS NULL OR p_amount<=0 OR p_amount<>trunc(p_amount)
    OR p_amount > 9007199254740991
    OR p_method IS NULL OR length(trim(p_method)) NOT BETWEEN 1 AND 500
    OR (p_target_order_id IS NOT NULL AND length(trim(p_target_order_id))=0)
  THEN
    RAISE EXCEPTION 'Invalid receipt fields' USING ERRCODE='22023';
  END IF;

  -- Serializes receipts for one customer/type across ALL browsers.
  -- Keep payment_history append-only; identity is protected by the advisory lock and primary key.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_customer_name || chr(30) || p_customer_type, 0
  ));

  SELECT * INTO v_existing FROM public.payment_history
    WHERE id=p_payment_id;
  IF FOUND THEN
    IF v_existing.customer_name IS DISTINCT FROM p_customer_name
      OR v_existing.type IS DISTINCT FROM p_customer_type
      OR v_existing.customer_id IS DISTINCT FROM p_customer_id
      OR v_existing.amount IS DISTINCT FROM p_amount
      OR v_existing.payment_method IS DISTINCT FROM p_method
    THEN
      RAISE EXCEPTION 'Payment ID reused for another receipt' USING ERRCODE='23505';
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.payment_reversals
      WHERE payment_id=p_payment_id) INTO v_reversed;
    IF v_reversed THEN
      RETURN jsonb_build_object('payment_id',p_payment_id,'state','reversed','duplicate',true);
    END IF;
    IF (SELECT coalesce(sum(amount),0) FROM public.payment_allocations
        WHERE payment_id=p_payment_id) <> p_amount THEN
      RAISE EXCEPTION 'Existing receipt has incomplete allocation journal';
    END IF;
    RETURN jsonb_build_object('payment_id',p_payment_id,'state','committed','duplicate',true);
  END IF;

  -- Lock the exact affected rows, check client debt against live database,
  -- and ensure enough outstanding debt exists before inserting a receipt.
  IF p_target_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE id=p_target_order_id AND customer_name=p_customer_name
        AND type=p_customer_type AND debt_amount>=p_amount
    ) THEN
      RAISE EXCEPTION 'Invoice missing or payment exceeds its current debt';
    END IF;
  ELSIF (SELECT coalesce(sum(debt_amount),0) FROM public.orders
         WHERE customer_name=p_customer_name AND type=p_customer_type)
        < p_amount THEN
    RAISE EXCEPTION 'Payment exceeds current customer debt';
  END IF;

  INSERT INTO public.payment_history (
    id,customer_id,customer_name,type,amount,payment_method,created_at
  ) VALUES (
    p_payment_id,p_customer_id,p_customer_name,p_customer_type,p_amount,p_method,now()
  );

  v_remaining := p_amount;
  FOR v_row IN
    SELECT id,total_price,paid_amount,debt_amount,status
    FROM public.orders
    WHERE customer_name=p_customer_name AND type=p_customer_type AND debt_amount>0
      AND (p_target_order_id IS NULL OR id=p_target_order_id)
    ORDER BY created_at ASC,id ASC FOR UPDATE
  LOOP
    IF v_row.total_price IS DISTINCT FROM v_row.paid_amount+v_row.debt_amount
      OR v_row.total_price<0 OR v_row.paid_amount<0 OR v_row.debt_amount<0
    THEN
      RAISE EXCEPTION 'Invalid accounting invariant on invoice %', v_row.id;
    END IF;
    v_apply := least(v_row.debt_amount,v_remaining);
    EXIT WHEN v_apply <= 0;

    UPDATE public.orders SET
      paid_amount=v_row.paid_amount+v_apply,
      debt_amount=v_row.debt_amount-v_apply,
      status=CASE WHEN v_row.debt_amount=v_apply THEN 'completed' ELSE 'pending' END
    WHERE id=v_row.id AND paid_amount=v_row.paid_amount
      AND debt_amount=v_row.debt_amount;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Concurrent invoice update detected';
    END IF;
    INSERT INTO public.payment_allocations (
      payment_id,order_id,amount,paid_before,debt_before,paid_after,debt_after
    ) VALUES (
      p_payment_id,v_row.id,v_apply,v_row.paid_amount,v_row.debt_amount,
      v_row.paid_amount+v_apply,v_row.debt_amount-v_apply
    );
    v_count := v_count+1;
    v_remaining := v_remaining-v_apply;
    EXIT WHEN v_remaining=0;
  END LOOP;

  -- Any failure rolls back history, all invoice changes AND allocations.
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'Could not allocate entire receipt; transaction rolled back';
  END IF;
  RETURN jsonb_build_object(
    'payment_id',p_payment_id,'state','committed',
    'duplicate',false,'applied',p_amount,'affected_orders',v_count
  );
END;
$$;

-- A reversal is permitted only when every affected invoice still has the
-- paid/debt snapshot produced by THIS receipt. If more payments/edits followed,
-- reject instead of silently recomputing all historical accounts.
CREATE OR REPLACE FUNCTION public.reverse_customer_payment_atomic(
  p_payment_id uuid,
  p_reversal_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt public.payment_history%ROWTYPE;
  v_reversal public.payment_reversals%ROWTYPE;
  v_row record;
  v_total numeric;
BEGIN
  IF auth.uid() IS DISTINCT FROM '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid THEN
    RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501';
  END IF;
  IF p_payment_id IS NULL OR p_reversal_id IS NULL THEN
    RAISE EXCEPTION 'Missing receipt or reversal identity' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_receipt FROM public.payment_history
    WHERE id=p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_receipt.customer_name || chr(30) || v_receipt.type,0
  ));
  SELECT * INTO v_receipt FROM public.payment_history
    WHERE id=p_payment_id;
  SELECT * INTO v_reversal FROM public.payment_reversals
    WHERE payment_id=p_payment_id;
  IF FOUND THEN
    IF v_reversal.reversal_id<>p_reversal_id THEN
      RAISE EXCEPTION 'Receipt already reversed under another operation';
    END IF;
    RETURN jsonb_build_object(
      'payment_id',p_payment_id,'state','reversed','duplicate',true
    );
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_total
    FROM public.payment_allocations WHERE payment_id=p_payment_id;
  IF v_total<>v_receipt.amount THEN
    RAISE EXCEPTION 'Legacy/unjournaled receipt cannot be automatically reversed';
  END IF;

  FOR v_row IN
    SELECT a.order_id,a.amount,a.paid_after,a.debt_after,
      o.paid_amount,o.debt_amount,o.total_price
    FROM public.payment_allocations a
    JOIN public.orders o ON o.id=a.order_id
    WHERE a.payment_id=p_payment_id
    ORDER BY o.id FOR UPDATE OF o
  LOOP
    IF v_row.paid_amount IS DISTINCT FROM v_row.paid_after
       OR v_row.debt_amount IS DISTINCT FROM v_row.debt_after
       OR v_row.total_price IS DISTINCT FROM (v_row.paid_amount+v_row.debt_amount)
    THEN
      RAISE EXCEPTION 'Later edits/payments found; manual reconciliation required for invoice %',v_row.order_id;
    END IF;
    UPDATE public.orders SET
      paid_amount=v_row.paid_amount-v_row.amount,
      debt_amount=v_row.debt_amount+v_row.amount,
      status=CASE WHEN v_row.debt_amount+v_row.amount=0 THEN 'completed' ELSE 'pending' END
    WHERE id=v_row.order_id
      AND paid_amount=v_row.paid_amount
      AND debt_amount=v_row.debt_amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'Concurrent order edit detected'; END IF;
  END LOOP;

  INSERT INTO public.payment_reversals(payment_id,reversal_id)
    VALUES(p_payment_id,p_reversal_id);
  RETURN jsonb_build_object(
    'payment_id',p_payment_id,'state','reversed','duplicate',false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_payment_atomic(
  uuid,text,text,text,numeric,text,text
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_atomic(
  uuid,text,text,text,numeric,text,text
) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_customer_payment_atomic(
  uuid,uuid
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_customer_payment_atomic(
  uuid,uuid
) TO authenticated;

COMMIT;

-- The production data contains legacy direct payments and incomplete
-- payment_history/allocation linkage. DO NOT backfill by guessing.
-- The old "reset all paid=0, replay history" algorithm must stay disabled.
-- Pre-release tests: negative RLS, duplicate receipt ID, concurrent browsers,
-- timeout-after-commit, partial payment across invoices, insufficient balance,
-- legacy reversal denial, later-payment reversal denial, status and sum checks.
