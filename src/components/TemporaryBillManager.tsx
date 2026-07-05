import { useMemo, useState } from 'react';
import { FileText, Plus, Printer, Trash2, X } from 'lucide-react';
import { Order, OrderItem, TemporaryBill } from '../types';
import { StorageManager } from '../lib/storage';
import { formatCurrency, generateInvoicePDF } from '../utils/pdfGenerator';

interface DraftLine {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

const newLine = (): DraftLine => ({
  id: `draft_${Math.random().toString(36).slice(2, 9)}`,
  productName: '',
  quantity: 1,
  unitPrice: 0
});

const toPrintableOrder = (bill: TemporaryBill): Order => ({
  id: bill.id,
  orderCode: bill.billCode,
  customerName: bill.customerName,
  type: bill.type,
  productName: bill.items.map(item => item.productName).join(', '),
  color: 'Báo giá tạm',
  quantity: bill.items.reduce((sum, item) => sum + item.quantity, 0),
  unitPrice: 0,
  totalPrice: bill.totalPrice,
  paidAmount: 0,
  debtAmount: 0,
  status: 'pending',
  createdAt: bill.createdAt,
  items: bill.items,
  notes: bill.notes,
  surcharge: bill.surcharge,
  isTemporary: true
});

export default function TemporaryBillManager() {
  const [bills, setBills] = useState<TemporaryBill[]>(() => StorageManager.getTemporaryBills());
  const [showForm, setShowForm] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [type, setType] = useState<'dtf' | 'tshirt'>('dtf');
  const [createdAt, setCreatedAt] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);
  const [surcharge, setSurcharge] = useState(0);
  const [notes, setNotes] = useState('');

  const subtotal = useMemo(
    () => lines.reduce((sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.unitPrice), 0),
    [lines]
  );
  const totalPrice = subtotal + Math.max(0, surcharge);

  const resetForm = () => {
    setCustomerName('');
    setType('dtf');
    setCreatedAt(new Date().toISOString().slice(0, 10));
    setLines([newLine()]);
    setSurcharge(0);
    setNotes('');
  };

  const handleSave = () => {
    const validLines = lines.filter(line => line.productName.trim() && line.quantity > 0);
    if (!customerName.trim() || validLines.length === 0) {
      alert('Vui lòng nhập tên khách và ít nhất một mặt hàng hợp lệ.');
      return;
    }

    const items: OrderItem[] = validLines.map(line => ({
      id: `tmp_item_${Math.random().toString(36).slice(2, 10)}`,
      type,
      productName: line.productName.trim(),
      color: type === 'dtf' ? 'PET DTF - bill tạm' : 'Áo thun - bill tạm',
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPrice),
      totalPrice: Number(line.quantity) * Number(line.unitPrice)
    }));

