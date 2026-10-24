-- DRAFT ONLY: NEVER RUN ON PRODUCTION UNTIL PR #8 PASSES STAGING QA.
-- Owner UID verified from Supabase Auth record on 2026-10-24:
-- 3ea90802-af4a-4163-b403-da7ee313eb6d
-- Existing policies are permissive and OR'ed: every old wide-open policy
-- MUST be removed in the same controlled migration as owner policies.
-- A signed-in authenticated role alone is NOT authorization.
BEGIN;

DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM auth.users
   WHERE id = '3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid
     AND lower(email) = 'hoangkenlee@gmail.com'
 ) THEN RAISE EXCEPTION 'Owner Auth UID mismatch. Stop.'; END IF;
END $$;

-- Keep front-end privileges only where RLS restricts them; hide credential table.
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_users FROM anon, authenticated;
REVOKE ALL ON public.admin_users FROM PUBLIC;

-- All seven financial/business tables require an owner session.
DO $$
DECLARE t text;
DECLARE p record;
BEGIN
 FOREACH t IN ARRAY ARRAY['orders','order_items','order-item','customers','payment_history','products'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
     EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',p.policyname,t);
   END LOOP;
   EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING ((select auth.uid()) = %L::uuid) WITH CHECK ((select auth.uid()) = %L::uuid)',
      'owner_only_'||replace(t,'-','_'),t,
      '3ea90802-af4a-4163-b403-da7ee313eb6d',
      '3ea90802-af4a-4163-b403-da7ee313eb6d');
 END LOOP;
END $$;

-- No finance CRUD for anonymous API callers.
REVOKE ALL ON public.orders,public.order_items,public."order-item",
  public.customers,public.payment_history,public.products FROM anon;
-- Authenticated role continues operations, but policy restricts to owner.
GRANT SELECT,INSERT,UPDATE,DELETE ON public.orders,public.order_items,
  public."order-item",public.customers,public.payment_history,public.products TO authenticated;

COMMIT;

-- ROLLBACK STRATEGY: Do NOT simply reopen anon access.
-- Restore from a saved pg_policies/GRANT snapshot after verification, or
-- revert to a tested read-only maintenance mode during incident handling.
-- Validate admin login, data sync, all order/payment writes, public tracking
-- and RLS negative tests before production rollout.
