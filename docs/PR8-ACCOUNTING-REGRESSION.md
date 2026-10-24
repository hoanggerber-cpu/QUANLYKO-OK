# PR #8 - Daily bookkeeping, cloud sync and cash receipt QA (2026-10-24)

**Do not execute test writes in production. Do not merge PR #8 until the required transactional accounting functionality has been tested.**

## Read-only production baseline

Queried live Supabase, read-only on 2026-10-24:

| Metric | Observed |
| --- | ---: |
| Orders | 1,113 |
| Order total (VND) | 1,193,912,387 |
| Sum of paid_amount (VND) | 714,247,004 |
| Sum of debt_amount (VND) | 479,665,383 |
| Orders where total != paid + debt | 0 |
| Negative/overpaid orders | 0 |
| Completed orders with debt / pending with zero debt | 0 / 0 |
| Payment history rows | 71 |
| Payment history amount total (VND) | 715,606,107 |
| Raw history sum - order paid sum (VND) | 1,359,103 |
| Customer/type groups with history != current paid | 4 |
| Groups where history exceeds order paid | 2 |
| Orphan order_items | 12 |
| Orders lacking order_items | 11 |
| Duplicate order_code groups | 49 |
| Payment history rows with missing customers.id mapping | 70 |

**Important:** History sums are not guaranteed to match order paid sums if early receipts, direct per-order adjustments, unapplied receipts, or historical imports bypassed payment_history. Do not "fix" discrepancies by resetting/reallocating any production payments automatically. Independently reconcile per customer and payment channel.

## Confirmed code hazards

1. `StorageManager.addOrder`: commits localStorage first then launches the cloud insert in a detached `void (async () => ...)()`, with no durable retry journal. The UI can say saved even when Supabase lacks the order. Existing DTF-only manual backfill is explicitly opt-in and does not cover every order type.
2. `recordCustomerPayment`: cloud `payment_history` INSERT happens before per-order FIFO UPDATEs, without a database transaction. Any interrupted step can leave a recorded receipt but not all orders paid. Local writes can also diverge if one step fails. Same receipt may be duplicated when an operator retries after an ambiguous network error.
3. `updateOrderPayment`: adjusts one order without inserting a corresponding `payment_history` entry. The history cannot be taken as a complete accounting journal today.
4. `deletePaymentAndRecalculate`: deletes history first, then ZEROES *all* order paid_amount values for that customer/type and reapplies remaining history. This is dangerous when older payments existed outside history; DB update errors are not checked inside `Promise.all`.
5. `syncAllDataFromSupabase`: union-merges server and local by ID. Remote values take priority for existing records, but local-only records remain after sync and are **not** automatically uploaded. Hence different devices can display different totals; stale locally retained records can reappear after remote deletion.
6. `checkSupabaseConnection` previously treated reading a public table as proof of authorization; PR #8 now verifies the owner and reads the orders table.
7. Receipt UI displayed success before awaiting payment; PR #8 now awaits the result, blocks duplicate clicks, and warns not to retry after uncertain failure.
8. Different customers share **non-unique** random four-digit `orderCode` values (49 duplicate code groups), so financial APIs must key by immutable `orders.id` and `payment_history.id`, never by display order codes.

## Architecture required before finance RLS/production cutover

### Order writes and synchronization
- Assign stable operation/order UUID before sending.
- Never silently claim `Cloud đã lưu` until the server confirms the operation and returned version/id.
- Persist an explicit **pending sync outbox** for network outages; show `Đã lưu trên máy, chưa đồng bộ` separately from `Đã đồng bộ`.
- Retry by the same idempotency key to avoid duplicate orders or payments after timeouts.
- Do not re-upload old local copies over paid server records without comparing versions, checksums and a human reconciliation option.
- Reconcile cloud/local counts, each order ID, paid, debt and parent/item status before considering a device in sync.
- Consider a controlled operation journal with IDs, timestamps, actor, status and immutable audit history.

### Payment receipts: one atomic database transaction
- Server verifies `auth.uid()` is the specific owner (not any signed-in user) and validates amount as positive whole VND <= current customer debt.
- Lock affected order rows, insert the receipt once under a client-generated UUID/idempotency key, and distribute the *same* amount across FIFO orders.
- Commit payment_history + all order paid/debt updates + allocation rows **together**, or rollback **all**.
- Return receipt id, committed balance and affected order allocations; show `Thu tiền thành công` only after confirmed commit.
- Keep an immutable allocation journal per receipt for audit and later reversal. Do not derive all historical paid order balances solely from payment_history.
- For order-level payments, also record their receipt and allocation in the same transactional ledger.

### Undo/reversal
- Reverse ONLY allocations belonging to the selected new receipt; never reset all customer orders and replay partial history.
- Refuse unsafe historical reversals with a clear `Cần đối soát` message when prior allocation information is missing.
- Do not hard-delete receipts; use reversal transactions with references and audit trail.
- Lock customer/order rows and ensure rollback is atomic and idempotent.

### Mandatory staging acceptance matrix
1. New order while connected: local and cloud IDs/totals/items match after refresh and second-device login.
2. Simulated offline new order: shown as `Chưa đồng bộ`, not duplicated by reconnect or app restart.
3. Receipt of 100,000 VND spread over two old invoices: paid increases exactly 100,000, debt decreases exactly 100,000, receipt appears once.
4. Network timeout after server commit: retry same request ID has no additional effect.
5. Simulate failure after payment history insert: **all** writes roll back; no partial settlement.
6. Two browsers simultaneously collecting against the same customer: no overpayment, no lost updates.
7. Pay a single invoice: corresponding receipt is included in history/audit.
8. Reverse a *new* receipt: restore exactly the allocated amount; leave independent previous receipt allocations intact.
9. Legacy history mismatch: unsafe one-click reverse is blocked pending manual reconciliation; no mass reset.
10. Duplicate orderCode: all receipt operations target IDs, never ambiguous display codes.
11. Production snapshot reconciliation: all pre-cutover record counts/totals/status match; 0 unapproved financial mutations.
12. Only after the above: staging RLS prevents anon CRUD and only the owner can post/reverse.

## Release status

- [x] Read-only production consistency audit.
- [x] PR #8 UI now awaits payment callbacks and uses in-flight locks.
- [x] PR #8 verifies owner when marking Supabase as cloud connected.
- [ ] Transactional receipt/order-payment RPC and allocation journal **NOT built or deployed**.
- [ ] Durable offline outbox and replay **NOT built**.
- [ ] Safe history-preserving reversal **NOT built**.
- [ ] Independent staging write tests, negative RLS tests and multi-device E2E **NOT run**.
- [ ] Owner password/Auth login QA **NOT complete**.
- [ ] Production accounting RLS cutover **BLOCKED**.

Production finance data and localStorage remain untouched by this audit.
