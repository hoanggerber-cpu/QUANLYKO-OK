-- STAGED ONLY: run as a single reviewed production cutover AFTER deploying the matching PR.
-- Never run this on the old production UI. No historical data writes.
-- Before cutover: confirm owner login, preview tracking (new + old slug + PIN),
-- order creation/FIFO receipt/overpayment, backup restoration and rollback.
BEGIN;
DO $$
DECLARE owner_id uuid;
BEGIN
  SELECT id INTO owner_id FROM auth.users
  WHERE lower(email) = 'hoangkenlee@gmail.com' AND email_confirmed_at IS NOT NULL;
  IF owner_id IS DISTINCT FROM '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid THEN
    RAISE EXCEPTION 'Owner Auth identity mismatch: abort cutover';
  END IF;
END $$;

DO $$
DECLARE t text; p record; owner uuid := '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','order_items','order-item','customers','payment_history','products'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,t);
    END LOOP;
    EXECUTE format('CREATE POLICY owner_only ON public.%I FOR ALL TO authenticated USING ((select auth.uid()) = %L::uuid) WITH CHECK ((select auth.uid()) = %L::uuid)',t,owner,owner);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
  END LOOP;
END $$;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_users FROM anon, authenticated, PUBLIC;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='admin_users' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.admin_users',p.policyname);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_legacy_order_with_advance(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_legacy_order_with_advance(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_legacy_payment_atomic(uuid,text,text,text,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_legacy_payment_atomic(uuid,text,text,text,numeric,text,text) TO authenticated;
COMMIT;

-- POST CUTOVER: validate all six tables as anon (zero rights) and owner (read/write).
-- Validate owner RPC create/order and FIFO/credit, anonymous token-scoped tracking, old slugs with PIN.
-- No anonymous table access should be restored as rollback; roll back UI with a tested safe service layer.
