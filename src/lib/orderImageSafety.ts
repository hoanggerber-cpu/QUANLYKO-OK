/**
 * Order designs must have durable remote URLs before order data is persisted.
 * Do not auto-replace temporary URLs: that would silently lose customer artwork.
 */
export function assertPersistentOrderImages(images: ReadonlyArray<string | null | undefined>): void {
  for (const url of images) {
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
      throw new Error('Ảnh đơn hàng chưa được tải lên Supabase thành công. Không lưu đơn để tránh mất ảnh. Vui lòng giữ file gốc và thử lại.');
    }
  }
}

/** Return an uploaded URL only after the storage layer has confirmed success. */
export async function confirmedImageUpload(upload: () => Promise<string | null | undefined>): Promise<string> {
  const url = await upload();
  if (!url) {
    throw new Error('Tải ảnh lên Supabase không trả về đường dẫn. Đơn chưa được lưu.');
  }
  assertPersistentOrderImages([url]);
  return url;
}