    StorageManager.saveTemporaryBill({
      customerName: customerName.trim(),
      type,
      items,
      surcharge: Math.max(0, surcharge),
      totalPrice,
      notes: notes.trim(),
      createdAt: new Date(`${createdAt}T12:00:00`).toISOString()
    });
    setBills(StorageManager.getTemporaryBills());
    resetForm();
    setShowForm(false);
  };

  const handleDelete = (bill: TemporaryBill) => {
    if (!confirm(`Xóa bill tạm ${bill.billCode}? Thao tác này không ảnh hưởng hóa đơn chính.`)) return;
    StorageManager.deleteTemporaryBill(bill.id);
    setBills(StorageManager.getTemporaryBills());
  };

  return (
    <div className="space-y-6 animate-fade-in text-slate-700">
      <div className="rounded-2xl bg-slate-900 text-white p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black">Bill tạm gửi khách kiểm tra</h1>
          <p className="text-xs text-slate-400 mt-1">Không trừ kho, không ghi doanh thu, không tạo công nợ và không liên quan hóa đơn chính.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Tạo bill tạm
        </button>
      </div>

      {bills.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-16 text-center">
          <FileText className="w-12 h-12 mx-auto text-slate-300" />
          <h2 className="font-black text-slate-700 mt-4">Chưa có bill tạm</h2>
          <p className="text-sm text-slate-400 mt-1">Tạo bill để khách kiểm tra trước khi thanh toán.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {bills.map(bill => (
            <div key={bill.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className={`inline-block text-[10px] font-black uppercase px-2 py-1 rounded-lg ${bill.type === 'dtf' ? 'bg-blue-50 text-blue-700' : 'bg-indigo-50 text-indigo-700'}`}>
                    {bill.type === 'dtf' ? 'PET DTF' : 'Áo thun'}
                  </span>
                  <h3 className="font-black text-slate-900 mt-2">{bill.customerName}</h3>
                  <p className="text-[11px] font-mono text-slate-400">{bill.billCode} · {new Date(bill.createdAt).toLocaleDateString('vi-VN')}</p>
                </div>
                <strong className="font-mono text-lg text-slate-900">{formatCurrency(bill.totalPrice)}</strong>
              </div>
              <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                {bill.items.map(item => (
                  <div key={item.id} className="flex justify-between gap-3 text-xs">
                    <span className="font-bold text-slate-700">{item.productName} <span className="text-slate-400">x {item.quantity}</span></span>
                    <span className="font-mono">{formatCurrency(item.totalPrice)}</span>
                  </div>
                ))}
                {bill.surcharge > 0 && <div className="text-xs text-amber-700 font-bold">Phụ thu: +{formatCurrency(bill.surcharge)}</div>}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => generateInvoicePDF(toPrintableOrder(bill))} className="px-3 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                  <Printer className="w-3.5 h-3.5" /> Xuất PDF
                </button>
                <button onClick={() => handleDelete(bill)} className="px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" /> Xóa bill
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[80] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="sticky top-0 bg-slate-900 text-white px-6 py-5 flex items-center justify-between z-10">
              <div>
                <h2 className="font-black text-lg">Tạo bill tạm</h2>
                <p className="text-xs text-slate-400">Bill kiểm tra, không vào dòng tiền chính</p>
              </div>
              <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-slate-800 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1.5">Tên khách hàng</label>
                  <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Nhập tên khách..." className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-bold" />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1.5">Ngày lập bill</label>
                  <input type="date" value={createdAt} onChange={e => setCreatedAt(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-bold" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-2">Nguồn tiền dự kiến</label>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setType('dtf')} className={`py-3 rounded-xl border font-black cursor-pointer ${type === 'dtf' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>PET DTF</button>
                  <button onClick={() => setType('tshirt')} className={`py-3 rounded-xl border font-black cursor-pointer ${type === 'tshirt' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>Bán áo thun</button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black uppercase text-slate-500">Danh sách mặt hàng</label>
                  <button onClick={() => setLines(prev => [...prev, newLine()])} className="text-xs font-bold text-blue-600 cursor-pointer">+ Thêm dòng</button>
                </div>
                {lines.map((line, index) => (
                  <div key={line.id} className="grid grid-cols-12 gap-2 items-center rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <input value={line.productName} onChange={e => setLines(prev => prev.map(item => item.id === line.id ? { ...item, productName: e.target.value } : item))} placeholder={type === 'dtf' ? 'Nội dung in PET DTF' : 'Tên áo / size'} className="col-span-12 md:col-span-6 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold" />
                    <input type="number" min="0.01" step="0.01" value={line.quantity} onChange={e => setLines(prev => prev.map(item => item.id === line.id ? { ...item, quantity: Number(e.target.value) } : item))} className="col-span-4 md:col-span-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-mono" title="Số lượng" />
                    <input type="number" min="0" value={line.unitPrice} onChange={e => setLines(prev => prev.map(item => item.id === line.id ? { ...item, unitPrice: Number(e.target.value) } : item))} className="col-span-6 md:col-span-3 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-mono" title="Đơn giá" />
                    <button disabled={lines.length === 1} onClick={() => setLines(prev => prev.filter(item => item.id !== line.id))} className="col-span-2 md:col-span-1 text-rose-600 disabled:opacity-30 cursor-pointer flex justify-center"><Trash2 className="w-4 h-4" /></button>
                    <div className="col-span-12 text-right text-xs font-mono text-slate-500">Dòng {index + 1}: {formatCurrency(line.quantity * line.unitPrice)}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1.5">Phụ thu</label>
                  <input type="number" min="0" value={surcharge || ''} onChange={e => setSurcharge(Number(e.target.value))} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 font-mono font-bold" />
                </div>
                <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-right">
                  <span className="block text-[10px] font-black uppercase text-blue-500">Tổng bill tạm</span>
                  <strong className="text-xl font-mono text-blue-900">{formatCurrency(totalPrice)}</strong>
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1.5">Ghi chú</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 min-h-20" placeholder="Nội dung cần khách kiểm tra..." />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-xl text-slate-500 font-bold cursor-pointer">Hủy</button>
                <button onClick={handleSave} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black cursor-pointer">Lưu bill tạm</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
