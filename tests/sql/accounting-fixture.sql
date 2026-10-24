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
  order_code text NOT NULL,
  customer_name text NOT NULL,
  type text NOT NULL,
  product_name text,
  color text,
  quantity numeric,
  unit_price numeric,
  total_price numeric NOT NULL,
  paid_amount numeric NOT NULL,
  debt_amount numeric NOT NULL,
  status text NOT NULL,
  order_images text,
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
CREATE TABLE public.order_items (
  id text PRIMARY KEY,
  order_id text REFERENCES public.orders(id) ON DELETE RESTRICT,
  type text NOT NULL,
  product_name text NOT NULL,
  color text,
  size text,
  quantity numeric,
  unit_price numeric,
  total_price numeric,
  image text
);
GRANT SELECT,INSERT,UPDATE ON public.orders TO authenticated;
GRANT SELECT,INSERT ON public.payment_history TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.order_items TO authenticated;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY test_owner_orders ON public.orders FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
CREATE POLICY test_owner_receipts ON public.payment_history FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);
CREATE POLICY test_owner_items ON public.order_items FOR ALL TO authenticated
  USING ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid)
  WITH CHECK ((select auth.uid())='3ea90802-af4a-4163-b403-da7ee313eb6d'::uuid);

INSERT INTO public.orders
  (id,order_code,customer_name,type,product_name,color,quantity,unit_price,total_price,paid_amount,debt_amount,status,order_images,created_at)
VALUES
  ('a-old','ORD-DTF-0001','Khach A','dtf','In PET phim','Mặc định',100,50000,5000000,1000000,4000000,'pending','{}','2026-01-01'),
  ('a-next','ORD-DTF-0002','Khach A','dtf','In PET phim','Mặc định',60,50000,3000000,0,3000000,'pending','{}','2026-02-01'),
  ('b-own','ORD-DTF-0003','Khach B','dtf','In PET phim','Mặc định',160,50000,8000000,0,8000000,'pending','{}','2026-01-01');
