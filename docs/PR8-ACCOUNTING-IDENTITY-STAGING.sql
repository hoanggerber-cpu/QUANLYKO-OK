-- STAGING ONLY. Apply only to an isolated staging project after a backup.
-- This migration never guesses historical receipt-to-invoice allocations.
-- It snapshots current invoice balances as an immutable opening ledger, then
-- requires all NEW order/payment money mutations to use atomic RPCs.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_accounting_customer_name(p_name text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT lower(regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g'))
$$;

CREATE TABLE IF NOT EXISTS public.accounting_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_type text NOT NULL CHECK (customer_type IN ('dtf','tshirt')),
  canonical_name text NOT NULL CHECK (length(btrim(canonical_name)) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, customer_type)
);

CREATE TABLE IF NOT EXISTS public.accounting_customer_aliases (
  customer_type text NOT NULL CHECK (customer_type IN ('dtf','tshirt')),
  normalized_name text NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 500),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 500),
  accounting_customer_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_type, normalized_name),
  FOREIGN KEY (accounting_customer_id, customer_type)
    REFERENCES public.accounting_customers(id, customer_type) ON DELETE RESTRICT
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS accounting_customer_id uuid;

ALTER TABLE public.payment_history
  ADD COLUMN IF NOT EXISTS accounting_customer_id uuid,
  ADD COLUMN IF NOT EXISTS accounting_origin text NOT NULL DEFAULT 'legacy'
    CHECK (accounting_origin IN ('legacy','atomic_receipt','initial_order_payment'));

CREATE TABLE IF NOT EXISTS public.accounting_order_opening_balances (
  order_id text PRIMARY KEY REFERENCES public.orders(id) ON DELETE RESTRICT,
  opening_total_price numeric NOT NULL CHECK (opening_total_price >= 0 AND opening_total_price = trunc(opening_total_price)),
  opening_paid_amount numeric NOT NULL CHECK (opening_paid_amount >= 0 AND opening_paid_amount = trunc(opening_paid_amount)),
  opening_debt_amount numeric NOT NULL CHECK (opening_debt_amount >= 0 AND opening_debt_amount = trunc(opening_debt_amount)),
  baseline_kind text NOT NULL CHECK (baseline_kind IN ('legacy_snapshot','created_order')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  CHECK (opening_total_price = opening_paid_amount + opening_debt_amount)
);

-- Build one stable identity for each current name/type pair. Case and repeated
-- whitespace differences are normalized. Other spelling changes are NOT guessed.
WITH raw_names AS (
  SELECT type AS customer_type, btrim(customer_name) AS display_name FROM public.orders
  UNION ALL
  SELECT type AS customer_type, btrim(customer_name) AS display_name FROM public.payment_history
), normalized AS (
  SELECT customer_type,
         public.normalize_accounting_customer_name(display_name) AS normalized_name,
         min(display_name) AS display_name
  FROM raw_names
  WHERE length(public.normalize_accounting_customer_name(display_name)) > 0
  GROUP BY customer_type, public.normalize_accounting_customer_name(display_name)
)
INSERT INTO public.accounting_customers(customer_type, canonical_name)
SELECT n.customer_type, n.display_name
FROM normalized n
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounting_customer_aliases a
  WHERE a.customer_type=n.customer_type AND a.normalized_name=n.normalized_name
);

WITH raw_names AS (
  SELECT type AS customer_type, btrim(customer_name) AS display_name FROM public.orders
  UNION ALL
  SELECT type AS customer_type, btrim(customer_name) AS display_name FROM public.payment_history
), normalized AS (
  SELECT customer_type,
         public.normalize_accounting_customer_name(display_name) AS normalized_name,
         min(display_name) AS display_name
  FROM raw_names
  WHERE length(public.normalize_accounting_customer_name(display_name)) > 0
  GROUP BY customer_type, public.normalize_accounting_customer_name(display_name)
)
INSERT INTO public.accounting_customer_aliases(
  customer_type, normalized_name, display_name, accounting_customer_id
)
SELECT n.customer_type, n.normalized_name, n.display_name, c.id
FROM normalized n
JOIN public.accounting_customers c
  ON c.customer_type=n.customer_type
 AND public.normalize_accounting_customer_name(c.canonical_name)=n.normalized_name
