import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { Order, PaymentHistory } from '../types';
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

// Reconciliation reports are measured as real DOM rows before rendering. Each A4
// page is captured independently, so neither tables nor signatures are sliced.
async function renderReconciliationPages(source: HTMLElement, fileName: string): Promise<void> {
  const pageWidth = 755;
  const pageHeight = Math.floor(pageWidth * 297 / 210);
  const bottomReserve = 44;
  const pageContentLimit = pageHeight - bottomReserve;
  const originalStyle = source.getAttribute('style') || '';
  source.style.width = pageWidth + 'px';
  source.style.height = 'auto';
  source.style.minHeight = '0';
  document.body.appendChild(source);
  try {
    await document.fonts.ready;
    const images = Array.from(source.querySelectorAll('img'));
    await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise<void>(resolve => {
      img.onload = () => resolve();
      img.onerror = () => resolve();
    })));

    const header = source.querySelector<HTMLElement>('[data-report-header]');
    const intro = source.querySelector<HTMLElement>('[data-report-intro]');
    const monthly = source.querySelector<HTMLElement>('[data-report-monthly]');
    const ledger = source.querySelector<HTMLElement>('[data-report-ledger]');
    const carry = source.querySelector<HTMLElement>('[data-report-carry]');
    const summary = source.querySelector<HTMLElement>('[data-report-summary]');
    const payments = source.querySelector<HTMLElement>('[data-report-payments]');
    const signatures = source.querySelector<HTMLElement>('[data-report-signatures]');
    if (!header || !intro || !monthly || !ledger || !carry || !summary || !payments || !signatures) {
      throw new Error('Missing reconciliation report sections');
    }

    const pages: HTMLElement[] = [];
    const makePage = (): HTMLElement => {
      const page = document.createElement('div');
      page.style.cssText = originalStyle;
      page.style.position = 'relative';
      page.style.left = 'auto';
      page.style.top = 'auto';
      page.style.width = pageWidth + 'px';
      page.style.height = pageHeight + 'px';
      page.style.minHeight = pageHeight + 'px';
      page.style.overflow = 'hidden';
      page.style.boxSizing = 'border-box';
      page.style.paddingBottom = '55px';
      const heading = header.cloneNode(true) as HTMLElement;
      heading.style.marginBottom = '16px';
      page.appendChild(heading);
      source.appendChild(page);
      pages.push(page);
      return page;
    };
    let page = makePage();
    const fits = (): boolean => {
      const last = page.lastElementChild as HTMLElement | null;
      if (!last) return true;
      return last.getBoundingClientRect().bottom - page.getBoundingClientRect().top <= pageContentLimit;
    };
    const appendBlock = (block: HTMLElement): void => {
      page.appendChild(block);
      if (!fits() && page.childElementCount > 2) {
        page.removeChild(block);
        page = makePage();
        page.appendChild(block);
      }
    };
    appendBlock(intro.cloneNode(true) as HTMLElement);

    const monthlyTable = monthly.querySelector('table');
    if (monthlyTable) {
      const monthlyRows = Array.from(monthlyTable.querySelectorAll('tbody > tr'));
      const monthlyHead = monthlyTable.querySelector('thead');
      let monthlyBody: HTMLTableSectionElement | null = null;
      const startMonthlyTable = (): void => {
        const section = document.createElement('div');
        section.style.marginTop = '22px';
        const heading = monthly.querySelector('h3');
        if (heading) section.appendChild(heading.cloneNode(true));
        const t = document.createElement('table');
        t.style.cssText = monthlyTable.getAttribute('style') || '';
        if (monthlyHead) t.appendChild(monthlyHead.cloneNode(true));
        monthlyBody = document.createElement('tbody');
        t.appendChild(monthlyBody);
        section.appendChild(t);
        page.appendChild(section);
      };
      startMonthlyTable();
      for (const row of monthlyRows) {
        const clone = row.cloneNode(true) as HTMLTableRowElement;
        monthlyBody!.appendChild(clone);
        if (!fits()) {
          monthlyBody!.removeChild(clone);
          if (monthlyBody!.rows.length === 0) throw new Error('Monthly summary row exceeds A4');
          page = makePage();
          startMonthlyTable();
          monthlyBody!.appendChild(clone);
          if (!fits()) throw new Error('Monthly summary row exceeds A4');
        }
      }
      const note = monthly.querySelector<HTMLElement>('[data-monthly-note]');
      if (note) appendBlock(note.cloneNode(true) as HTMLElement);
    }
    const table = ledger.querySelector('table');
    if (table) {
      const tableHeader = table.querySelector('thead');
      const rows = Array.from(table.querySelectorAll('tbody > tr'));
      let currentTable: HTMLTableElement | null = null;
      const startTable = (): void => {
        const wrapper = document.createElement('div');
        wrapper.style.marginTop = '18px';
        currentTable = document.createElement('table');
        currentTable.style.cssText = table.getAttribute('style') || '';
        if (tableHeader) currentTable.appendChild(tableHeader.cloneNode(true));
        currentTable.appendChild(document.createElement('tbody'));
        wrapper.appendChild(currentTable);
        page.appendChild(wrapper);
      };
      startTable();
      for (const row of rows) {
        const clonedRow = row.cloneNode(true) as HTMLTableRowElement;
        currentTable!.tBodies[0].appendChild(clonedRow);
        if (!fits()) {
          currentTable!.tBodies[0].removeChild(clonedRow);
          page = makePage();
          startTable();
          currentTable!.tBodies[0].appendChild(clonedRow);
          if (!fits()) {
            // Extremely long notes or product descriptions can exceed one A4.
            // Preserve the original record in the database; limit only its PDF
            // presentation and keep the full value in the source order.
            clonedRow.querySelectorAll('td').forEach(cell => {
              cell.style.paddingTop = '6px';
              cell.style.paddingBottom = '6px';
              cell.style.overflowWrap = 'anywhere';
              cell.style.wordBreak = 'break-word';
              cell.style.fontSize = '9px';
              cell.querySelectorAll('img').forEach(img => {
                img.style.maxWidth = '24px';
                img.style.maxHeight = '24px';
              });
            });
            if (!fits()) {
              throw new Error('Order ' + (rows.indexOf(row) + 1) + ' exceeds A4 even in compact mode');
            }
          }
        }
      }
    }
    const carryTable = carry.querySelector('table');
    if (carryTable) {
      const carryHeader = carryTable.querySelector('thead');
      const carryRows = Array.from(carryTable.querySelectorAll('tbody > tr'));
      let carryBody: HTMLTableSectionElement | null = null;
      const startCarryTable = (): void => {
        const section = document.createElement('div');
        section.style.marginTop = '22px';
        const heading = carry.querySelector('h3');
        if (heading) section.appendChild(heading.cloneNode(true));
        const t = document.createElement('table');
        t.style.cssText = carryTable.getAttribute('style') || '';
        if (carryHeader) t.appendChild(carryHeader.cloneNode(true));
        carryBody = document.createElement('tbody');
        t.appendChild(carryBody);
        section.appendChild(t);
        page.appendChild(section);
      };
      startCarryTable();
      for (const carryRow of carryRows) {
        const clone = carryRow.cloneNode(true) as HTMLTableRowElement;
        carryBody!.appendChild(clone);
        if (!fits()) {
          carryBody!.removeChild(clone);
          if (carryBody!.rows.length === 0) throw new Error('Carry-forward row exceeds A4');
          page = makePage();
          startCarryTable();
          carryBody!.appendChild(clone);
          if (!fits()) throw new Error('Carry-forward row exceeds A4');
        }
      }
    } else {
      appendBlock(carry.cloneNode(true) as HTMLElement);
    }
    appendBlock(summary.cloneNode(true) as HTMLElement);

    const paymentTable = payments.querySelector('table');
    if (!paymentTable) {
      appendBlock(payments.cloneNode(true) as HTMLElement);
    } else {
      const paymentHeading = payments.querySelector('h3');
      const paymentNote = payments.querySelector('div:last-child');
      const paymentRows = Array.from(paymentTable.querySelectorAll('tbody > tr'));
      const paymentHeader = paymentTable.querySelector('thead');
      let paymentBody: HTMLTableSectionElement | null = null;
      const startPaymentTable = (): void => {
        const section = document.createElement('div');
        section.style.cssText = 'margin-top:25px;padding-top:15px;border-top:1px solid #e2e8f0;';
        if (paymentHeading) section.appendChild(paymentHeading.cloneNode(true));
        const t = document.createElement('table');
        t.style.cssText = paymentTable.getAttribute('style') || '';
        if (paymentHeader) t.appendChild(paymentHeader.cloneNode(true));
        paymentBody = document.createElement('tbody');
        t.appendChild(paymentBody);
        section.appendChild(t);
        page.appendChild(section);
      };
      startPaymentTable();
      for (const paymentRow of paymentRows) {
        const clone = paymentRow.cloneNode(true) as HTMLTableRowElement;
        paymentBody!.appendChild(clone);
        if (!fits()) {
          paymentBody!.removeChild(clone);
          if (paymentBody!.rows.length === 0) throw new Error('One payment row exceeds an A4 page');
          page = makePage();
          startPaymentTable();
          paymentBody!.appendChild(clone);
          if (!fits()) throw new Error('One payment row exceeds an A4 page');
        }
      }
      if (paymentNote) appendBlock(paymentNote.cloneNode(true) as HTMLElement);
    }
    // Keep signatures with the final reconciliation summary whenever possible.
    // Reduce only decorative spacing before moving signatures to a new A4 page.
    const signatureBlock = signatures.cloneNode(true) as HTMLElement;
    const signaturePanel = signatureBlock.firstElementChild as HTMLElement | null;
    if (signaturePanel) signaturePanel.style.marginTop = '16px';
    page.appendChild(signatureBlock);
    if (!fits()) {
      if (signaturePanel) signaturePanel.style.marginTop = '0px';
      if (!fits()) {
        page.removeChild(signatureBlock);
        page = makePage();
        page.appendChild(signatureBlock);
        if (!fits()) throw new Error('Signature block exceeds A4 page');
      }
    }

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    for (let i = 0; i < pages.length; i++) {
      const footer = document.createElement('div');
      footer.style.cssText = 'position:absolute;bottom:18px;left:48px;right:48px;text-align:right;color:#64748b;font:11px Inter,Arial,sans-serif;';
      footer.textContent = 'Trang ' + (i + 1) + '/' + pages.length;
      pages[i].appendChild(footer);
      const canvas = await html2canvas(pages[i], {
        scale: 1.7, useCORS: true, logging: false, backgroundColor: '#ffffff'
      });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }
    pdf.save(fileName);
  } finally {
    if (source.parentNode) source.parentNode.removeChild(source);
  }
}

