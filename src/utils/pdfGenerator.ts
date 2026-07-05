import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Order } from '../types';
import { getOrderProductSummary } from './orderSummary';

// Utility to remove Vietnamese accents for safe plain-text printing if needed
export function removeVietnameseAccents(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x00-\x7F]/g, ''); // fall back to ASCII
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

export function formatCurrencyText(value: number): string {
  return value.toLocaleString('vi-VN') + ' VND';
}

// Global offscreen PDF renderer helper using html2canvas & jsPDF for 100% vector rendering
async function renderHtmlToPdf(
  element: HTMLElement,
  fileName: string,
  isA5: boolean = false,
  singleLongPage: boolean = false
): Promise<void> {
  // Ensure Google Fonts is loaded for perfect render
  if (!document.getElementById('pdf-google-fonts')) {
    const link = document.createElement('link');
    link.id = 'pdf-google-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }

  // Mount offscreen
  document.body.appendChild(element);

  // Wait for fonts to be ready
  try {
    await (document as any).fonts?.ready;
  } catch (err) {
    console.warn('Font loading wait skipped:', err);
  }

  // Wait for all image nodes to fully load before capturing
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
      });
    })
  );

  try {
    const canvas = await html2canvas(element, {
      scale: 2.3, // Ultra high-resolution crisp vector rendering
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/png');

    if (isA5) {
      // Standard A5 page: 148mm x 210mm
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a5'
      });
      pdf.addImage(imgData, 'PNG', 0, 0, 148, 210);
      pdf.save(fileName);
    } else if (singleLongPage) {
      // Use one continuous custom-height page so ledger rows are never cut between A4 pages.
      const imgWidth = 210;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const pdf = new jsPDF({
        orientation: imgHeight > imgWidth ? 'portrait' : 'landscape',
        unit: 'mm',
        format: [imgWidth, imgHeight]
      });
      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, imgHeight);
      pdf.save(fileName);
    } else {
      // Standard A4 page: 210mm x 297mm
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      pdf.save(fileName);
    }
  } catch (error) {
    console.error('Lỗi khi biên dịch PDF:', error);
  } finally {
    // Unmount safely
    if (element.parentNode) {
      element.parentNode.removeChild(element);
    }
  }
}