ON CONFLICT (customer_type, normalized_name) DO NOTHING;

UPDATE public.orders o
SET accounting_customer_id=a.accounting_customer_id
FROM public.accounting_customer_aliases a
WHERE a.customer_type=o.type
  AND a.normalized_name=public.normalize_accounting_customer_name(o.customer_name)
  AND o.accounting_customer_id IS NULL;

UPDATE public.payment_history p
SET accounting_customer_id=a.accounting_customer_id
FROM public.accounting_customer_aliases a
WHERE a.customer_type=p.type
  AND a.normalized_name=public.normalize_accounting_customer_name(p.customer_name)
  AND p.accounting_customer_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE accounting_customer_id IS NULL) THEN
    RAISE EXCEPTION 'Identity backfill incomplete for orders. Stop and manually reconcile before proceeding.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.payment_history WHERE accounting_customer_id IS NULL) THEN
    RAISE EXCEPTION 'Identity backfill incomplete for payment history. Stop and manually reconcile before proceeding.';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_accounting_customer_fk') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_accounting_customer_fk
      FOREIGN KEY (accounting_customer_id) REFERENCES public.accounting_customers(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_history_accounting_customer_fk') THEN
    ALTER TABLE public.payment_history ADD CONSTRAINT payment_history_accounting_customer_fk
      FOREIGN KEY (accounting_customer_id) REFERENCES public.accounting_customers(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS orders_accounting_customer_debt_idx
  ON public.orders(accounting_customer_id, created_at, id) WHERE debt_amount > 0;
CREATE INDEX IF NOT EXISTS payment_history_accounting_customer_idx
  ON public.payment_history(accounting_customer_id, created_at);

-- Database-level invariants. The production audit found zero invalid or NULL
-- order/receipt amounts; if staging differs, validation aborts rather than
-- silently rewriting balances.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='orders_accounting_amounts_check') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_accounting_amounts_check
      CHECK (
        total_price IS NOT NULL AND paid_amount IS NOT NULL AND debt_amount IS NOT NULL
        AND total_price >= 0 AND paid_amount >= 0 AND debt_amount >= 0
        AND total_price = paid_amount + debt_amount
        AND total_price = trunc(total_price)
        AND paid_amount = trunc(paid_amount)
        AND debt_amount = trunc(debt_amount)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_history_amount_check') THEN
    ALTER TABLE public.payment_history ADD CONSTRAINT payment_history_amount_check
      CHECK (amount IS NOT NULL AND amount > 0 AND amount = trunc(amount)) NOT VALID;
  END IF;
END;
$$;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_accounting_amounts_check;
ALTER TABLE public.payment_history VALIDATE CONSTRAINT payment_history_amount_check;

-- Immutable opening snapshots preserve the exact state at cutover. Legacy
-- balances are treated as a baseline, not falsely attributed to guessed receipts.
INSERT INTO public.accounting_order_opening_balances(
  order_id, opening_total_price, opening_paid_amount, opening_debt_amount, baseline_kind
)
SELECT id, total_price, paid_amount, debt_amount, 'legacy_snapshot'
FROM public.orders
ON CONFLICT (order_id) DO NOTHING;

ALTER TABLE public.accounting_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_customer_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_order_opening_balances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.accounting_customers, public.accounting_customer_aliases,
  public.accounting_order_opening_balances FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.accounting_customers,
  public.accounting_customer_aliases TO authenticated;
GRANT SELECT, INSERT ON public.accounting_order_opening_balances TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT SELECT, INSERT ON public.payment_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT SELECT, INSERT ON public.payment_allocations, public.payment_reversals TO authenticated;

DROP POLICY IF EXISTS owner_accounting_customers ON public.accounting_customers;
CREATE POLICY owner_accounting_customers ON public.accounting_customers
  FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
DROP POLICY IF EXISTS owner_accounting_customer_aliases ON public.accounting_customer_aliases;
CREATE POLICY owner_accounting_customer_aliases ON public.accounting_customer_aliases
  FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
DROP POLICY IF EXISTS owner_accounting_opening_balances ON public.accounting_order_opening_balances;
CREATE POLICY owner_accounting_opening_balances ON public.accounting_order_opening_balances
  FOR SELECT TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
CREATE POLICY owner_accounting_opening_balances_insert ON public.accounting_order_opening_balances
  FOR INSERT TO authenticated
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);

CREATE OR REPLACE FUNCTION public.resolve_accounting_customer_identity(
  p_customer_name text,
  p_customer_type text
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_normalized text;
  v_id uuid;
BEGIN
  IF auth.uid() IS DISTINCT FROM '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid THEN
    RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501';
  END IF;
  IF p_customer_name IS NULL OR length(btrim(p_customer_name)) NOT BETWEEN 1 AND 200
     OR p_customer_type NOT IN ('dtf','tshirt') THEN
    RAISE EXCEPTION 'Invalid customer identity' USING ERRCODE='22023';
  END IF;
  v_normalized := public.normalize_accounting_customer_name(p_customer_name);
  PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_type || chr(30) || v_normalized, 0));
  SELECT accounting_customer_id INTO v_id
  FROM public.accounting_customer_aliases
  WHERE customer_type=p_customer_type AND normalized_name=v_normalized;
  IF FOUND THEN RETURN v_id; END IF;

  INSERT INTO public.accounting_customers(customer_type,canonical_name)
  VALUES(p_customer_type,btrim(p_customer_name))
  RETURNING id INTO v_id;
  INSERT INTO public.accounting_customer_aliases(
    customer_type,normalized_name,display_name,accounting_customer_id
  ) VALUES (p_customer_type,v_normalized,btrim(p_customer_name),v_id);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_accounting_customer_identity(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_accounting_customer_identity(text,text) TO authenticated;

-- Only the atomic RPCs may change balances or financial history after cutover.
CREATE OR REPLACE FUNCTION public.guard_accounting_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_atomic boolean := current_setting('app.accounting_atomic_write',true)='on';
BEGIN
  IF TG_TABLE_NAME='orders' THEN
    IF TG_OP='DELETE' THEN
      RAISE EXCEPTION 'Deleting financial invoices is disabled; use an audited cancellation flow';
    ELSIF TG_OP='INSERT' AND NOT v_atomic THEN
      RAISE EXCEPTION 'Create invoices through create_order_atomic';
    ELSIF TG_OP='UPDATE' AND NOT v_atomic AND (
      OLD.order_code IS DISTINCT FROM NEW.order_code OR
      OLD.customer_name IS DISTINCT FROM NEW.customer_name OR
      OLD.type IS DISTINCT FROM NEW.type OR
      OLD.product_name IS DISTINCT FROM NEW.product_name OR
      OLD.color IS DISTINCT FROM NEW.color OR
      OLD.quantity IS DISTINCT FROM NEW.quantity OR
      OLD.unit_price IS DISTINCT FROM NEW.unit_price OR
      OLD.total_price IS DISTINCT FROM NEW.total_price OR
      OLD.paid_amount IS DISTINCT FROM NEW.paid_amount OR
      OLD.debt_amount IS DISTINCT FROM NEW.debt_amount OR
      OLD.status IS DISTINCT FROM NEW.status OR
      OLD.order_images IS DISTINCT FROM NEW.order_images OR
      OLD.accounting_customer_id IS DISTINCT FROM NEW.accounting_customer_id OR
      OLD.created_at IS DISTINCT FROM NEW.created_at
    ) THEN
      RAISE EXCEPTION 'Financial invoice changes require an atomic audited operation';
    END IF;
  ELSIF TG_TABLE_NAME='payment_history' THEN
    IF TG_OP<>'INSERT' THEN
      RAISE EXCEPTION 'Payment history is append-only';
    ELSIF NOT v_atomic THEN
      RAISE EXCEPTION 'Record receipts through an atomic accounting RPC';
    END IF;
  ELSIF TG_TABLE_NAME IN ('payment_allocations','payment_reversals','accounting_order_opening_balances') THEN
    IF TG_OP<>'INSERT' OR NOT v_atomic THEN
      RAISE EXCEPTION 'Accounting journals are immutable and may only be written by an atomic accounting RPC';
    END IF;
  ELSIF TG_TABLE_NAME='order_items' THEN
    IF TG_OP='DELETE' OR (TG_OP='INSERT' AND NOT v_atomic) OR
       (TG_OP='UPDATE' AND NOT v_atomic AND (
          OLD.order_id IS DISTINCT FROM NEW.order_id OR
          OLD.type IS DISTINCT FROM NEW.type OR
          OLD.product_name IS DISTINCT FROM NEW.product_name OR
          OLD.quantity IS DISTINCT FROM NEW.quantity OR
          OLD.unit_price IS DISTINCT FROM NEW.unit_price OR
          OLD.total_price IS DISTINCT FROM NEW.total_price
       )) THEN
      RAISE EXCEPTION 'Invoice line changes require an atomic audited operation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounting_guard_orders ON public.orders;
CREATE TRIGGER accounting_guard_orders BEFORE INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_ledger_mutation();
DROP TRIGGER IF EXISTS accounting_guard_payment_history ON public.payment_history;
CREATE TRIGGER accounting_guard_payment_history BEFORE INSERT OR UPDATE OR DELETE ON public.payment_history
  FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_ledger_mutation();
DROP TRIGGER IF EXISTS accounting_guard_payment_allocations ON public.payment_allocations;
CREATE TRIGGER accounting_guard_payment_allocations BEFORE INSERT OR UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_ledger_mutation();
DROP TRIGGER IF EXISTS accounting_guard_payment_reversals ON public.payment_reversals;
CREATE TRIGGER accounting_guard_payment_reversals BEFORE INSERT OR UPDATE OR DELETE ON public.payment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_ledger_mutation();
DROP TRIGGER IF EXISTS accounting_guard_opening_balances ON public.accounting_order_opening_balances;
CREATE TRIGGER accounting_guard_opening_balances BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_order_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_ledger_mutation();
DROP TRIGGER IF EXISTS accounting_guard_order_items ON public.order_items;
CREATE TRIGGER accounting_guard_order_items BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_ledger_mutation();

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
  v_customer_uuid uuid;
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

  v_customer_uuid := public.resolve_accounting_customer_identity(p_customer_name,p_customer_type);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_customer_uuid::text,0));

  SELECT * INTO v_existing FROM public.payment_history WHERE id=p_payment_id;
  IF FOUND THEN
    IF v_existing.customer_name IS DISTINCT FROM p_customer_name
      OR v_existing.type IS DISTINCT FROM p_customer_type
      OR v_existing.customer_id IS DISTINCT FROM p_customer_id
      OR v_existing.accounting_customer_id IS DISTINCT FROM v_customer_uuid
      OR v_existing.amount IS DISTINCT FROM p_amount
      OR v_existing.payment_method IS DISTINCT FROM p_method
    THEN
      RAISE EXCEPTION 'Payment ID reused for another receipt' USING ERRCODE='23505';
    END IF;
    SELECT EXISTS(SELECT 1 FROM public.payment_reversals WHERE payment_id=p_payment_id) INTO v_reversed;
    IF v_reversed THEN
      RETURN jsonb_build_object('payment_id',p_payment_id,'state','reversed','duplicate',true);
    END IF;
    IF (SELECT coalesce(sum(amount),0) FROM public.payment_allocations WHERE payment_id=p_payment_id) <> p_amount THEN
      RAISE EXCEPTION 'Existing receipt has incomplete allocation journal';
    END IF;
    RETURN jsonb_build_object('payment_id',p_payment_id,'state','committed','duplicate',true);
  END IF;

  IF p_target_order_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.orders
      WHERE id=p_target_order_id AND accounting_customer_id=v_customer_uuid
        AND type=p_customer_type AND status<>'cancelled' AND debt_amount>=p_amount
    ) THEN
      RAISE EXCEPTION 'Invoice missing or payment exceeds its current debt';
    END IF;
  ELSIF (SELECT coalesce(sum(debt_amount),0) FROM public.orders
         WHERE accounting_customer_id=v_customer_uuid AND status<>'cancelled') < p_amount THEN
    RAISE EXCEPTION 'Payment exceeds current customer debt';
  END IF;

  PERFORM set_config('app.accounting_atomic_write','on',true);
  INSERT INTO public.payment_history(
    id,customer_id,customer_name,type,amount,payment_method,created_at,
    accounting_customer_id,accounting_origin
  ) VALUES (
    p_payment_id,p_customer_id,p_customer_name,p_customer_type,p_amount,p_method,now(),
    v_customer_uuid,'atomic_receipt'
  );

  v_remaining := p_amount;
  FOR v_row IN
    SELECT o.id,o.total_price,o.paid_amount,o.debt_amount,o.status,
      b.opening_total_price,b.opening_paid_amount,b.opening_debt_amount,
      coalesce(j.net_allocated,0) AS net_allocated
    FROM public.orders o
    LEFT JOIN public.accounting_order_opening_balances b ON b.order_id=o.id
    LEFT JOIN LATERAL (
      SELECT coalesce(sum(a.amount) FILTER (WHERE r.payment_id IS NULL),0) AS net_allocated
      FROM public.payment_allocations a
      LEFT JOIN public.payment_reversals r ON r.payment_id=a.payment_id
      WHERE a.order_id=o.id
    ) j ON true
    WHERE o.accounting_customer_id=v_customer_uuid AND o.debt_amount>0
      AND o.status<>'cancelled'
      AND (p_target_order_id IS NULL OR o.id=p_target_order_id)
    ORDER BY o.created_at ASC,o.id ASC
    FOR UPDATE OF o
  LOOP
    IF v_row.opening_total_price IS NULL
      OR v_row.total_price IS DISTINCT FROM v_row.opening_total_price
      OR v_row.paid_amount IS DISTINCT FROM (v_row.opening_paid_amount+v_row.net_allocated)
      OR v_row.debt_amount IS DISTINCT FROM (v_row.opening_debt_amount-v_row.net_allocated)
      OR v_row.total_price IS DISTINCT FROM v_row.paid_amount+v_row.debt_amount
      OR v_row.total_price<0 OR v_row.paid_amount<0 OR v_row.debt_amount<0
    THEN
      RAISE EXCEPTION 'Invoice % failed opening-balance reconciliation; receipt rolled back',v_row.id;
    END IF;
    v_apply := least(v_row.debt_amount,v_remaining);
    EXIT WHEN v_apply<=0;

    UPDATE public.orders SET
      paid_amount=v_row.paid_amount+v_apply,
      debt_amount=v_row.debt_amount-v_apply,
      status=CASE WHEN v_row.debt_amount=v_apply THEN 'completed' ELSE 'pending' END
    WHERE id=v_row.id AND paid_amount=v_row.paid_amount AND debt_amount=v_row.debt_amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'Concurrent invoice update detected'; END IF;

    INSERT INTO public.payment_allocations(
      payment_id,order_id,amount,paid_before,debt_before,paid_after,debt_after
    ) VALUES (
      p_payment_id,v_row.id,v_apply,v_row.paid_amount,v_row.debt_amount,
      v_row.paid_amount+v_apply,v_row.debt_amount-v_apply
    );
    v_count:=v_count+1;
    v_remaining:=v_remaining-v_apply;
    EXIT WHEN v_remaining=0;
  END LOOP;

  IF v_remaining<>0 THEN
    RAISE EXCEPTION 'Could not allocate entire receipt; transaction rolled back';
  END IF;
  RETURN jsonb_build_object(
    'payment_id',p_payment_id,'state','committed','duplicate',false,
    'applied',p_amount,'affected_orders',v_count,'accounting_customer_id',v_customer_uuid
  );
