# PR #8: security rollout and acceptance gates (2026-10-24)

## Scope and current live state

- User-facing requirement: customers click **one link**, with NO PIN, login or form.
- Owner UI username remains `hoanguyen`; owner Supabase Auth account `hoangkenlee@gmail.com`.
- Production Vercel code is NOT updated by this draft PR.
- Live Supabase project received two **additive / non-breaking** database security migrations:
  - `add_service_only_customer_tracking_token_table`: new empty `public.customer_tracking_links`; RLS enabled, no anon or authenticated table access; only 256-bit token hashes will be stored.
  - `remove_unneeded_browser_ddl_and_admin_write_grants`: removes unnecessary TRUNCATE/REFERENCES/TRIGGER privileges from business tables, and unauthenticated/admin browser writes to `admin_users`. Legacy SELECT remains so the live login does not break.
- The new independent `customer-tracking` Edge Function is ACTIVE, version 2, configured `verify_jwt=false` only because public **read** uses an unguessable token; privileged **issue** explicitly verifies the owner's JWT and UID.
- **IMPORTANT:** Production finance tables still have overly permissive policies and public read/write access; owner-only RLS is NOT active. The live site is NOT secured end to end.
- Recorded pre/post-additive-migration data: 1,113 orders; invoice 1,193,912,387 VND; paid 714,247,004 VND; debt 479,665,383 VND; 71 payment_history rows. No financial records updated.

## Secure tracking architecture

1. Owner opens a customer card and clicks **Copy Link Gửi Khách**.
2. Edge Function action `issue` verifies the owner account server-side, ensures the customer has orders, generates 32 cryptographically random bytes and stores only SHA-256 in `customer_tracking_links`.
3. Owner sends `/c/<43-char-opaque-token>` by Zalo. Anyone holding this link can see this customer's ledger; do not post it publicly.
4. Customer opens the link: no PIN or login. Edge Function action `read` validates the hash, then fetches only matching `customer_name` + `type` orders and their items.
5. Customer cannot get other customers' data merely by guessing customer names or editing the URL.
6. `Referrer-Policy: no-referrer` on Vercel and HTML helps prevent the secret link from leaking when loading external images/links.
7. The owner can press **Thu hồi link cũ** to revoke all previously issued links for a customer, then **Copy Link Gửi Khách** to create a fresh URL. Generating a link does not automatically invalidate other active links.

## Explicit limitations and must-test items

- **Old links are NOT secure** (they contain guessable names or deterministic IDs). Requiring no PIN means old link formats cannot remain valid indefinitely while guaranteeing customer privacy. Each customer will need a **new link** after controlled cutover.
- The current draft `PublicTracking` deliberately rejects old slugs. DO NOT merge into production without a communication/cutover plan: prior Zalo links will stop displaying balances.
- Supabase `customers` has only 3 rows but orders represent ~58 name/type groups. The new flow correctly resolves identities from `orders`, not from missing `customers` records.
- Need independent tests for at least two distinct customers. Assert amount totals, all historic orders, status, images and order items exactly equal source DB.
- Need ensure customer rename doesn't silently orphan existing links (name/type currently define link association).
- Bearer links grant read access to anyone who has the URL. For extra protection later: link revocation/rotation, optional expiry and leak monitoring without adding friction.
- The active Edge Function has **not** been end-to-end exercised through an authenticated owner session. Vercel build success is NOT a behavioral or security test.
- Verify JWT issuance only for the owner and deny fake/anonymous owner issuance; verify malformed, revoked and other-customer tokens cannot fetch records.
- Verify Vercel preview origin CORS handling. Currently default origins are `http://localhost:3000` and the official domain; previews require an explicitly configured trusted origin.
- Validate report against source accounting data without writing/modifying production finance records.
- Owner login/password recovery must succeed before owner-only RLS can be applied; Supabase email rate limit is a temporary blocker.

## Cutover gate (DO NOT skip)

- [ ] Owner signs in using `hoanguyen` and the new Supabase Auth password.
- [ ] Owner issues an opaque customer link in localhost or configured preview; anonymous browsing loads only that ledger.
- [ ] Test owner link revocation; old URL stops working while a newly issued link works.
- [ ] Reconcile two customer examples including longest history and totals; verify the data from independently checked DB rows.
- [ ] Prove direct anonymous SELECT/INSERT/UPDATE/DELETE blocked against a **staging database** after owner-only RLS changes; prove owner permissions work.
- [ ] Test create order, amend, delete, payment, payment reversal, image load, Supabase realtime and multi-device sync on isolated fixtures.
- [ ] Inventory old shared URLs and communicate that customers must receive a replacement link; coordinate activation to avoid accidental outages.
- [ ] Snapshot policies/grants and export restorable finance backup; dry-run reversible RLS deployment and rollback.
- [ ] Only then apply `docs/PR8-OWNER-RLS-DRAFT.sql` after review for full table list, grants and future migrations; merge/deploy code in a controlled, monitored window.
- [ ] Re-run SQL verification, auth checks and business smoke tests after the cutover.

**BLOCKER:** DO NOT MERGE PR #8 OR APPLY FULL OWNER-ONLY FINANCE RLS YET.
