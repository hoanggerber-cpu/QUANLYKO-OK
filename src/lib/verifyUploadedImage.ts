export interface ImageObjectInfo {
  size?: number | null;
}
export type UploadReply = { error?: {message: string} | null; data?: unknown };
export type InfoReply = { error?: {message: string} | null; data?: ImageObjectInfo | null };

/**
 * Fail closed when upload claims success without the cloud confirming
 * that the uploaded object exists and contains the full file bytes.
 * This is a Storage metadata confirmation; cross-device image rendering
 * must still be verified in staging.
 */
export async function verifyUploadedImage(
  fileBytes: number,
  send: () => Promise<UploadReply>,
  inspect: () => Promise<InfoReply>,
  publicUrl: () => string | null | undefined,
): Promise<string> {
  if (!Number.isSafeInteger(fileBytes) || fileBytes <= 0) {
    throw new Error('Tệp ảnh rỗng hoặc không hợp lệ. Không lưu đơn.');
  }
  const uploaded = await send();
  if (uploaded.error) throw new Error('Không tải được ảnh lên Supabase: '+uploaded.error.message);
  if (!uploaded.data) throw new Error('Supabase chưa xác nhận nhận ảnh.');
  const status = await inspect();
  if (status.error) throw new Error('Chưa xác nhận ảnh trong Storage: '+status.error.message);
  if (!status.data || Number(status.data.size) !== fileBytes) {
    throw new Error('Ảnh trong Storage thiếu hoặc sai dung lượng. Chưa lưu đơn.');
  }
  const url = publicUrl();
  if (!url || !/^https:\/\/[^\s]+$/i.test(url)) {
    throw new Error('Không có đường dẫn HTTPS hợp lệ tới ảnh.');
  }
  return url;
}
