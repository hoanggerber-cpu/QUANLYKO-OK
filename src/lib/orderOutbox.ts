import type { Order } from '../types';

// Durable pending-write registry: never claim a locally saved order reached the
// shared database until a read-back proves its accounting values match.
const ORDER_OUTBOX_KEY = 'petshirt_admin_pending_orders_v1';

export interface PendingOrderSync {
  id: string;
  customerName: string;
  type: string;
  totalPrice: number;
  paidAmount: number;
  debtAmount: number;
  itemIds: string[];
  createdAt: string;
  lastError?: string;
}

export function validateOrderAmounts(order: Pick<Order,'totalPrice'|'paidAmount'|'debtAmount'>): void {
  if (![order.totalPrice, order.paidAmount, order.debtAmount].every(Number.isSafeInteger)
    || order.totalPrice < 0 || order.paidAmount < 0 || order.debtAmount < 0
    || order.totalPrice !== order.paidAmount + order.debtAmount) {
    throw new Error('Sai phép tính kế toán: tổng đơn phải bằng đã trả cộng còn nợ (VND nguyên).');
  }
}

export function getPendingOrders(): PendingOrderSync[] {
  const json = localStorage.getItem(ORDER_OUTBOX_KEY);
  if (!json) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch {
    throw new Error('Nhật ký đơn hàng chưa đồng bộ bị hỏng. Không được xóa hay ghi đè.');
  }
  if (!Array.isArray(parsed) || parsed.some(x =>
    !x || typeof x.id !== 'string' || !Array.isArray(x.itemIds) ||
    typeof x.customerName !== 'string')) {
    throw new Error('Nhật ký đồng bộ có định dạng sai. Cần sao lưu và đối soát.');
  }
  return parsed as PendingOrderSync[];
}

function save(entries: PendingOrderSync[]): void {
  localStorage.setItem(ORDER_OUTBOX_KEY, JSON.stringify(entries));
  if (localStorage.getItem(ORDER_OUTBOX_KEY) !== JSON.stringify(entries)) {
    throw new Error('Không lưu được nhật ký đồng bộ. Dừng ghi đơn.');
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('order_sync_status'));
}

export function queueOrderForSync(order: Order): void {
  validateOrderAmounts(order);
  const current = getPendingOrders();
  if (current.some(item => item.id === order.id)) {
    throw new Error('Mã đơn đã có trong hàng đợi; không thể ghi trùng.');
  }
  save([...current, {
    id: order.id, customerName: order.customerName,
    type: order.type, totalPrice: order.totalPrice,
    paidAmount: order.paidAmount, debtAmount: order.debtAmount,
    itemIds: order.items?.map(item => item.id) || [],
    createdAt: order.createdAt,
  }]);
}

export function confirmOrderSync(id: string): void {
  const current = getPendingOrders();
  if (!current.some(item => item.id === id)) return;
  save(current.filter(item => item.id !== id));
}

export function noteOrderSyncError(id: string, error: string): void {
  const current = getPendingOrders();
  const next = current.map(item =>
    item.id === id ? { ...item, lastError: error.slice(0, 500) } : item
  );
  save(next);
}

export function matchesRecordedOrder(
  pending: PendingOrderSync,
  remote: {
    id?: string; customer_name?: string; type?: string;
    total_price?: unknown; paid_amount?: unknown; debt_amount?: unknown;
  },
): boolean {
  return String(remote.id) === pending.id &&
    remote.customer_name === pending.customerName &&
    remote.type === pending.type &&
    Number(remote.total_price) === pending.totalPrice &&
    Number(remote.paid_amount) === pending.paidAmount &&
    Number(remote.debt_amount) === pending.debtAmount;
}
