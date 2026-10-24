-- Additive rollout: stores only SHA-256 token hashes, never raw links or PINs.
-- This table contains NO existing orders, payments, customers, or admin passwords.
CREATE TABLE IF NOT EXISTS public.customer_tracking_links (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  customer_name text NOT NULL CHECK (length(trim(customer_name)) BETWEEN 1 AND 200),
  customer_type text NOT NULL CHECK (customer_type IN ('dtf','tshirt')),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS customer_tracking_links_customer_lookup_idx
 ON public.customer_tracking_links (customer_name,customer_type)
 WHERE revoked_at IS NULL;
ALTER TABLE public.customer_tracking_links ENABLE ROW LEVEL SECURITY;
-- There must be NO permissive policies. service_role bypasses RLS from a verified Edge Function.
REVOKE ALL ON public.customer_tracking_links FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.customer_tracking_links IS
 'Customer-specific unguessable link token hashes, backend service-role only. Do not grant browser API access.';
