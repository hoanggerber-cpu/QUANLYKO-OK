# PR #8 — Owner Auth Regression Checklist

This branch is **not production-ready**. No production RLS changes, merges, migrations or business-record writes are authorized by this checklist.

## Auth callback (staging/preview, never send tokens in chat)
- [ ] Valid new invite/recovery email opens "Thiết lập mật khẩu bảo mật" and retains Supabase session until password is saved
- [ ] Invalid/expired link shows an error and does not enable password fields
- [ ] New password under 12 characters and confirmation mismatch are rejected
- [ ] Successful save signs out and returns to `hoanguyen` login
- [ ] Login works with `hoanguyen` and the new Supabase Auth password
- [ ] Wrong password or unknown username is rejected
- [ ] Page reload restores only a verified owner session
- [ ] Logout clears authenticated session
- [ ] Old legacy `admin_users` and VITE_ADMIN_PASSWORD paths cannot authenticate

## Business regression (isolated test DB and test browser profile only)
- [ ] Insert, update, delete a test order and reconcile order_items
- [ ] Record, undo and allocate a test payment; compare balances and payment_history
- [ ] Test offline/online sync and restored local backup without clearing actual browser storage
- [ ] Test public customer tracking with and without PIN
- [ ] Test anonymous calls: no financial table reads/writes after RLS rollout

## Deployment blockers
1. Password recovery preview must be manually tested with a new non-shared link; Vercel status alone is insufficient.
2. `PublicTracking.tsx` still reads all data as anonymous and checks PIN in browser; replace with server-side scoped tracking before tightening RLS.
3. RLS policies and admin_users table remain insecure until a separate reviewed migration and rollback plan.
4. Real localStorage and production finance data must not be reset or modified for tests.

## 2026-10-24: customer tracking / owner RLS staged

- [x] `PublicTracking.tsx` no longer uses `syncAllDataFromSupabase()`, `getCustomerByTrackingId()`, client-side customer PIN read or client-side PIN comparison.
- [x] Edge Function source `supabase/functions/customer-tracking/index.ts` added as **undepoyed draft**.
- [x] `docs/PR8-OWNER-RLS-DRAFT.sql` staged but **never executed**.
- [ ] CRITICAL: Backend verification must use dedicated non-plaintext PIN storage, compare hashes and enforce durable per-identity/IP rate limits; current draft compares existing plaintext PINs and must not be deployed.
- [ ] CRITICAL: Reconcile legacy tracking links against `public.customers` before switchover; current table has far fewer rows than legacy order customer names. Links without a persisted PIN intentionally fail closed; migrate only with owner review.
- [ ] CRITICAL: Verify customer-specific order list and multi-item details against reference customer and source data, especially aliases, cancellation, and duplicate names.
- [ ] CRITICAL: Confirm image URLs returned by backend are safe to share; private file content should require scoped signed URLs.
- [ ] Test CORS, JWT configuration, secrets, error throttling, anti-enumeration, and response size caps.
- [ ] Check Vercel build/typecheck and run browser E2E for owner login, password recovery and tracking using an isolated staging database.
- [ ] Save current policies/grants for a reversible production migration; DO NOT execute owner RLS migration before tracking endpoint and all CRUD test gates pass.

**Deploy block:** This change deliberately fails closed on unconfigured customer PINs. Neither the tracking function nor RLS migration may be enabled in production yet.