// 1. COMPACT A5 SALE RECEIPT WITH GRAPHICS (unicode & thumbnails fully supported!)
export async function generateInvoicePDF(order: Order): Promise<void> {
  const container = document.createElement('div');
  const isTemporary = Boolean(order.isTemporary);
  
  // Outer template styling mimicking luxurious commercial invoice paper
  container.style.width = isTemporary ? '755px' : '555px';
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

  // Temporary bills may contain many review rows, so keep their natural aspect
  // ratio and paginate across A4 pages instead of squeezing everything into A5.
  await renderHtmlToPdf(
    container,
    `${isTemporary ? 'Bill_Tam' : 'Hoa_Don'}_${order.orderCode}.pdf`,
    !isTemporary
  );
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
  },
  cumulativeStats?: { totalAmount: number; totalPaid: number; totalDebt: number },
  paymentHistory: PaymentHistory[] = [],
  cumulativeOrders: Order[] = ordersList
): Promise<void> {
  const container = document.createElement('div');
  const cumulative = cumulativeStats ?? {
    totalAmount: stats.totalAmount,
    totalPaid: stats.totalPaid,
    totalDebt: stats.totalDebt
  };
  // Only explicit legacy-debt descriptions are grouped as carry-forward entries.
  // No monetary values are changed and payments mentioned in notes are not deducted again.
  const isCarryForward = (order: Order): boolean =>
    /(?:^|\s)nợ\s*cũ|công\s*nợ\s*(?:đầu\s*kỳ|chuyển\s*kỳ)|số\s*dư\s*đầu\s*kỳ/i
      .test([order.notes, order.productName].filter(Boolean).join(' '));
  const periodCarry = ordersList.filter(isCarryForward);
  const periodProduction = ordersList.filter(order => !isCarryForward(order));
  const cumulativeCarry = cumulativeOrders.filter(isCarryForward);
  const carryAmount = cumulativeCarry.reduce((sum, order) => sum + order.totalPrice, 0);
  const productionAmount = cumulative.totalAmount - carryAmount;
  const periodProductionAmount = periodProduction.reduce((sum, order) => sum + order.totalPrice, 0);
  const periodCarryAmount = periodCarry.reduce((sum, order) => sum + order.totalPrice, 0);
  const carryHtml = periodCarry.map(order => `<tr style="border-bottom:1px solid #e2e8f0;">
    <td style="padding:11px 8px;">${new Date(order.createdAt).toLocaleDateString('vi-VN')}</td>
    <td style="padding:11px 8px;line-height:1.7;overflow-wrap:anywhere;">${order.notes || order.productName || order.orderCode}</td>
    <td style="padding:11px 8px;text-align:right;white-space:nowrap;font-weight:700;">${order.totalPrice.toLocaleString('vi-VN')} đ</td>
  </tr>`).join('');
  // Monthly cash flow uses the actual payment date, never the date of an order
  // to which a payment was later allocated.
  const reportOrders = [...cumulativeOrders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const reportingYear = year === 'all' ? null : Number(year);
  const reportingMonth = month === 'all' ? null : Number(month);
  const monthKeys = reportingYear === null
    ? [...new Set(reportOrders.map(o => o.createdAt.slice(0, 7)))].sort()
    : Array.from({ length: reportingMonth === null ? 12 : 1 }, (_, i) =>
        String(reportingYear) + '-' + String(reportingMonth === null ? i + 1 : reportingMonth).padStart(2, '0'));
  const periodStart = monthKeys.length ? monthKeys[0] : '';
  const allPayments = paymentHistory.filter(p => Number.isFinite(p.amount) && p.amount > 0);
  const totalAllocatedPaid = cumulativeOrders.reduce((sum, o) => sum + o.paidAmount, 0);
  const recordedPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
  const paymentDifference = totalAllocatedPaid - recordedPaid;
  const beforePeriod = reportOrders.filter(o => o.createdAt.slice(0, 7) < periodStart);
  const openingRecorded = beforePeriod.reduce((sum, o) => sum + o.totalPrice, 0);
  const openingPayments = allPayments.filter(p => p.createdAt.slice(0, 7) < periodStart)
    .reduce((sum, p) => sum + p.amount, 0);
  let runningRecordedBalance = openingRecorded - openingPayments;
  const money = (amount: number): string => Math.round(amount).toLocaleString('vi-VN');
  const monthlyRowsHtml = monthKeys.map(key => {
    const monthOrders = reportOrders.filter(o => o.createdAt.slice(0, 7) === key);
    const petOrders = monthOrders.filter(o => !isCarryForward(o));
    const oldOrders = monthOrders.filter(isCarryForward);
    const metres = petOrders.reduce((sum, o) => sum + o.quantity, 0);
    const petAmount = petOrders.reduce((sum, o) => sum + o.totalPrice, 0);
    const oldAmount = oldOrders.reduce((sum, o) => sum + o.totalPrice, 0);
    const paid = allPayments.filter(p => p.createdAt.slice(0, 7) === key)
      .reduce((sum, p) => sum + p.amount, 0);
    runningRecordedBalance += petAmount + oldAmount - paid;
    const label = key.slice(5) + '/' + key.slice(0, 4);
    return `<tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:9px 4px;white-space:nowrap;">${label}</td>
      <td style="padding:9px 4px;text-align:right;">${metres.toLocaleString('vi-VN',{maximumFractionDigits:2})}</td>
      <td style="padding:9px 4px;text-align:right;">${money(petAmount)}</td>
      <td style="padding:9px 4px;text-align:right;">${money(oldAmount)}</td>
      <td style="padding:9px 4px;text-align:right;color:#047857;">${money(paid)}</td>
      <td style="padding:9px 4px;text-align:right;font-weight:700;">${money(runningRecordedBalance)}</td>
    </tr>`;
  }).join('');
  const reconciliationWarning = Math.abs(paymentDifference) >= 1
    ? `<div style="color:#9a3412;background:#fff7ed;padding:10px;line-height:1.7;margin-top:10px;font-size:10px;">
       CẦN ĐỐI CHIẾU: Đã thanh toán phân bổ vào đơn đến cuối kỳ là ${money(totalAllocatedPaid)} đ,
       nhưng lịch sử nhận tiền ghi nhận ${money(recordedPaid)} đ.
       Chênh lệch ${money(paymentDifference)} đ có thể do thanh toán trực tiếp khi tạo đơn,
       điều chỉnh thủ công hoặc thiếu lịch sử. Không tự động phân bổ hay sửa dữ liệu.
      </div>`
    : '';
  const paymentsHtml = paymentHistory.length
    ? paymentHistory.map(payment => `<tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:11px 8px;">${new Date(payment.createdAt).toLocaleDateString('vi-VN')}</td>
        <td style="padding:11px 8px;">${payment.paymentMethod || 'Thanh toán'}</td>
        <td style="padding:11px 8px;text-align:right;font-weight:700;color:#047857;">${payment.amount.toLocaleString('vi-VN')} đ</td>
      </tr>`).join('')
    : '';
  
  // Outer specifications for A4 dimensions
  container.style.width = '755px'; // Exact viewport fitting nicely on A4 vertical space
  container.style.padding = '48px';
  container.style.boxSizing = 'border-box';
  container.style.backgroundColor = '#ffffff';
  container.style.fontFamily = "'Inter', system-ui, Arial, sans-serif";
  container.style.color = '#334155';
  container.style.fontSize = '12px';
  container.style.lineHeight = '1.7';
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '-10000px';

  const periodText = `Kỳ đối soát: ${month === 'all' ? 'Cả năm thống kê' : 'Tháng ' + month} / Năm ${year === 'all' ? 'Tất cả niên độ' : year}`;
  const typeText = type === 'tshirt' ? 'Bán sỉ Áo thun trơn' : type === 'dtf' ? 'In phim PET DTF gia công' : 'Giao dịch hỗn hợp gộp';
  const totalSurcharge = ordersList.reduce((sum, order) => sum + Math.max(0, order.surcharge || 0), 0);
  const totalProductAmount = Math.max(0, stats.totalAmount - totalSurcharge);

  const ordersHtml = periodProduction.map((order, idx) => {
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
        <td style="padding: 14px 0; text-align: center; color: #64748b; font-family: 'JetBrains Mono', monospace; width: 40px;">${idx + 1}</td>
        <td style="padding: 14px 0; font-family: 'JetBrains Mono', monospace; color: #475569; width: 80px;">${new Date(order.createdAt).toLocaleDateString('vi-VN')}</td>
        <td style="padding: 14px 0; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #1e3a8a; width: 100px;">${order.notes || order.orderCode}</td>
        <td style="padding: 14px 10px 14px 0; text-align: center; width: 45px;">${thumbnailHtml}</td>
        <td style="padding: 14px 0; font-weight: 700; color: #0f172a;">
          <div>${productSummary}</div>
          <div style="font-size: 10px; color: #64748b; font-weight: normal; margin-top: 1.5px;">${classification}</div>
          ${sizeDetails ? `<div style="font-size: 10px; color: #2563eb; font-weight: bold; margin-top: 3px; background: #eff6ff; padding: 2px 6px; border-radius: 4px; display: inline-block;">${sizeDetails}</div>` : ''}
          ${surcharge > 0 ? `<div style="font-size: 10px; color: #b45309; font-weight: 800; margin-top: 4px; background: #fffbeb; border: 1px solid #fcd34d; padding: 3px 6px; border-radius: 4px; display: inline-block;">PHỤ THU RIÊNG CỦA ĐƠN NÀY: ${surcharge.toLocaleString('vi-VN')} đ</div>` : ''}
        </td>
        <td style="padding: 14px 0; text-align: center; font-weight: 700; color: #0f172a; width: 45px;">${order.quantity}</td>
        <td style="padding: 14px 0; text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #475569; width: 90px;">${order.unitPrice.toLocaleString('vi-VN')}</td>
        <td style="padding: 14px 0; text-align: right; font-family: 'JetBrains Mono', monospace; width: 110px;">
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
    <div data-report-header>
      <div style="border-bottom:2px solid #0f172a;padding-bottom:10px;">
        <h1 style="margin:0;font-size:19px;font-weight:850;color:#1e3a8a;">CƠ SỞ IN ẤN HOÀNG UYÊN</h1>
      </div>
    </div>
    <div data-report-intro>
      <div style="margin-top:14px;">
        <h2 style="margin:0;font-size:18px;font-weight:850;color:#1e3a8a;">ĐỐI SOÁT CÔNG NỢ</h2>
        <p style="margin:7px 0 0;font-size:15px;font-weight:800;color:#0f172a;">KHÁCH HÀNG: ${customerName.toUpperCase()}</p>
        <p style="margin:5px 0 0;font-size:13px;color:#475569;">${periodText} · ${periodProduction.length} đơn PET · ${Number(periodProduction.reduce((sum, order) => sum + order.quantity, 0).toFixed(2)).toLocaleString('vi-VN')} m</p>
      </div>
    </div>
    <div data-report-monthly>
      <div style="margin-top:24px;">
        <h3 style="font-size:13px;color:#1e3a8a;margin:0 0 12px;">TỔNG HỢP PET VÀ CÔNG NỢ THEO THÁNG</h3>
        <table style="width:100%;border-collapse:collapse;font-size:9px;line-height:1.6;">
          <thead><tr style="background:#f1f5f9;color:#334155;">
            <th style="padding:9px 4px;text-align:left;">Tháng</th>
            <th style="padding:9px 4px;text-align:right;">Mét PET</th>
            <th style="padding:9px 4px;text-align:right;">Tiền PET</th>
            <th style="padding:9px 4px;text-align:right;">Nợ cũ ghi nhận</th>
            <th style="padding:9px 4px;text-align:right;">Tiền nhận</th>
            <th style="padding:9px 4px;text-align:right;">Dư nợ theo sổ thu</th>
          </tr></thead>
          <tbody>${monthlyRowsHtml}</tbody>
        </table>
        <div data-monthly-note style="font-size:10px;color:#64748b;line-height:1.8;margin-top:12px;">
          Dư đầu kỳ theo giao dịch và lịch sử thu: ${money(openingRecorded - openingPayments)} đ.
          Tiền nhận được xếp theo ngày thực thu; nợ cũ chỉ ghi một lần tại tháng phát sinh.
          Dư nợ theo sổ thu có thể khác dư nợ phân bổ vào đơn nếu lịch sử thanh toán chưa đầy đủ.
          ${reconciliationWarning}
        </div>
      </div>
    </div>
    <div data-report-ledger>
    <!-- Detailed Ledger Accounts Grid -->
    <div style="margin-top: 25px;">
      <h3 style="font-size:13px;color:#1e3a8a;margin:0 0 12px;">I. ĐƠN HÀNG PET PHÁT SINH TRONG KỲ</h3>
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="border-bottom: 2.5px solid #0f172a; background-color: #f8fafc; font-size: 11.5px;">
            <th style="padding: 14px 0; text-align: center; font-weight: 800; color: #0F172A; width: 40px;">STT</th>
            <th style="padding: 14px 0; font-weight: 800; color: #0F172A; width: 80px;">NGÀY GHI REC</th>
            <th style="padding: 14px 0; font-weight: 800; color: #0F172A; width: 100px;">MÃ ĐƠN HÀNG</th>
            <th style="padding: 14px 10px 14px 0; text-align: center; font-weight: 800; color: #0F172A; width: 45px;">MẪU</th>
            <th style="padding: 14px 0; font-weight: 800; color: #0F172A;">NỘI DUNG SẢN PHẨM PHÁT SINH</th>
            <th style="padding: 14px 0; text-align: center; font-weight: 800; color: #0F172A; width: 45px;">SL</th>
            <th style="padding: 14px 0; text-align: right; font-weight: 800; color: #0F172A; width: 90px;">ĐƠN GIÁ</th>
            <th style="padding: 14px 0; text-align: right; font-weight: 800; color: #0F172A; width: 110px;">THÀNH TIỀN (VND)</th>
          </tr>
        </thead>
        <tbody>
          ${ordersHtml}
        </tbody>
      </table>
    </div>

    </div>
    <div data-report-carry>
      <div style="margin-top:24px;">
        <h3 style="font-size:13px;color:#92400e;margin:0 0 12px;">II. CÔNG NỢ CŨ / SỐ DƯ CHUYỂN KỲ GHI NHẬN TRONG KỲ</h3>
        ${carryHtml ? `<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr><th style="text-align:left;padding:9px;">Ngày ghi nhận</th><th style="text-align:left;padding:9px;">Diễn giải gốc</th><th style="text-align:right;padding:9px;">Giá trị</th></tr></thead><tbody>${carryHtml}</tbody></table>` : '<div style="font-size:11px;color:#64748b;">Không có khoản nợ cũ được nhận diện trong các giao dịch của kỳ này.</div>'}
        <div style="font-size:10px;color:#64748b;margin-top:10px;line-height:1.7;">Phân loại theo mô tả đã lưu, không làm thay đổi tổng nợ. Khoản nợ cũ được ghi nhận như giao dịch lịch sử; không phải mét phim PET mới in.</div>
      </div>
    </div>
    <div data-report-summary>
    <!-- Reporting period totals and cumulative customer balances -->
    <div style="margin-top:36px;page-break-inside:avoid;">
      <h3 style="font-size:13px;color:#0f172a;margin:0 0 12px;letter-spacing:0.35px;">III. PHÁT SINH TRONG KỲ ĐỐI SOÁT</h3>
      <div style="font-size:12px;line-height:1.9;margin:6px 0;">Đơn PET và phụ thu trong kỳ: <strong>${periodProductionAmount.toLocaleString('vi-VN')} đ</strong></div>
      <div style="font-size:12px;line-height:1.9;margin:6px 0;">Nợ cũ ghi nhận trong kỳ: <strong>${periodCarryAmount.toLocaleString('vi-VN')} đ</strong></div>
      <div style="font-size:12px;line-height:1.9;margin:6px 0;">Tổng phát sinh được ghi nhận: <strong>${stats.totalAmount.toLocaleString('vi-VN')} đ</strong></div>
      <div style="font-size:12px;line-height:1.9;margin:6px 0;">Số tiền đã phân bổ thanh toán cho đơn trong kỳ: <strong>${stats.totalPaid.toLocaleString('vi-VN')} đ</strong></div>
      <h3 style="margin:28px 0 15px;font-size:14px;color:#1e3a8a;letter-spacing:0.35px;">IV. TỔNG HỢP CÔNG NỢ LŨY KẾ ĐẾN CUỐI KỲ</h3>
      <div style="font-size:11px;line-height:1.9;margin:10px 0;">Tổng giao dịch PET lũy kế: <strong>${productionAmount.toLocaleString('vi-VN')} đ</strong> · Nợ cũ được ghi nhận lũy kế: <strong>${carryAmount.toLocaleString('vi-VN')} đ</strong></div>
      <div style="display:flex;gap:16px;margin:15px 0 18px;">
        <div style="width:50%;background:#f1f5f9;padding:18px;border-radius:10px;">
          <div style="font-size:10px;color:#64748b;line-height:1.7;margin-bottom:8px;">TỔNG GIÁ TRỊ GHI NHẬN (PET + NỢ CŨ)</div>
          <strong style="font-size:18px;color:#0f172a;">${cumulative.totalAmount.toLocaleString('vi-VN')} đ</strong>
        </div>
        <div style="width:50%;background:#ecfdf5;padding:18px;border-radius:10px;">
          <div style="font-size:10px;color:#047857;line-height:1.7;margin-bottom:8px;">TỔNG ĐÃ THANH TOÁN LŨY KẾ</div>
          <strong style="font-size:18px;color:#047857;">${cumulative.totalPaid.toLocaleString('vi-VN')} đ</strong>
        </div>
      </div>
      <div style="background:#fff1f2;border:1px solid #fda4af;border-radius:10px;padding:20px;display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:12px;color:#be123c;">CÔNG NỢ CÒN PHẢI THU ĐẾN CUỐI KỲ</strong>
        <strong style="font-size:20px;color:#e11d48;">${cumulative.totalDebt.toLocaleString('vi-VN')} đ</strong>
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:14px;line-height:1.9;">Lũy kế được tính từ các đơn hàng đã ghi nhận đến hết kỳ đối soát, không xóa nợ khi chuyển tháng. Tiền thanh toán lấy từ số đã phân bổ vào đơn hàng.</div>
    </div>
    </div>
    <div data-report-payments style="margin-top:34px;padding-top:18px;border-top:1px solid #e2e8f0;page-break-inside:avoid;">
      <h3 style="font-size:13px;color:#0f172a;margin:0 0 15px;letter-spacing:0.35px;">V. LỊCH SỬ THANH TOÁN ĐẾN CUỐI KỲ</h3>
      ${paymentsHtml ? `<table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr style="background:#f8fafc;"><th style="text-align:left;padding:11px 8px;">Ngày</th><th style="text-align:left;padding:11px 8px;">Phương thức</th><th style="text-align:right;padding:11px 8px;">Số tiền</th></tr></thead><tbody>${paymentsHtml}</tbody></table>` : '<div style="font-size:11px;color:#64748b;">Không có lịch sử thanh toán riêng được ghi nhận.</div>'}
      <div style="font-size:10px;color:#64748b;margin-top:14px;line-height:1.8;">Lịch sử dùng để đối chiếu, không cộng lần thứ hai vào tổng đã thanh toán.</div>
    </div>

    </div>
    <div data-report-signatures>
    <!-- Hand Signature Block Panel -->
    <div style="margin-top: 60px; page-break-inside: avoid; border-top: 1.5px solid #f1f5f9; padding-top: 20px;">
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
  await renderReconciliationPages(container, `Doi_Soat_Cong_No_${safeCustomerName}_${month}_${year}.pdf`);
}