// 1. COMPACT A5 SALE RECEIPT WITH GRAPHICS (unicode & thumbnails fully supported!)
export async function generateInvoicePDF(order: Order): Promise<void> {
  const container = document.createElement('div');
  
  // Outer template styling mimicking luxurious commercial invoice paper
  container.style.width = '555px'; // Perfect aspect ratio fit for A5
  container.style.padding = '35px';
  container.style.boxSizing = 'border-box';
  container.style.backgroundColor = '#ffffff';
  container.style.fontFamily = "'Inter', system-ui, Arial, sans-serif";
  container.style.color = '#334155';
  container.style.fontSize = '12px';
  container.style.lineHeight = '1.5';
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '-10000px';

  // Backwards compatibility with legacy orders lacking items
  const items = order.items && order.items.length > 0 ? order.items : [
    {
      id: 'legacy',
      type: order.type === 'dtf' ? 'dtf' : 'tshirt' as any,
      productName: order.productName,
      color: order.color || 'Mặc định',
      size: '',
      quantity: order.quantity,
      unitPrice: order.unitPrice,
      totalPrice: order.totalPrice,
      image: order.orderImages && order.orderImages[0] ? order.orderImages[0] : undefined
    }
  ];
  const uploadedImages = Array.from(new Set([
    ...(order.orderImages || []),
    ...(items.map(item => item.image).filter(Boolean) as string[]),
    ...items.flatMap(item => item.extraImages || [])
  ]));

  const itemsHtml = items.map((item, idx) => {
    const isTshirt = item.type === 'tshirt';
    const classification = item.color + (item.size ? ` - Size: ${item.size}` : '');
    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 10px 0; text-align: center; color: #64748b; font-weight: 500; font-family: 'JetBrains Mono', monospace; width: 40px;">${idx + 1}</td>
        <td style="padding: 10px 0;">
          <div style="font-weight: 700; color: #0f172a; font-size: 13px;">${item.productName}</div>
          <div style="font-size: 11px; color: #64748b; margin-top: 1.5px; font-family: system-ui;">Phân loại: ${classification}</div>
        </td>
        <td style="padding: 10px 0; text-align: right; width: 95px; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #475569;">${item.unitPrice.toLocaleString('vi-VN')} đ</td>
        <td style="padding: 10px 0; text-align: center; width: 40px; font-weight: 700; color: #0f172a;">${item.quantity}</td>
        <td style="padding: 10px 0; text-align: right; width: 110px; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #0f172a;">${item.totalPrice.toLocaleString('vi-VN')} đ</td>
      </tr>
    `;
  }).join('');
  const uploadedImagesHtml = uploadedImages.length > 0 ? `
    <div style="margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background-color: #f8fafc;">
      <div style="font-size: 10px; font-weight: 850; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Hình ảnh đã tải lên (${uploadedImages.length})</div>
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
        ${uploadedImages.map((image, index) => `
          <div style="position: relative;">
            <img src="${image}" style="width: 100%; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #e2e8f0; background: #ffffff;" referrerPolicy="no-referrer" />
            <div style="position: absolute; left: 4px; bottom: 4px; background: rgba(15, 23, 42, 0.72); color: white; font-size: 8px; font-weight: 800; border-radius: 999px; padding: 1px 5px;">${index + 1}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const typeText = order.type === 'dtf' ? 'In PET DTF gia công' : order.type === 'tshirt' ? 'Bán Sỉ Áo Thun phôi' : 'Đơn hàng tổng hợp gộp';
  const isTemporary = Boolean(order.isTemporary);
  const surcharge = order.surcharge || 0;
  const productSubtotal = Math.max(0, order.totalPrice - surcharge);
  const statusColor = order.status === 'completed' ? '#047857' : order.status === 'pending' ? '#b45309' : '#4b5563';
  const statusBg = order.status === 'completed' ? '#d1fae5' : order.status === 'pending' ? '#fef3c7' : '#f3f4f6';
  const statusText = order.status === 'completed' ? 'Đã thu đủ' : order.status === 'pending' ? 'Ghi nợ' : 'Đã hủy';

  container.innerHTML = `
    <!-- Top Branding Header -->
    <div style="padding-bottom: 25px; border-bottom: 2px solid #2563eb; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h1 style="margin: 0; font-size: 19px; font-weight: 900; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px;">CƠ SỞ IN ẤN HOÀNG UYÊN</h1>
        <p style="margin: 3px 0 0 0; font-size: 10.5px; color: #475569; font-weight: 500;">Gia Công In PET DTF & Áo Sỉ | Đồ Họa Chất Lượng Cao</p>
        <p style="margin: 2px 0 0 0; font-size: 9.5px; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">Đ/C: 557/51A Hương Lộ 3, Bình Tân, TP. HCM | SĐT: 0931325512 - 0941727079</p>
      </div>
      <div style="text-align: right;">
        <h2 style="margin: 0; font-size: 16px; font-weight: 950; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">${isTemporary ? 'BILL TẠM - KHÁCH KIỂM TRA' : 'HÓA ĐƠN BÁN HÀNG'}</h2>
        <span style="display: inline-block; padding: 4.5px 12px; border-radius: 8px; font-size: 10px; font-weight: 800; background-color: ${isTemporary ? '#dbeafe' : statusBg}; color: ${isTemporary ? '#1d4ed8' : statusColor}; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.5px;">${isTemporary ? 'Không ghi nhận công nợ' : statusText}</span>
      </div>
    </div>

    <!-- Info Panels -->
    <div style="margin: 20px 0; display: grid; grid-template-cols: 1fr 1fr; gap: 20px; font-size: 11.5px; background-color: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #f1f5f9;">
      <div style="float: left; width: 45%;">
        <div style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9px; margin-bottom: 5px; letter-spacing: 0.5px;">KHÁCH HÀNG THU THỤP</div>
        <div style="font-weight: 850; font-size: 14px; color: #0f172a; word-break: break-all;">${order.customerName}</div>
      </div>
      <div style="float: right; width: 55%; text-align: right;">
        <div style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9px; margin-bottom: 5px; letter-spacing: 0.5px;">THÔNG TIN GHI CHÉP</div>
        <div>${order.notes ? 'Ghi chú: ' : 'Mã đơn: '}<strong style="font-family: 'JetBrains Mono', monospace; color: #1e3a8a; font-size: 11px;">${order.notes || order.orderCode}</strong></div>
        <div style="margin-top: 1.5px;">Ngày lập: <span style="font-family: 'JetBrains Mono', monospace; font-weight: 500;">${new Date(order.createdAt).toLocaleDateString('vi-VN')}</span></div>
        <div style="margin-top: 1.5px;">Phân loại: <span style="font-weight: 700; color: #475569;">${typeText}</span></div>
      </div>
      <div style="clear: both;"></div>
    </div>

    <!-- Items Listing Table -->
    <div style="margin-top: 15px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: left;">
        <thead>
          <tr style="border-bottom: 2px solid #0f172a; background-color: #f8fafc;">
            <th style="padding: 10px 0; text-align: center; font-weight: 800; color: #0F172A; width: 40px;">STT</th>
            <th style="padding: 10px 0; font-weight: 800; color: #0F172A;">CHI TIẾT SẢN PHẨM</th>
            <th style="padding: 10px 0; text-align: right; font-weight: 800; color: #0F172A; width: 95px;">ĐƠN GIÁ</th>
            <th style="padding: 10px 0; text-align: center; font-weight: 800; color: #0F172A; width: 40px;">SL</th>
            <th style="padding: 10px 0; text-align: right; font-weight: 800; color: #0F172A; width: 110px;">THÀNH TIỀN</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    </div>
    ${uploadedImagesHtml}

    <!-- Bottom Pricing Box -->
    <div style="margin-top: 25px; border-top: 1px dashed #cbd5e1; padding-top: 15px; display: flex; justify-content: flex-end;">
      <div style="float: right; width: 280px; font-size: 12px; background-color: #f8fafc; padding: 12px 16px; border-radius: 12px; border: 1px solid #f1f5f9;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-weight: 500;">
          <span style="color: #64748b;">Tiền hàng:</span>
          <strong style="color: #0f172a; font-family: 'JetBrains Mono', monospace;">${productSubtotal.toLocaleString('vi-VN')} đ</strong>
        </div>
        ${surcharge > 0 ? `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-weight: 500;">
          <span style="color: #b45309;">Phụ thu:</span>
          <strong style="color: #b45309; font-family: 'JetBrains Mono', monospace;">${surcharge.toLocaleString('vi-VN')} đ</strong>
        </div>` : ''}
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; font-weight: 700;">
          <span style="color: #0f172a;">Tổng cộng:</span>
          <strong style="color: #0f172a; font-family: 'JetBrains Mono', monospace;">${order.totalPrice.toLocaleString('vi-VN')} đ</strong>
        </div>
        ${isTemporary ? `
        <div style="margin-top: 8px; padding: 8px; border-radius: 8px; background: #dbeafe; color: #1d4ed8; font-size: 10px; font-weight: 800; text-align: center;">
          SỐ TIỀN DỰ KIẾN - BILL NÀY KHÔNG VÀO DÒNG TIỀN/CÔNG NỢ
        </div>` : `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 6px; font-weight: 600;">
          <span style="color: #059669;">Khách dã trả:</span>
          <strong style="color: #059669; font-family: 'JetBrains Mono', monospace;">${order.paidAmount.toLocaleString('vi-VN')} đ</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13.5px;">
          <span style="color: #e11d48; font-weight: 850;">Khách còn nợ lại:</span>
          <strong style="color: #e11d48; font-family: 'JetBrains Mono', monospace; font-weight: 900;">${order.debtAmount.toLocaleString('vi-VN')} đ</strong>
        </div>`}
      </div>
      <div style="clear: both;"></div>
    </div>

    <!-- Friendly Footer Statement -->
    <div style="margin-top: 40px; text-align: center; font-style: italic; color: #94a3b8; font-size: 10px; border-top: 1.5px solid #f8fafc; padding-top: 15px;">
      Trân trọng cảm ơn quý khách hàng đã hợp tác và cùng đồng hành phát triển! SĐT: 0931325512 - 0941727079
    </div>
  `;

  await renderHtmlToPdf(container, `${isTemporary ? 'Bill_Tam' : 'Hoa_Don'}_${order.orderCode}.pdf`, true);
}

// 2. FORMAL RECONCILIATION STATEMENT (A4) WITH GRID DETAILS & IMAGE PROFILES
export async function generateReconciliationPDF(
  customerName: string,
  type: string,
  month: string,
  year: string,
  ordersList: Order[],
  stats: {
    totalQty: number;
    totalAmount: number;
    totalPaid: number;
    totalDebt: number;
  }
): Promise<void> {
  const container = document.createElement('div');
  
  // Outer specifications for A4 dimensions
  container.style.width = '755px'; // Exact viewport fitting nicely on A4 vertical space
  container.style.padding = '42px';
  container.style.boxSizing = 'border-box';
  container.style.backgroundColor = '#ffffff';
  container.style.fontFamily = "'Inter', system-ui, Arial, sans-serif";
  container.style.color = '#334155';
  container.style.fontSize = '12px';
  container.style.lineHeight = '1.5';
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '-10000px';

  const periodText = `Kỳ đối soát: ${month === 'all' ? 'Cả năm thống kê' : 'Tháng ' + month} / Năm ${year === 'all' ? 'Tất cả niên độ' : year}`;
  const typeText = type === 'tshirt' ? 'Bán sỉ Áo thun trơn' : type === 'dtf' ? 'In phim PET DTF gia công' : 'Giao dịch hỗn hợp gộp';
  const totalSurcharge = ordersList.reduce((sum, order) => sum + Math.max(0, order.surcharge || 0), 0);
  const totalProductAmount = Math.max(0, stats.totalAmount - totalSurcharge);

  const ordersHtml = ordersList.map((order, idx) => {
    const productSummary = getOrderProductSummary(order);
    const surcharge = Math.max(0, order.surcharge || 0);
    const productSubtotal = Math.max(0, order.totalPrice - surcharge);
    const isTshirt = order.type === 'tshirt' || order.productName.toLowerCase().includes('áo') || order.productName.toLowerCase().includes('t-shirt');
    const classification = order.color ? `Phân loại: ${order.color}` : 'Giao dịch gộp';
    
    // Check design image
    const imgUrl = order.orderImages && order.orderImages[0] ? order.orderImages[0] : null;
    const thumbnailHtml = imgUrl
      ? `<img src="${imgUrl}" style="width: 32px; height: 32px; object-fit: cover; border-radius: 4px; border: 1px solid #e2e8f0;" referrerPolicy="no-referrer" />`
      : `<div style="width: 32px; height: 32px; background-color: #f8fafc; border-radius: 4px; border: 1px dashed #cbd5e1; display: flex; align-items: center; justify-content: center; font-size: 8px; font-weight: bold; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">N/O</div>`;

    let sizeDetails = '';
    if (isTshirt) {
      if (order.items && order.items.length > 0) {
        const parts = order.items.map(item => `${item.productName} - Size ${item.size || 'N/A'}: ${item.quantity}`);
        sizeDetails = `Chi tiết size: ${parts.join(', ')}`;
      } else if (order.color && order.color.includes('Size')) {
        sizeDetails = `Chi tiết: ${order.color}`;
      }
    }

    return `
      <tr style="border-bottom: 1px solid #f1f5f9; font-size: 11px;">
        <td style="padding: 10px 0; text-align: center; color: #64748b; font-family: 'JetBrains Mono', monospace; width: 40px;">${idx + 1}</td>
        <td style="padding: 10px 0; font-family: 'JetBrains Mono', monospace; color: #475569; width: 80px;">${new Date(order.createdAt).toLocaleDateString('vi-VN')}</td>
        <td style="padding: 10px 0; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #1e3a8a; width: 100px;">${order.notes || order.orderCode}</td>
        <td style="padding: 10px 10px 10px 0; text-align: center; width: 45px;">${thumbnailHtml}</td>
        <td style="padding: 10px 0; font-weight: 700; color: #0f172a;">
          <div>${productSummary}</div>
          <div style="font-size: 10px; color: #64748b; font-weight: normal; margin-top: 1.5px;">${classification}</div>
          ${sizeDetails ? `<div style="font-size: 10px; color: #2563eb; font-weight: bold; margin-top: 3px; background: #eff6ff; padding: 2px 6px; border-radius: 4px; display: inline-block;">${sizeDetails}</div>` : ''}
          ${surcharge > 0 ? `<div style="font-size: 10px; color: #b45309; font-weight: 800; margin-top: 4px; background: #fffbeb; border: 1px solid #fcd34d; padding: 3px 6px; border-radius: 4px; display: inline-block;">PHỤ THU RIÊNG CỦA ĐƠN NÀY: ${surcharge.toLocaleString('vi-VN')} đ</div>` : ''}
        </td>
        <td style="padding: 10px 0; text-align: center; font-weight: 700; color: #0f172a; width: 45px;">${order.quantity}</td>
        <td style="padding: 10px 0; text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #475569; width: 90px;">${order.unitPrice.toLocaleString('vi-VN')}</td>
        <td style="padding: 10px 0; text-align: right; font-family: 'JetBrains Mono', monospace; width: 110px;">
          ${surcharge > 0 ? `
            <div style="font-size: 9px; color: #64748b;">Hàng: ${productSubtotal.toLocaleString('vi-VN')}</div>
            <div style="font-size: 9px; color: #b45309; font-weight: 700;">Phụ thu: +${surcharge.toLocaleString('vi-VN')}</div>
            <div style="font-size: 10.5px; color: #0f172a; font-weight: 800; border-top: 1px solid #e2e8f0; margin-top: 2px; padding-top: 2px;">Tổng: ${order.totalPrice.toLocaleString('vi-VN')}</div>
          ` : `<div style="font-weight: 700; color: #0f172a;">${order.totalPrice.toLocaleString('vi-VN')}</div>`}
        </td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <!-- Top A4 Commercial Header banner -->
    <div style="border-bottom: 2px solid #0f172a; padding-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h1 style="margin: 0; font-size: 20px; font-weight: 950; color: #1e3a8a; text-transform: uppercase; letter-spacing: 0.5px;">CƠ SỞ IN ẤN HOÀNG UYÊN</h1>
        <p style="margin: 3px 0 0 0; font-size: 11.5px; color: #475569; font-weight: 500;">Chuyên Gia In PET DTF Kỹ Thuật Số & Áo Sỉ Hàng Đầu Việt Nam</p>
        <p style="margin: 2.5px 0 0 0; font-size: 10px; color: #94a3b8; font-family: 'JetBrains Mono', monospace;">Địa chỉ: 557/51A Hương Lộ 3, Bình Tân, TP. HCM | Đường dây nóng: 0931325512 - 0941727079</p>
      </div>
      <div style="text-align: right;">
        <h2 style="margin: 0; font-size: 14px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 1px;">statement of accounts</h2>
        <span style="font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #64748b; display: block; margin-top: 4px;">Chào biên: ${new Date().toLocaleDateString('vi-VN')}</span>
      </div>
    </div>

    <!-- Context Intro and Title -->
    <div style="margin-top: 25px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 900; color: #1e3a8a; text-transform: uppercase;">BIÊN BẢN ĐỐI SOÁT & CHỐT DƯ NỢ CÔNG NỢ</h2>
      <p style="margin: 5px 0 0 0; font-weight: 800; color: #0f172a; text-transform: uppercase; font-size: 14px; border-left: 3.5px solid #2563eb; padding-left: 10px; margin-top: 8px;">QUÝ ĐỐI TÁC KHÁCH HÀNG: ${customerName.toUpperCase()}</p>
      
      <div style="margin-top: 15px; display: grid; grid-template-cols: 1fr 1.2fr; gap: 20px; font-size: 12px; background-color: #f8fafc; padding: 15px; border-radius: 12px; border: 1px solid #f1f5f9;">
        <div style="float: left; width: 45%;">
          <div style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; margin-bottom: 5px;">MỤC TIÊU NIÊN ĐỘ</div>
          <div>Mô hình hợp tác: <strong>${typeText}</strong></div>
          <div style="margin-top: 2px;">Thời kỳ báo cáo: <strong>${periodText}</strong></div>
        </div>
        <div style="float: right; width: 55%; text-align: right; font-size: 11.5px;">
          <div style="color: #64748b; font-weight: 700; text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; margin-bottom: 5px;">THỐNG KÊ LƯỢT LƯU</div>
          <div>Tổng giao dịch chốt sổ: <strong style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">${ordersList.length}</strong> đơn hàng</div>
          <div style="margin-top: 2.5px;">Tổng khối lượng giao dịch: <strong style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">${Number(stats.totalQty.toFixed(2)).toLocaleString('vi-VN')}</strong> mẫu / áo</div>
        </div>
        <div style="clear: both;"></div>
      </div>
    </div>

    <!-- Detailed Ledger Accounts Grid -->
    <div style="margin-top: 25px;">
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="border-bottom: 2.5px solid #0f172a; background-color: #f8fafc; font-size: 11.5px;">
            <th style="padding: 10px 0; text-align: center; font-weight: 800; color: #0F172A; width: 40px;">STT</th>
            <th style="padding: 10px 0; font-weight: 800; color: #0F172A; width: 80px;">NGÀY GHI REC</th>
            <th style="padding: 10px 0; font-weight: 800; color: #0F172A; width: 100px;">MÃ ĐƠN HÀNG</th>
            <th style="padding: 10px 10px 10px 0; text-align: center; font-weight: 800; color: #0F172A; width: 45px;">MẪU</th>
            <th style="padding: 10px 0; font-weight: 800; color: #0F172A;">NỘI DUNG SẢN PHẨM PHÁT SINH</th>
            <th style="padding: 10px 0; text-align: center; font-weight: 800; color: #0F172A; width: 45px;">SL</th>
            <th style="padding: 10px 0; text-align: right; font-weight: 800; color: #0F172A; width: 90px;">ĐƠN GIÁ</th>
            <th style="padding: 10px 0; text-align: right; font-weight: 800; color: #0F172A; width: 110px;">THÀNH TIỀN (VND)</th>
          </tr>
        </thead>
        <tbody>
          ${ordersHtml}
        </tbody>
      </table>
    </div>

    <!-- Multi-stage Cumulative Balances and Chot No signatures -->
    <div style="margin-top: 30px; page-break-inside: avoid;">
      <div style="width: 100%; margin-bottom: 20px; border-top: 1.5px solid #cbd5e1; padding-top: 15px;">
        <h3 style="margin: 0 0 10px 0; font-size: 13px; font-weight: 850; color: #0f172a; text-transform: uppercase; letter-spacing: 0.5px;">TỔNG HỢP GIAO DỊCH CHỐT LŨY KẾ:</h3>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 12px; padding-left: 2px;">
          <div>• Tổng tiền hàng trong kỳ: <strong style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">${totalProductAmount.toLocaleString('vi-VN')} đ</strong></div>
          ${totalSurcharge > 0 ? `<div>• Tổng phụ thu của các đơn: <strong style="color: #b45309; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${totalSurcharge.toLocaleString('vi-VN')} đ</strong></div>` : ''}
          <div>• Tổng doanh số gồm phụ thu: <strong style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">${stats.totalAmount.toLocaleString('vi-VN')} đ</strong></div>
          <div>• Tổng cộng số tiền bên Khách đã nộp: <strong style="color: #059669; font-family: 'JetBrains Mono', monospace; font-size: 12px;">${stats.totalPaid.toLocaleString('vi-VN')} đ</strong></div>
        </div>
      </div>

      <div style="background-color: #fff1f2; border: 1.5px solid #fda4af; border-radius: 12px; padding: 15px 22px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
        <div>
          <span style="font-size: 11.5px; font-weight: 800; color: #be123c; text-transform: uppercase; letter-spacing: 1px; display: block;">DƯ NỢ CÔNG NỢ CHỐT CUỐI KỲ PHẢI THU (CHỐT SỐ):</span>
          <span style="font-size: 10px; color: #f43f5e; display: block; margin-top: 1px;">(Đề nghị quý khách đối chiếu rà soát và thực hiện thanh toán như hợp đồng thỏa ước)</span>
        </div>
        <div style="font-size: 19.5px; font-weight: 950; color: #e11d48; font-family: 'JetBrains Mono', monospace;">
          ${stats.totalDebt.toLocaleString('vi-VN')} đ
        </div>
      </div>
    </div>

    <!-- Hand Signature Block Panel -->
    <div style="margin-top: 50px; page-break-inside: avoid; border-top: 1.5px solid #f1f5f9; padding-top: 20px;">
      <div style="float: left; width: 45%; text-align: center;">
        <div style="font-weight: 800; color: #4b5563; font-size: 11.5px; text-transform: uppercase;">ĐẠI DIỆN KHÁCH HÀNG ĐỐI TÁC</div>
        <div style="font-size: 10px; color: #94a3b8; font-style: italic; margin-top: 4.5px;">(Ký, ghi rõ họ tên và đóng dấu hờ)</div>
      </div>
      <div style="float: right; width: 45%; text-align: center;">
        <div style="font-weight: 800; color: #1e3a8a; font-size: 11.5px; text-transform: uppercase;">CƠ SỞ IN ẤN HOÀNG UYÊN</div>
        <div style="font-size: 10px; color: #94a3b8; font-style: italic; margin-top: 4.5px;">(Ký, ghi rõ họ tên và chốt sổ)</div>
      </div>
      <div style="clear: both;"></div>
    </div>
  `;

  const safeCustomerName = customerName.replace(/\s+/g, '_');
  await renderHtmlToPdf(container, `Doi_Soat_Cong_No_${safeCustomerName}_${month}_${year}.pdf`, false, true);
}
