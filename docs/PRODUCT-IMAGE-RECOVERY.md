# Product image preservation and recovery

## Findings from the read-only investigation (2026-10-24)

- The public products table contains 82 rows; all 82 have an empty image field.
- The order-images Storage bucket contains 1,371 objects, but none use the factory_ prefix used by the product-image upload handler. The objects seen in the bucket are not safely attributable to individual product rows.
- The app merges local and cloud products by updatedAt. When the newer copy has no image, the previous implementation can replace a recoverable local image with an empty cloud value.
- Product-image upload set uploading=false as soon as FileReader finished, before the Storage upload completed. The form could therefore be submitted while the image URL was still a local data URL rather than the uploaded public URL.

No production database rows or Storage objects were modified during this investigation.

## Safe behavior added in this branch

1. Keep the newer record's non-image fields, but preserve a usable image from either copy if the selected record's image is empty or unusable.
2. Keep a durable local recovery snapshot of product images. The snapshot is not overwritten by a sync that has fewer recoverable product images.
3. Add an explicit local-only recovery action. It fills only missing/unusable product image fields from a local snapshot and does not write to Supabase.
4. Block the "clear local product cache" action if any local product is absent from cloud or has a usable local image while the cloud copy has no usable image. Save a recovery snapshot first.
5. Keep the product form disabled until both local file reading and the optional Storage upload have finished.

## Recovery limits

- This cannot recreate an image if no local cache, local backup, or other original copy contains the image bytes.
- Existing Storage objects are not automatically attached to products because the database has no reliable product-to-object mapping. Guessing based on filenames would risk assigning the wrong photo.
- Do not use the full-application restore merely to recover product images: it replaces local orders and payment-history data too. Use the image-only local recovery action first and preserve any other computer that still displays the missing images.
- The patch is staging-only. It does not change production data, enable atomic accounting, or deploy the app.
