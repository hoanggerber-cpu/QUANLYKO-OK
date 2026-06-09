import { Customer, Order, PaymentHistory } from '../types';
import { formatCurrency } from './pdfGenerator';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const safeFileName = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');

const imageToDataUrl = async (url: string): Promise<string> => {
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
};

export async function exportCustomerProfile(
  customer: Customer,
  orders: Order[],
  payments: PaymentHistory[]
): Promise<void> {
  const customerOrders = orders
    .filter(order => order.customerName === customer.name && order.type === customer.type)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const customerPayments = payments
    .filter(payment => payment.customerName === customer.name && payment.type === customer.type)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const imageUrls = Array.from(new Set(customerOrders.flatMap(order => [
    ...(order.orderImages || []),
    ...(order.items?.map(item => item.image).filter(Boolean) as string[] || [])
  ]).filter(Boolean)));
  const embeddedImages = new Map<string, string>();
  await Promise.all(imageUrls.map(async url => embeddedImages.set(url, await imageToDataUrl(url))));

  const totalAmount = customerOrders.reduce((sum, order) => sum + order.totalPrice, 0);
  const totalPaid = customerOrders.reduce((sum, order) => sum + order.paidAmount, 0);
  const totalDebt = customerOrders.reduce((sum, order) => sum + order.debtAmount, 0);
  const totalPayments = customerPayments.reduce((sum, payment) => sum + payment.amount, 0);

  const orderRows = customerOrders.map(order => {
    const images = Array.from(new Set([
      ...(order.orderImages || []),
      ...(order.items?.map(item => item.image).filter(Boolean) as string[] || [])
    ]));
    const items = order.items?.length
      ? `<table class="items"><thead><tr><th>Sản phẩm</th><th>Màu/Size</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${order.items.map(item =>
          `<tr><td>${escapeHtml(item.productName)}</td><td>${escapeHtml([item.color, item.size].filter(Boolean).join(' / '))}</td><td>${escapeHtml(item.quantity)}</td><td>${formatCurrency(item.unitPrice)}</td><td>${formatCurrency(item.totalPrice)}</td></tr>`
        ).join('')}</tbody></table>`
      : '';
    const imageHtml = images.length
      ? `<div class="images">${images.map(image => {
          const source = embeddedImages.get(image) || image;
          return `<figure><img src="${escapeHtml(source)}" alt="Ảnh thiết kế"><figcaption><a href="${escapeHtml(image)}">Mở ảnh gốc</a></figcaption></figure>`;
        }).join('')}</div>`
      : '<div class="muted">Không có hình ảnh</div>';

    return `<section class="order">
      <div class="order-head"><strong>${escapeHtml(order.notes || order.orderCode)}</strong><span>${new Date(order.createdAt).toLocaleString('vi-VN')}</span></div>
      <div class="grid"><div>Sản phẩm<br><b>${escapeHtml(order.productName)}</b></div><div>Số lượng<br><b>${escapeHtml(order.quantity)}</b></div><div>Tổng tiền<br><b>${formatCurrency(order.totalPrice)}</b></div><div>Đã trả<br><b class="paid">${formatCurrency(order.paidAmount)}</b></div><div>Còn nợ<br><b class="debt">${formatCurrency(order.debtAmount)}</b></div></div>
      ${order.notes ? `<p><b>Ghi chú:</b> ${escapeHtml(order.notes)}</p>` : ''}
      ${items}${imageHtml}
    </section>`;
  }).join('');

  const paymentRows = customerPayments.map(payment =>
    `<tr><td>${new Date(payment.createdAt).toLocaleString('vi-VN')}</td><td>${escapeHtml(payment.paymentMethod)}</td><td class="paid">${formatCurrency(payment.amount)}</td></tr>`
  ).join('');

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Hồ sơ ${escapeHtml(customer.name)}</title>
  <style>
  body{font-family:Arial,sans-serif;color:#172033;max-width:1100px;margin:32px auto;padding:0 20px;background:#f5f7fb}h1,h2{margin:0 0 12px}.card,.order{background:#fff;border:1px solid #dce3ee;border-radius:12px;padding:18px;margin-bottom:16px}.summary,.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.summary div,.grid div{background:#f7f9fc;padding:12px;border-radius:8px;font-size:13px}.paid{color:#078548}.debt{color:#d21f3c}.order-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.items,table{width:100%;border-collapse:collapse;margin-top:14px;font-size:13px}th,td{border:1px solid #dce3ee;padding:8px;text-align:left}.images{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:14px}.images figure{margin:0}.images img{width:100%;height:180px;object-fit:contain;background:#eef2f7;border-radius:8px}.images figcaption{font-size:11px;margin-top:4px}.muted{color:#718096;font-size:12px;margin-top:12px}@media print{body{background:#fff;margin:0}.order{break-inside:avoid}}
  </style></head><body>
  <div class="card"><h1>Hồ sơ khách hàng: ${escapeHtml(customer.name)}</h1><p>Phân loại: <b>${escapeHtml(customer.type.toUpperCase())}</b> | Xuất lúc: ${new Date().toLocaleString('vi-VN')}</p>
  <div class="summary"><div>Tổng đơn hàng<br><b>${customerOrders.length}</b></div><div>Tổng tiền<br><b>${formatCurrency(totalAmount)}</b></div><div>Đã phân bổ vào đơn<br><b class="paid">${formatCurrency(totalPaid)}</b></div><div>Còn nợ<br><b class="debt">${formatCurrency(totalDebt)}</b></div><div>Lịch sử đã thu<br><b class="paid">${formatCurrency(totalPayments)}</b></div><div>Tổng ảnh<br><b>${imageUrls.length}</b></div></div></div>
  <h2>Chi tiết đơn hàng và hình ảnh</h2>${orderRows || '<div class="card muted">Chưa có đơn hàng.</div>'}
  <div class="card"><h2>Lịch sử thu tiền</h2><table><thead><tr><th>Ngày thu</th><th>Phương thức/Ghi chú</th><th>Số tiền</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="3">Chưa có giao dịch thu tiền.</td></tr>'}</tbody></table></div>
  </body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ho-so-khach-hang-${safeFileName(customer.name) || 'khach-hang'}-${customer.type}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
