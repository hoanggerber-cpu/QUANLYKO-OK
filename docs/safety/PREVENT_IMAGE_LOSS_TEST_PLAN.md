# Prevent temporary image URLs — verification (24 October 2026)

This branch does **not** repair the 43 historical orders with blob: image links. It prevents any new order or explicit image update from persisting an ephemeral browser URL.

## Changes
- `StorageManager.addOrder`: rejects `blob:`, `data:`, `backup-asset:` and any non-HTTPS references in `orderImages`, item `image`, and item `extraImages` **before writing locally or remotely**.
- `StorageManager.updateOrder`: rejects those references in image fields explicitly provided for the update. Existing historical broken links remain untouched when editing unrelated fields.
- UI: shows an actionable error when an edit is rejected.

## Pre-merge safety checks (required)
1. Run `npm run lint` and `npm run build` on this branch.
2. On a *staging Supabase project only*, upload a real image and create a PET order; reload in a second browser/device and verify URL and image. Confirm saved URL uses HTTPS and that its file exists in Storage.
3. Simulate Storage upload timeout/failure for create, edit, and extra attachment. Verify no new order or image change is persisted with `blob:`, `data:`, or `backup-asset:`; UI shows error and original browser-selected image remains available.
4. Edit only notes/status on a historical order with a broken image reference; verify existing historical link remains unchanged.
5. Exercise temporary bills, pasted images, edits for DTF and T-shirt, and offline mode. Confirm any unexpected rejection is surfaced before introducing any alternative offline/queued upload behavior.
6. Audit staging RLS and user permissions, and verify no unrelated customer balances, order totals, or payment histories change.

## Limitations
- A valid HTTPS URL can still become inaccessible later; for strong guarantees, introduce Storage object existence verification and verified upload receipts before committing.
- Current legacy `addOrder` still uses best-effort background sync. A separate PR should make image + order sync durable with retries, idempotent writes, and clear remote-acknowledgment status.
- No production deployment, database SQL, merge, or Supabase write performed by this branch.
