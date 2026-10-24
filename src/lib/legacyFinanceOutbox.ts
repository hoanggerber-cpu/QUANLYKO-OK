import type { SupabaseClient } from '@supabase/supabase-js';

export interface PendingLegacyReceipt {
  id: string;
  customerName: string;
  customerType: 'dtf' | 'tshirt';
  customerId: string;
  amount: number;
  method: string;
  targetOrderId: string | null;
  createdAt: string;
}

export const LEGACY_RECEIPT_KEY = 'petshirt_admin_pending_legacy_receipt_v1';

export function getPendingLegacyReceipt(): PendingLegacyReceipt | null {
  const raw = localStorage.getItem(LEGACY_RECEIPT_KEY);
  if (!raw) return null;
  let result: PendingLegacyReceipt;
  try { result = JSON.parse(raw) as PendingLegacyReceipt; }
  catch { throw new Error('Khoản thu chờ đồng bộ bị lỗi; cần đối soát trước khi thu tiếp.'); }
  if (!result || typeof result.id !== 'string' || typeof result.customerName !== 'string'
      || !['dtf','tshirt'].includes(result.customerType)
      || !Number.isSafeInteger(result.amount) || result.amount <= 0
      || typeof result.customerId !== 'string' || typeof result.method !== 'string') {
    throw new Error('Khoản thu chờ đồng bộ không hợp lệ; không được ghi đè.');
  }
  return result;
}

export function queueLegacyReceipt(input: Omit<PendingLegacyReceipt,'id'|'createdAt'>): PendingLegacyReceipt {
  if (getPendingLegacyReceipt()) {
    throw new Error('Đang có khoản thu chưa xác nhận. Hãy đồng bộ hoặc đối soát trước khi nhập khoản mới.');
  }
  if (!globalThis.crypto?.randomUUID) throw new Error('Không thể tạo mã biên nhận an toàn.');
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Số tiền VND không hợp lệ.');
  const receipt: PendingLegacyReceipt = {
    ...input,id:globalThis.crypto.randomUUID(),createdAt:new Date().toISOString(),
  };
  const serialized = JSON.stringify(receipt);
  localStorage.setItem(LEGACY_RECEIPT_KEY,serialized);
  if (localStorage.getItem(LEGACY_RECEIPT_KEY)!==serialized) {
    throw new Error('Không thể xác nhận đã lưu khoản thu chờ trên thiết bị.');
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('legacy_finance_status'));
  return receipt;
}

export async function syncLegacyReceipt(client: SupabaseClient): Promise<boolean> {
  const receipt = getPendingLegacyReceipt();
  if (!receipt) return false;
  const {data,error} = await client.rpc('record_legacy_payment_atomic',{
    p_payment_id:receipt.id,
    p_customer_name:receipt.customerName,
    p_customer_type:receipt.customerType,
    p_customer_id:receipt.customerId,
    p_amount:receipt.amount,
    p_method:receipt.method,
    p_target_order_id:receipt.targetOrderId,
  });
  if (error) throw new Error('Chưa xác nhận khoản thu trên Supabase: '+error.message);
  if (data?.payment_id!==receipt.id || data?.state!=='committed') {
    throw new Error('Máy chủ chưa xác nhận đúng mã khoản thu. Không tạo khoản thu mới.');
  }
  // Only clear the pending record after the database has confirmed this exact ID.
  const stillPending = getPendingLegacyReceipt();
  if (stillPending?.id!==receipt.id) {
    throw new Error('Mã khoản thu trên máy đã thay đổi; phải đối soát.');
  }
  localStorage.removeItem(LEGACY_RECEIPT_KEY);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('legacy_finance_status'));
  return true;
}
