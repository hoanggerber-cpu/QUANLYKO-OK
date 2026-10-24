\set ON_ERROR_STOP on

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;

CREATE TABLE public.orders (
  id text PRIMARY KEY,
  customer_name text NOT NULL,
  type text NOT NULL,
  total_price numeric NOT NULL,
  paid_amount numeric NOT NULL,
  debt_amount numeric NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT money_balanced CHECK (total_price=paid_amount+debt_amount),
  CONSTRAINT money_nonnegative CHECK (total_price>=0 AND paid_amount>=0 AND debt_amount>=0)
);
CREATE TABLE public.payment_history (
  id uuid PRIMARY KEY,
  customer_id text NOT NULL,
  customer_name text NOT NULL,
  type text NOT NULL,
  amount numeric NOT NULL,
  payment_method text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,UPDATE ON public.orders TO authenticated;
GRANT SELECT,INSERT ON public.payment_history TO authenticated;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_owner_orders ON public.orders FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
CREATE POLICY test_owner_receipts ON public.payment_history FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);

INSERT INTO public.orders
  (id,customer_name,type,total_price,paid_amount,debt_amount,status,created_at)
VALUES
  ('a-old','Khach A','dtf',5000000,1000000,4000000,'pending','2026-01-01'),
  ('a-next','Khach A','dtf',3000000,0,3000000,'pending','2026-02-01'),
  ('b-own','Khach B','dtf',8000000,0,8000000,'pending','2026-01-01');
