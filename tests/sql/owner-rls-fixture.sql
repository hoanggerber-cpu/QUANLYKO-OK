\set ON_ERROR_STOP on
-- Disposable PostgreSQL fixture ONLY. Simulates live permissive grants and
-- supplies the additional tables required by PR8 OWNER-RLS draft.
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text NOT NULL);
INSERT INTO auth.users VALUES
('3ea90802-af4a-4163-b403-da7ee313eb6d', 'hoangkenlee@gmail.com');

CREATE TABLE public.admin_users (id text PRIMARY KEY);
CREATE TABLE public.customers (id text PRIMARY KEY);
CREATE TABLE public.products (id text PRIMARY KEY);
CREATE TABLE public."order-item" (id text PRIMARY KEY);

-- Deliberately over-permissive starting state, as seen on live database:
GRANT ALL ON public.orders, public.order_items, public.payment_history,
  public.admin_users, public.customers, public.products, public."order-item"
  TO anon, authenticated;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."order-item" ENABLE ROW LEVEL SECURITY;
CREATE POLICY permissive_customer ON public.customers FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
CREATE POLICY permissive_products ON public.products FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
CREATE POLICY permissive_legacy_items ON public."order-item" FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);
