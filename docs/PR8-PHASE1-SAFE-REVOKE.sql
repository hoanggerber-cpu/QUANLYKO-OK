-- Safe first-stage hardening. Does NOT revoke anonymous finance CRUD yet:
-- production still uses legacy login/session and public tracking URLs.
-- Legacy client authenticates by reading admin_users; that read remains until cutover.
-- Remove dangerous, unnecessary DDL privileges from browser API roles.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.orders, public.order_items, public."order-item",
  public.customers, public.payment_history, public.products
FROM anon, authenticated;
-- No admin screen writes into admin_users. Prevent untrusted callers from
-- altering credential entries while keeping legacy SELECT operational.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.admin_users FROM anon, authenticated;
-- No financial records, customer names, PINs, or passwords are changed.
