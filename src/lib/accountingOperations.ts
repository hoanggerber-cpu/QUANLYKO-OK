import type { SupabaseClient } from '@supabase/supabase-js';

// One durable operation per browser profile. Never replace an ambiguous receipt
// with a fresh UUID: a timeout may have happened AFTER the server committed it.
export type FinanceOperation =
  | {
      kind: 'receipt';
      id: string;
      customerName: string;
      customerType: 'dtf' | 'tshirt';
      customerId: string;
      amount: number;
      method: string;
      targetOrderId: string | null;
      createdAt: string;
    }
  | {
      kind: 'reversal';
      id: string;
      paymentId: string;
      createdAt: string;
    };

export const PENDING_FINANCE_KEY = 'petshirt_admin_pending_finance_v1';

export function getPendingFinanceOperation(): FinanceOperation | null {
  const raw = localStorage.getItem(PENDING_FINANCE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as FinanceOperation;
    if (parsed && (parsed.kind === 'receipt' || parsed.kind === 'reversal') &&
        typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed;
    }
  } catch {
    // Invalid persistent state is never silently overwritten.
  }
  throw new Error('Nhật ký giao dịch đang chờ bị lỗi. Dừng thao tác và đối soát trước khi tiếp tục.');
}

function persistNewOperation(operation: FinanceOperation): void {
  if (getPendingFinanceOperation()) {
    throw new Error('Có giao dịch trước chưa được xác nhận. Hãy kiểm tra/tiếp tục giao dịch đó trước khi ghi tiền mới.');
  }
  // If this fails (storage quota/privacy), do not attempt any network write.
  localStorage.setItem(PENDING_FINANCE_KEY, JSON.stringify(operation));
  if (localStorage.getItem(PENDING_FINANCE_KEY) !== JSON.stringify(operation)) {
    throw new Error('Không thể lưu mã định danh giao dịch an toàn trên thiết bị.');
  }
}

function clearConfirmedOperation(id: string): void {
  const prior = getPendingFinanceOperation();
  if (prior && prior.id !== id) {
    throw new Error('Mã giao dịch đang chờ đã thay đổi; cần đối soát thủ công.');
  }
  if (prior) localStorage.removeItem(PENDING_FINANCE_KEY);
}

export function makeFinanceId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Trình duyệt không hỗ trợ mã giao dịch UUID an toàn.');
  }
  return globalThis.crypto.randomUUID();
}

export function validateVnd(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Số tiền phải là số nguyên VND dương và không vượt giới hạn an toàn.');
  }
}

async function transmitFinanceOperation(client: SupabaseClient, operation: FinanceOperation): Promise<void> {
  if (operation.kind === 'receipt') {
    const { data, error } = await client.rpc('record_customer_payment_atomic', {
      p_payment_id: operation.id,
      p_customer_name: operation.customerName,
      p_customer_type: operation.customerType,
      p_customer_id: operation.customerId,
      p_amount: operation.amount,
      p_method: operation.method,
      p_target_order_id: operation.targetOrderId,
    });
    if (error) throw new Error('Chưa xác nhận cloud: ' + error.message);
    if (data?.payment_id !== operation.id || data?.state !== 'committed') {
      throw new Error('Phản hồi thu tiền không khớp hoặc biên nhận đã hoàn tác. Cần đối soát.');
    }
  } else {
    const { data, error } = await client.rpc('reverse_customer_payment_atomic', {
      p_payment_id: operation.paymentId,
      p_reversal_id: operation.id,
    });
    if (error) throw new Error('Chưa xác nhận hoàn tác cloud: ' + error.message);
    if (data?.payment_id !== operation.paymentId || data?.state !== 'reversed') {
      throw new Error('Phản hồi hoàn tác không khớp. Cần đối soát.');
    }
  }
  // All database writes committed and response verified at this point.
  clearConfirmedOperation(operation.id);
}

export async function commitNewReceipt(
  client: SupabaseClient,
  input: {
    customerName: string;
    customerType: 'dtf' | 'tshirt';
    customerId: string;
    amount: number;
    method: string;
    targetOrderId?: string | null;
  },
): Promise<void> {
  validateVnd(input.amount);
  if (!input.customerName.trim() || !input.customerId.trim() || !input.method.trim()) {
    throw new Error('Thiếu thông tin khách hàng hoặc phương thức thanh toán.');
  }
  const operation: FinanceOperation = {
    kind: 'receipt',
    id: makeFinanceId(),
    customerName: input.customerName,
    customerType: input.customerType,
    customerId: input.customerId,
    amount: input.amount,
    method: input.method,
    targetOrderId: input.targetOrderId ?? null,
    createdAt: new Date().toISOString(),
  };
  persistNewOperation(operation);
  await transmitFinanceOperation(client, operation);
}

export async function commitNewReversal(
  client: SupabaseClient, paymentId: string,
): Promise<void> {
  if (!paymentId.trim()) throw new Error('Thiếu mã biên nhận để hoàn tác.');
  const operation: FinanceOperation = {
    kind: 'reversal', id: makeFinanceId(),
    paymentId, createdAt: new Date().toISOString(),
  };
  persistNewOperation(operation);
  await transmitFinanceOperation(client, operation);
}

// The only retry path reuses exactly the SAME idempotency key.
// UI must make this user-initiated and show the outstanding record details.
export async function retryPendingFinanceOperation(client: SupabaseClient): Promise<boolean> {
  const operation = getPendingFinanceOperation();
  if (!operation) return false;
  await transmitFinanceOperation(client, operation);
  return true;
}
