# QUANLYKO stabilization gate — 24 October 2026

**Current status: integrated draft PR #11; NOT approved for production.** This PR combines #8, #9, and #10 without changing the live database.

## Verified by two independent CI jobs
- PR8 Accounting Safety on integration branch: TypeScript, Vite, simulated accounting, atomic SQL on disposable PostgreSQL, concurrent receipts, product image merge regression.
- PR10 Image Safety on integration branch: TypeScript, Vite, mocked successful/failed image upload, rejection of blob:/data:/backup-asset: images.

## Unresolved blocking requirements

### Critical: live RLS security
Read-only policy inspection confirms public/anonymous unrestricted `ALL USING true WITH CHECK true` policies on orders, order_items, customers, products, and unprotected payment_history select/insert/delete; admin_users RLS disabled. RLS being enabled for business tables is NOT sufficient while permissive policies remain. Do not apply owner-only RLS before owner login, customer token-link cutover, full end-to-end staging checks, and rollback review. The PR8 owner RLS migration is a proposal, not production-ready by itself.

### Critical: live payment discrepancy
1113 orders; total VND 1,193,912,387; paid VND 714,247,004; debt VND 479,665,383; payment_history sum VND 715,606,107; difference VND 1,359,103. Zero arithmetic-invalid orders. The difference remains unresolved and requires documentary reconciliation; never adjust historic paid/debt or fabricate receipts automatically.

### High: order sync / payment correctness
PR8 introduces a durable pending order outbox and atomic accounting code, but real owner/staging test is required with offline, timeout, duplicate retry, readback and simultaneous devices. Test non-atomic and atomic modes separately. Do NOT enable the atomic feature flag on production before schema migration and QA. Confirm existence of remote `order_images` references, `order_items.image`, and actual Storage objects after browser reload and secondary-device login.

### High: new image persistence
PR10 validation rejects browser-local image links for new order/explicit edits. Tests are mocks only. Need real upload with file, failed upload, zero-byte upload, refresh, phone/other-browser display, and delayed network timeouts. Existing 43 blob: order images are explicitly out of scope as owner accepted leaving them unchanged.

### Medium: product image preservation
PR9 keeps a local-only recovery snapshot; 82 cloud products had empty image field. Must inspect local snapshot and never map unrelated Storage images to products by date or filename. Only verified original product ID source may be used for recovery.

### Medium: backup and deployment
Owner has local SQL dumps and 1,370 nonempty downloaded image files; one Supabase object is zero byte. A complete restore test has not been performed. Do restore to disposable staging, compare counts, hashes and policies, ensure confidential customer content stays private; perform explicit rollback rehearsal.

## Acceptance gates
- [x] Integration PR created with all three sets of code on one branch.
- [x] Combined CI successful on draft branch.
- [ ] Disposable independent Supabase staging with synthetic seed data.
- [ ] Owner login after refresh, password recovery, and session expiration.
- [ ] Anonymous client cannot SELECT/INSERT/UPDATE/DELETE business/finance tables.
- [ ] Owner can operate customers/orders/payments and token tracking safely.
- [ ] Two customer public links: isolated data, old links rotated/revoked, no guessable access.
- [ ] Ledger discrepancy tracked to documentary evidence; no silent data correction.
- [ ] Exactly-once receipts/returns under retry and concurrent use on staging.
- [ ] Create, edit, delete order and stock movements on staging with no accounting drift.
- [ ] Upload PET and T-shirt photos successfully, reload page, second-device verification.
- [ ] Simulate upload failure and localStorage quota exhausted; no false successful save.
- [ ] Show pending sync explicitly, reconcile cloud acknowledgement.
- [ ] Product image local-only recovery based on verified product IDs.
- [ ] Restore full SQL + object backup to disposable project.
- [ ] Customer-link cutover communications and rollback / production release plan.

No merge, production RLS changes, live Supabase writes or deploy in this review stage.