END;
$$;

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
  SELECT * INTO v_receipt FROM public.payment_history WHERE id=p_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  IF v_receipt.accounting_customer_id IS NULL THEN
    RAISE EXCEPTION 'Receipt identity is unresolved; manual reconciliation required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_receipt.accounting_customer_id::text,0));

  SELECT * INTO v_reversal FROM public.payment_reversals WHERE payment_id=p_payment_id;
  IF FOUND THEN
    IF v_reversal.reversal_id<>p_reversal_id THEN
      RAISE EXCEPTION 'Receipt already reversed under another operation';
    END IF;
    RETURN jsonb_build_object('payment_id',p_payment_id,'state','reversed','duplicate',true);
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_total
  FROM public.payment_allocations WHERE payment_id=p_payment_id;
  IF v_total<>v_receipt.amount THEN
    RAISE EXCEPTION 'Legacy/unjournaled receipt cannot be automatically reversed';
  END IF;

  PERFORM set_config('app.accounting_atomic_write','on',true);
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
    WHERE id=v_row.order_id AND paid_amount=v_row.paid_amount AND debt_amount=v_row.debt_amount;
    IF NOT FOUND THEN RAISE EXCEPTION 'Concurrent order edit detected'; END IF;
  END LOOP;

  INSERT INTO public.payment_reversals(payment_id,reversal_id) VALUES(p_payment_id,p_reversal_id);
  RETURN jsonb_build_object('payment_id',p_payment_id,'state','reversed','duplicate',false);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_order_atomic(
  p_order_id text,
  p_order_code text,
  p_customer_name text,
  p_customer_type text,
  p_legacy_customer_id text,
  p_product_name text,
  p_color text,
  p_quantity numeric,
  p_unit_price numeric,
  p_total_price numeric,
  p_paid_amount numeric,
  p_debt_amount numeric,
  p_status text,
  p_order_images text,
  p_created_at timestamptz,
  p_initial_payment_id uuid,
  p_initial_payment_method text,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_uuid uuid;
  v_existing public.orders%ROWTYPE;
  v_payment public.payment_history%ROWTYPE;
  v_item jsonb;
  v_saved_item public.order_items%ROWTYPE;
  v_count integer;
  v_items_total numeric;
  v_surcharge numeric;
BEGIN
  IF auth.uid() IS DISTINCT FROM '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid THEN
    RAISE EXCEPTION 'Owner authorization required' USING ERRCODE='42501';
  END IF;
  IF p_order_id IS NULL OR length(btrim(p_order_id))=0
    OR p_order_code IS NULL OR length(btrim(p_order_code))=0
    OR p_customer_name IS NULL OR length(btrim(p_customer_name)) NOT BETWEEN 1 AND 200
    OR p_customer_type NOT IN ('dtf','tshirt')
    OR p_legacy_customer_id IS NULL OR length(btrim(p_legacy_customer_id))=0
    OR p_quantity IS NULL OR p_quantity<=0
    OR p_unit_price IS NULL OR p_unit_price<0
    OR p_total_price IS NULL OR p_total_price<0 OR p_total_price<>trunc(p_total_price)
    OR p_paid_amount IS NULL OR p_paid_amount<0 OR p_paid_amount<>trunc(p_paid_amount)
    OR p_debt_amount IS NULL OR p_debt_amount<0 OR p_debt_amount<>trunc(p_debt_amount)
    OR p_paid_amount > p_total_price OR p_debt_amount > p_total_price
    OR p_total_price<>p_paid_amount+p_debt_amount
    OR p_total_price>9007199254740991 OR p_paid_amount>9007199254740991
    OR p_debt_amount>9007199254740991
    OR p_status NOT IN ('pending','completed')
    OR (p_debt_amount=0 AND p_status<>'completed')
    OR (p_debt_amount>0 AND p_status<>'pending')
    OR p_created_at IS NULL
    OR p_initial_payment_method IS NULL OR length(btrim(p_initial_payment_method)) NOT BETWEEN 1 AND 500
    OR p_items IS NULL OR jsonb_typeof(p_items)<>'array'
    OR (p_paid_amount>0 AND p_initial_payment_id IS NULL)
    OR (p_paid_amount=0 AND p_initial_payment_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'Invalid invoice/accounting fields' USING ERRCODE='22023';
  END IF;

  v_items_total := 0;
  v_surcharge := 0;
  v_count := jsonb_array_length(p_items);
  IF v_count > 0 THEN
    SELECT coalesce(sum((item->>'total_price')::numeric),0)
      INTO v_items_total
      FROM jsonb_array_elements(p_items) AS t(item);
    IF p_order_images IS NOT NULL AND btrim(p_order_images) <> '' THEN
      v_surcharge := coalesce(nullif((p_order_images::jsonb->>'surcharge'), '')::numeric, 0);
    END IF;
    IF v_surcharge < 0 OR v_items_total + v_surcharge <> p_total_price THEN
      RAISE EXCEPTION 'Invoice total must equal line items plus surcharge exactly';
    END IF;
  END IF;

  v_customer_uuid:=public.resolve_accounting_customer_identity(p_customer_name,p_customer_type);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_customer_uuid::text,0));
  PERFORM set_config('app.accounting_atomic_write','on',true);

  SELECT * INTO v_existing FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF FOUND THEN
    IF v_existing.order_code IS DISTINCT FROM p_order_code
      OR v_existing.customer_name IS DISTINCT FROM p_customer_name
      OR v_existing.type IS DISTINCT FROM p_customer_type
      OR v_existing.accounting_customer_id IS DISTINCT FROM v_customer_uuid
      OR v_existing.product_name IS DISTINCT FROM p_product_name
      OR v_existing.color IS DISTINCT FROM p_color
      OR v_existing.quantity IS DISTINCT FROM p_quantity
      OR v_existing.unit_price IS DISTINCT FROM p_unit_price
      OR v_existing.total_price IS DISTINCT FROM p_total_price
      OR v_existing.order_images IS DISTINCT FROM p_order_images
      OR v_existing.created_at IS DISTINCT FROM p_created_at
    THEN
      RAISE EXCEPTION 'Order ID reused for a different invoice; manual reconciliation required' USING ERRCODE='23505';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.accounting_order_opening_balances b
      WHERE b.order_id=p_order_id AND b.opening_total_price=p_total_price
        AND b.opening_paid_amount=0 AND b.opening_debt_amount=p_total_price
        AND b.baseline_kind='created_order'
    ) THEN
      RAISE EXCEPTION 'Existing order is not an idempotent atomic creation; manual reconciliation required';
    END IF;
    IF p_paid_amount>0 THEN
      SELECT * INTO v_payment FROM public.payment_history WHERE id=p_initial_payment_id;
      IF NOT FOUND OR v_payment.accounting_customer_id IS DISTINCT FROM v_customer_uuid
        OR v_payment.customer_name IS DISTINCT FROM p_customer_name
        OR v_payment.type IS DISTINCT FROM p_customer_type
        OR v_payment.customer_id IS DISTINCT FROM p_legacy_customer_id
        OR v_payment.amount IS DISTINCT FROM p_paid_amount
        OR v_payment.payment_method IS DISTINCT FROM p_initial_payment_method
        OR v_payment.accounting_origin IS DISTINCT FROM 'initial_order_payment'
        OR (SELECT coalesce(sum(amount),0) FROM public.payment_allocations WHERE payment_id=p_initial_payment_id)<>p_paid_amount
        OR NOT EXISTS (
          SELECT 1 FROM public.payment_allocations a
          WHERE a.payment_id=p_initial_payment_id AND a.order_id=p_order_id
            AND a.amount=p_paid_amount AND a.paid_before=0
            AND a.debt_before=p_total_price AND a.paid_after=p_paid_amount
            AND a.debt_after=p_debt_amount
        )
      THEN
        RAISE EXCEPTION 'Initial receipt/allocations do not match the original invoice';
      END IF;
    ELSIF p_initial_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Unexpected initial payment ID for zero-paid invoice';
    END IF;

    SELECT count(*) INTO v_count FROM public.order_items WHERE order_id=p_order_id;
    IF v_count<>jsonb_array_length(p_items) THEN
      RAISE EXCEPTION 'Existing invoice line items differ from the original request';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value) LOOP
      SELECT * INTO v_saved_item FROM public.order_items
      WHERE id=v_item->>'id' AND order_id=p_order_id;
      IF NOT FOUND OR v_saved_item.type IS DISTINCT FROM v_item->>'type'
        OR v_saved_item.product_name IS DISTINCT FROM v_item->>'product_name'
        OR v_saved_item.color IS DISTINCT FROM v_item->>'color'
        OR v_saved_item.size IS DISTINCT FROM nullif(v_item->>'size','')
        OR v_saved_item.quantity IS DISTINCT FROM nullif(v_item->>'quantity','')::numeric
        OR v_saved_item.unit_price IS DISTINCT FROM nullif(v_item->>'unit_price','')::numeric
        OR v_saved_item.total_price IS DISTINCT FROM nullif(v_item->>'total_price','')::numeric
        OR v_saved_item.image IS DISTINCT FROM nullif(v_item->>'image','')
      THEN
        RAISE EXCEPTION 'Existing invoice line item differs from the original request';
      END IF;
    END LOOP;
    RETURN jsonb_build_object(
      'order_id',p_order_id,'state','committed','duplicate',true,
      'initial_payment_id',p_initial_payment_id,'initial_paid_amount',p_paid_amount
    );
  END IF;

  IF p_paid_amount>0 AND EXISTS (
    SELECT 1 FROM public.payment_history WHERE id=p_initial_payment_id
  ) THEN
    RAISE EXCEPTION 'Initial payment ID already belongs to another receipt' USING ERRCODE='23505';
  END IF;

  INSERT INTO public.orders(
    id,order_code,customer_name,type,product_name,color,quantity,unit_price,
    total_price,paid_amount,debt_amount,status,order_images,created_at,accounting_customer_id
  ) VALUES (
    p_order_id,p_order_code,btrim(p_customer_name),p_customer_type,p_product_name,
    p_color,p_quantity,p_unit_price,p_total_price,p_paid_amount,p_debt_amount,
    p_status,p_order_images,p_created_at,v_customer_uuid
  );

  INSERT INTO public.accounting_order_opening_balances(
    order_id,opening_total_price,opening_paid_amount,opening_debt_amount,baseline_kind
  ) VALUES (p_order_id,p_total_price,0,p_total_price,'created_order');

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) AS t(value) LOOP
    IF nullif(v_item->>'id','') IS NULL
      OR v_item->>'type' NOT IN ('dtf','tshirt')
      OR nullif(v_item->>'product_name','') IS NULL
      OR nullif(v_item->>'quantity','') IS NULL
      OR (v_item->>'quantity')::numeric<=0
      OR nullif(v_item->>'unit_price','') IS NULL
      OR (v_item->>'unit_price')::numeric<0
      OR nullif(v_item->>'total_price','') IS NULL
      OR (v_item->>'total_price')::numeric<0
      OR (v_item->>'total_price')::numeric<>trunc((v_item->>'total_price')::numeric)
    THEN
      RAISE EXCEPTION 'Invalid invoice line item';
    END IF;
    INSERT INTO public.order_items(
      id,order_id,type,product_name,color,size,quantity,unit_price,total_price,image
    ) VALUES (
      v_item->>'id',p_order_id,v_item->>'type',v_item->>'product_name',
      coalesce(v_item->>'color','Mặc định'),nullif(v_item->>'size',''),
      (v_item->>'quantity')::numeric,(v_item->>'unit_price')::numeric,
      (v_item->>'total_price')::numeric,nullif(v_item->>'image','')
    );
  END LOOP;

  IF p_paid_amount>0 THEN
    INSERT INTO public.payment_history(
      id,customer_id,customer_name,type,amount,payment_method,created_at,
      accounting_customer_id,accounting_origin
    ) VALUES (
      p_initial_payment_id,p_legacy_customer_id,btrim(p_customer_name),p_customer_type,
      p_paid_amount,p_initial_payment_method,p_created_at,v_customer_uuid,'initial_order_payment'
    );
    INSERT INTO public.payment_allocations(
      payment_id,order_id,amount,paid_before,debt_before,paid_after,debt_after
    ) VALUES (
      p_initial_payment_id,p_order_id,p_paid_amount,0,p_total_price,p_paid_amount,p_debt_amount
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id',p_order_id,'state','committed','duplicate',false,
    'initial_payment_id',p_initial_payment_id,'initial_paid_amount',p_paid_amount,
    'accounting_customer_id',v_customer_uuid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_customer_payment_atomic(uuid,text,text,text,numeric,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_payment_atomic(uuid,text,text,text,numeric,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_customer_payment_atomic(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_customer_payment_atomic(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_order_atomic(text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,timestamptz,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_order_atomic(text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,numeric,text,text,timestamptz,uuid,text,jsonb) TO authenticated;

COMMIT;

-- Do not enable VITE_ATOMIC_ACCOUNTING_ENABLED until this migration has been
-- applied to staging and all SQL + browser/device tests pass.
-- Existing payment_history rows stay marked "legacy" and receive NO guessed allocations.
-- Reconcile those rows manually. The opening balance snapshot is not a claim that
-- historical values are correct; it prevents future writes from silently changing them.
