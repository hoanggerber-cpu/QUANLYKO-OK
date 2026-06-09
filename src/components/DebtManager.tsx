import React, { useState } from 'react';
import { Customer, OrderType, Order, PaymentHistory } from '../types';
import { formatCurrency, generateReconciliationPDF } from '../utils/pdfGenerator';
import { exportCustomerProfile } from '../utils/customerExport';
import { StorageManager } from '../lib/storage';
import { 
  Search, 
  Landmark, 
  ShieldCheck, 
  Calendar, 
  Sparkles, 
  ArrowLeft, 
  Download, 
  Eye, 
  Image as ImageIcon,
  Trash2,
  Edit,
  Link,
  Ban,
  CheckCircle
} from 'lucide-react';

interface DebtManagerProps {
  customers: Customer[];
  orders: Order[];
  onRecordPayment: (customerName: string, type: OrderType, amount: number, paymentMethod: string) => void;
  onUndoPayment?: (paymentId: string, customerName: string, type: OrderType) => void;
  onRecordOrderPayment?: (orderId: string, amount: number) => void;
  onUpdateCustomer?: (oldName: string, type: OrderType, newName: string, newTotalSpent?: number, newTotalPaid?: number, newPinCode?: string | null) => any;
  onDeleteCustomer?: (customerName: string, type: OrderType) => void;
  onUpdateOrder?: (id: string, updatedFields: Partial<Order>) => any;
}

export default function DebtManager({ 
  customers, 
  orders, 
  onRecordPayment, 
  onUndoPayment,
  onRecordOrderPayment,
  onUpdateCustomer,
  onDeleteCustomer,
  onUpdateOrder
}: DebtManagerProps) {
  const [activeTab, setActiveTab] = useState<OrderType>('dtf');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Custom Edit & Delete customer states
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editCustName, setEditCustName] = useState('');
  const [editCustTotalSpent, setEditCustTotalSpent] = useState(0);
  const [editCustTotalPaid, setEditCustTotalPaid] = useState(0);
  const [editCustPinCode, setEditCustPinCode] = useState('');

  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null);
  const [exportingCustomer, setExportingCustomer] = useState(false);

  // Edit Order modal states
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editCustomerName, setEditCustomerName] = useState('');
  const [editPaidAmount, setEditPaidAmount] = useState(0);
  const [editPaidAmountStr, setEditPaidAmountStr] = useState('');
  const [editTotalPrice, setEditTotalPrice] = useState(0);
  const [editTotalPriceStr, setEditTotalPriceStr] = useState('');
  const [editQuantity, setEditQuantity] = useState(0);
  const [editQtyStr, setEditQtyStr] = useState('');
  const [editStatus, setEditStatus] = useState<'pending' | 'completed' | 'cancelled'>('pending');
  const [editCreatedAt, setEditCreatedAt] = useState('');
  const [editUnitPrice, setEditUnitPrice] = useState(0);
  const [editUnitPriceStr, setEditUnitPriceStr] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const openEditOrder = (order: Order) => {
    let initialQuantity = order.quantity;
    if (order.type === 'dtf') {
      if (order.color) {
        const match = order.color.match(/(?:Độ dài|Đoạn)\s*([\d.]+)\s*m/i);
        if (match) {
          const parsedMeters = parseFloat(match[1]);
          if (!isNaN(parsedMeters) && parsedMeters > 0) {
            initialQuantity = parsedMeters;
          }
        }
      } else if (order.productName) {
        const match = order.productName.match(/In PET phim\s*\(([\d.]+)\s*m\)/i);
        if (match) {
          const parsedMeters = parseFloat(match[1]);
          if (!isNaN(parsedMeters) && parsedMeters > 0) {
            initialQuantity = parsedMeters;
          }
        }
      }
      
      if (initialQuantity === 1 && order.unitPrice > 0 && order.totalPrice > order.unitPrice) {
        const calcQty = order.totalPrice / order.unitPrice;
        initialQuantity = Number(calcQty.toFixed(2));
      }
    }

    setEditingOrder(order);
    setEditCustomerName(order.customerName);
    setEditPaidAmount(order.paidAmount);
    setEditPaidAmountStr(String(order.paidAmount));
    setEditTotalPrice(order.totalPrice);
    setEditTotalPriceStr(String(order.totalPrice));
    setEditQuantity(initialQuantity);
    setEditQtyStr(String(initialQuantity));
    setEditStatus(order.status);
    setEditCreatedAt(order.createdAt ? order.createdAt.substring(0, 10) : new Date().toISOString().substring(0, 10));
    setEditUnitPrice(order.unitPrice || 0);
    setEditUnitPriceStr(String(order.unitPrice || 0));
    setEditNotes(order.notes || '');
  };

  const handleEditOrderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;

    const finalQuantity = parseFloat(editQtyStr) || 0;
    const finalUnitPrice = parseFloat(editUnitPriceStr) || 0;
    const finalTotalPrice = parseFloat(editTotalPriceStr) || 0;
    const finalPaidAmount = Math.min(finalTotalPrice, parseFloat(editPaidAmountStr) || 0);
    const newDebtAmount = Math.max(0, finalTotalPrice - finalPaidAmount);
    
    // Automatically set status based on debt unless user chose 'cancelled'
    let finalStatus = editStatus;
    if (finalStatus !== 'cancelled') {
      finalStatus = newDebtAmount === 0 ? 'completed' : 'pending';
    }

    let finalProductName = editingOrder.productName;
    let finalColor = editingOrder.color || '';
    if (editingOrder.type === 'dtf') {
      finalProductName = `In PET phim (${finalQuantity.toFixed(1)}m)`;
      if (finalColor.includes('Độ dài')) {
        finalColor = `Độ dài ${finalQuantity.toFixed(2)}m`;
      } else if (finalColor.includes('Đoạn')) {
        finalColor = `Đoạn ${finalQuantity.toFixed(2)}m (SL:1)`;
      } else {
        finalColor = `Độ dài ${finalQuantity.toFixed(2)}m`;
      }
    } else if (editingOrder.type === 'tshirt') {
      if (/\(\d+\s*chiếc\)/i.test(finalProductName)) {
        finalProductName = finalProductName.replace(/\(\d+\s*chiếc\)/i, `(${Math.round(finalQuantity)} chiếc)`);
      } else {
        finalProductName = `${finalProductName.replace(/\s*\(\d+\s*chiếc\)/gi, '')} (${Math.round(finalQuantity)} chiếc)`;
      }
    }

    const updatedFields: Partial<Order> = {
      customerName: editCustomerName.trim(),
      productName: finalProductName,
      color: finalColor,
      quantity: finalQuantity,
      unitPrice: finalUnitPrice,
      totalPrice: finalTotalPrice,
      paidAmount: finalPaidAmount,
      debtAmount: newDebtAmount,
      status: finalStatus,
      notes: editNotes.trim()
    };

    if (editCreatedAt) {
      updatedFields.createdAt = new Date(editCreatedAt + 'T12:00:00.000Z').toISOString();
    }

    if (onUpdateOrder) {
      try {
        await onUpdateOrder(editingOrder.id, updatedFields);
        showToast('Đã cập nhật chi tiết đơn hàng thành công!', 'success');
        setEditingOrder(null);
      } catch (err) {
        console.error('Update order submit failed in DebtManager:', err);
      }
    } else {
      setEditingOrder(null);
    }
  };


  // Toast notifications states
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('success');
  const [isSyncing, setIsSyncing] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => {
      setToastMessage(prev => prev === msg ? null : prev);
    }, 4000);
  };

  const handleSyncSupabase = async () => {
    setIsSyncing(true);
    try {
      const isOnline = await StorageManager.checkSupabaseConnection();
      if (isOnline) {
        const success = await StorageManager.syncAllDataFromSupabase();
        if (success) {
          showToast("Đã đồng bộ hóa dữ liệu từ Supabase thành công!", "success");
          window.dispatchEvent(new CustomEvent('supabase_sync_success'));
        } else {
          showToast("Lỗi đồng bộ dữ liệu từ Supabase!", "error");
        }
      } else {
        showToast("Không thể kết nối đến Supabase. Hệ thống đang chạy chế độ Local Backup.", "error");
      }
    } catch (error) {
      showToast("Lỗi đồng bộ dữ liệu từ Supabase!", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  const openEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setEditCustName(customer.name);
    setEditCustTotalSpent(customer.totalSpent);
    setEditCustTotalPaid(customer.paidAmount);
    setEditCustPinCode(customer.pinCode || '');
  };

  const handleEditCustomerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;

    if (onUpdateCustomer) {
      try {
        await onUpdateCustomer(
          editingCustomer.name,
          editingCustomer.type,
          editCustName.trim(),
          editCustTotalSpent,
          editCustTotalPaid,
          editCustPinCode.trim() || null
        );
        showToast(`Đã cập nhật công nợ khách hàng ${editCustName.trim()} thành công!`, 'success');
        setEditingCustomer(null);
      } catch (err) {
        console.error('Update customer submit failed in DebtManager:', err);
      }
    } else {
      setEditingCustomer(null);
    }
  };

  const handleDeleteCustomerConfirm = () => {
    if (!deletingCustomer) return;
    if (onDeleteCustomer) {
      onDeleteCustomer(deletingCustomer.name, deletingCustomer.type);
      showToast(`Đã xóa khách hàng ${deletingCustomer.name} thành công!`, 'success');
    }
    setDeletingCustomer(null);
  };

  // Drill-down detailed customer state
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [filterMonth, setFilterMonth] = useState<string>((new Date().getMonth() + 1).toString());
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null);

  // Payment modal state
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payAmountInputStr, setPayAmountInputStr] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  // Specific order payment state
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [payOrderAmount, setPayOrderAmount] = useState(0);

  // Reactive current customer
  const currentCustomer = selectedCustomer
    ? customers.find(c => c.name === selectedCustomer.name && c.type === selectedCustomer.type) || selectedCustomer
    : null;

  const countUnpaidOrders = (customerName: string, type: OrderType) => {
    return orders.filter(
      (o) => o.customerName === customerName && o.type === type && o.debtAmount > 0
    ).length;
  };

  const filtered = customers
    .filter(
      (c) =>
        c.type === activeTab &&
        c.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => b.debtAmount - a.debtAmount);

  const handleCollectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payCustomer) return;
    if (payAmount <= 0) return;

    onRecordPayment(payCustomer.name, payCustomer.type, payAmount, paymentNote.trim() || 'Mặc định');
    
    const formattedAmount = formatCurrency(payAmount);
    const noteSuffix = paymentNote.trim() ? ` - Ghi chú: ${paymentNote.trim()}` : '';
    showToast(`Đã ghi nhận thanh toán thành công số tiền ${formattedAmount}${noteSuffix}!`, 'success');

    setPayCustomer(null);
    setPayAmount(0);
    setPayAmountInputStr('');
    setPaymentNote('');
  };

  const handleCollectOrderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payOrder) return;
    if (payOrderAmount <= 0) return;

    if (onRecordOrderPayment) {
      onRecordOrderPayment(payOrder.id, payOrderAmount);
      showToast(`Đã ghi nhận thanh toán thành công số tiền ${formatCurrency(payOrderAmount)} cho hóa đơn ${payOrder.orderCode}!`, 'success');
    }
    setPayOrder(null);
    setPayOrderAmount(0);
  };

  const activeTabLabel = activeTab === 'dtf' ? 'In Pet DTF' : 'Áo thun Kho';

  // Settle Debt Dialog renderer
  const renderPaymentModal = () => {
    if (!payCustomer) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in text-slate-700">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-emerald-700 text-white">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Landmark className="w-5 h-5" />
              <span>Nhập số tiền khách thanh toán</span>
            </h3>
            <button
              onClick={() => setPayCustomer(null)}
              className="text-white/80 hover:text-white cursor-pointer text-xl"
            >
              &times;
            </button>
          </div>
 
          <form onSubmit={handleCollectSubmit} className="p-6 space-y-4">
            <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Khách hàng:</span>
                <span className="font-bold text-slate-800">{payCustomer.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Mảng kinh doanh:</span>
                <span className="font-semibold text-blue-600">{payCustomer.type === 'dtf' ? 'In Pet DTF' : 'Áo thun Kho'}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200/50">
                <span className="text-slate-500 font-medium">Tổng tiền còn nợ:</span>
                <span className="font-bold text-rose-600 text-sm font-mono">{formatCurrency(payCustomer.debtAmount)}</span>
              </div>
            </div>
 
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Số tiền khách trả (VND)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-sm">
                  ₫
                </div>
                <input
                  type="text"
                  required
                  value={payAmountInputStr}
                  placeholder="Ví dụ: 25.000.000"
                  onChange={(e) => {
                    const cleanValue = e.target.value.replace(/\D/g, '');
                    const numVal = cleanValue ? parseInt(cleanValue, 10) : 0;
                    const finalVal = Math.min(payCustomer.debtAmount, numVal);
                    setPayAmount(finalVal);
                    setPayAmountInputStr(finalVal > 0 ? finalVal.toLocaleString('vi-VN') : '');
                  }}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 border border-slate-205 rounded-xl text-md font-bold text-emerald-700 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 font-medium mt-1.5">
                <span>Nhập số tiền hoặc bấm nút bên</span>
                <button
                  type="button"
                  onClick={() => {
                    setPayAmount(payCustomer.debtAmount);
                    setPayAmountInputStr(payCustomer.debtAmount.toLocaleString('vi-VN'));
                  }}
                  className="text-blue-600 font-semibold hover:underline cursor-pointer"
                >
                  Thu hết nợ
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Ghi chú (Tùy chọn)</label>
              <input
                type="text"
                placeholder="Ví dụ: Chuyển khoản VCB"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 border border-slate-205 rounded-xl text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
 
            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setPayCustomer(null)}
                className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl transition-all cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-emerald-500/15 cursor-pointer"
              >
                Xác nhận thanh toán
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Specific Order-level gạch nợ modal
  const renderOrderPaymentModal = () => {
    if (!payOrder) return null;
    return (
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in text-slate-700">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-emerald-700 text-white">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Landmark className="w-5 h-5" />
              <span>Thu nợ theo hóa đơn chi tiết</span>
            </h3>
            <button
              onClick={() => setPayOrder(null)}
              className="text-white/80 hover:text-white cursor-pointer text-xl"
            >
              &times;
            </button>
          </div>

          <form onSubmit={handleCollectOrderSubmit} className="p-6 space-y-4">
            <div className="bg-slate-50 p-4.5 rounded-xl border border-slate-200/50 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Mã đơn hàng:</span>
                <span className="font-mono font-bold text-slate-850">{payOrder.orderCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium">Khách nợ:</span>
                <span className="font-bold text-slate-800">{payOrder.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-medium font-bold">Mặt hàng:</span>
                <span className="font-semibold text-slate-700">{payOrder.productName}</span>
              </div>
              <div className="flex justify-between pt-1.5 border-t border-slate-200/50">
                <span className="text-slate-500 font-medium">Nợ hiện tại của đơn này:</span>
                <span className="font-bold text-rose-600 text-sm font-mono">{formatCurrency(payOrder.debtAmount)}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Số tiền gạch nợ lẻ hóa đơn (VND)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-sm">
                  ₫
                </div>
                <input
                  type="number"
                  min="1000"
                  max={payOrder.debtAmount}
                  required
                  value={payOrderAmount}
                  onChange={(e) => setPayOrderAmount(Math.min(payOrder.debtAmount, Math.max(1000, Number(e.target.value))))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 border border-slate-205 rounded-xl text-md font-bold text-emerald-700 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div className="flex justify-between text-[11px] text-slate-400 font-medium mt-1.5">
                <span>Nhập số tiền khách trả riêng cho đơn này</span>
                <button
                  type="button"
                  onClick={() => setPayOrderAmount(payOrder.debtAmount)}
                  className="text-blue-600 font-semibold hover:underline cursor-pointer"
                >
                  Thu sạch đơn
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setPayOrder(null)}
                className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl transition-all cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="submit"
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl transition-all shadow-md shadow-emerald-500/15 cursor-pointer"
              >
                Xác nhận gạch nợ
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // DRILL-DOWN LEDGER PAGE RENDERER
  const renderDetailView = () => {
    if (!selectedCustomer || !currentCustomer) return null;
    const customerOrders = orders.filter(
      (o) => o.customerName === currentCustomer.name && o.type === currentCustomer.type
    );

    // Apply filters (Year / Month) and sort chronologically descending
    const filteredCustomerOrders = customerOrders
      .filter((o) => {
        const orderDateObj = new Date(o.createdAt);
        const orderYear = orderDateObj.getFullYear().toString();
        const orderMonth = (orderDateObj.getMonth() + 1).toString();
        
        const yearMatch = filterYear === 'all' || orderYear === filterYear;
        const monthMatch = filterMonth === 'all' || orderMonth === filterMonth;
        return yearMatch && monthMatch;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Stats
    const totalQty = filteredCustomerOrders.reduce((acc, o) => acc + o.quantity, 0);
    const totalAmount = filteredCustomerOrders.reduce((acc, o) => acc + o.totalPrice, 0);
    const totalPaid = filteredCustomerOrders.reduce((acc, o) => acc + o.paidAmount, 0);
    const totalDebt = totalAmount - totalPaid;

    const handleExportPDF = () => {
      generateReconciliationPDF(
        currentCustomer.name,
        currentCustomer.type,
        filterMonth,
        filterYear,
        filteredCustomerOrders,
        {
          totalQty,
          totalAmount,
          totalPaid,
          totalDebt
        }
      );
    };

    const handleExportCustomerProfile = async () => {
      setExportingCustomer(true);
      try {
        await exportCustomerProfile(currentCustomer, orders, StorageManager.getPaymentHistory());
        showToast('Đã xuất toàn bộ hồ sơ, hình ảnh và công nợ khách hàng!', 'success');
      } catch (error) {
        console.error('Customer profile export failed:', error);
        showToast('Không thể xuất hồ sơ khách hàng. Vui lòng thử lại!', 'error');
      } finally {
        setExportingCustomer(false);
      }
    };

    const handleCopyTrackingLink = () => {
      const slug = StorageManager.getTrackingSlugForCustomer(currentCustomer.name, currentCustomer.type);
      const link = `${window.location.origin}/c/${slug}`;
      navigator.clipboard.writeText(link).then(() => {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2500);
      }).catch(err => {
        console.error('Không thể copy liên kết: ', err);
      });
    };

    return (
      <div className="space-y-6 animate-fade-in text-slate-700">
        {/* Header Breadcrumbs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedCustomer(null)}
              className="p-2.5 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-slate-800 transition-colors cursor-pointer border border-slate-200"
              title="Quay lại danh sách"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                  Sổ Cái / Lịch sử Công Nợ
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-850 mt-0.5">Sổ Công Nợ Chi Tiết - {currentCustomer.name}</h2>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Filters */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-1.5 rounded-xl">
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(e.target.value)}
                className="bg-transparent border-0 focus:ring-0 text-xs font-bold text-slate-600 focus:outline-none px-2 cursor-pointer"
              >
                <option value="all">Tất cả các năm</option>
                <option value="2026">Năm 2026</option>
                <option value="2025">Năm 2025</option>
                <option value="2024">Năm 2024</option>
              </select>

              <div className="h-4 w-px bg-slate-200"></div>

              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="bg-transparent border-0 focus:ring-0 text-xs font-bold text-slate-600 focus:outline-none px-2 cursor-pointer"
              >
                <option value="all">Tất cả các tháng</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m.toString()}>Tháng {m}</option>
                ))}
              </select>
            </div>

            {/* Copy Link to Client */}
            <button
              onClick={handleCopyTrackingLink}
              className={`px-4 py-2.5 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all hover:shadow cursor-pointer uppercase tracking-wider ${
                copiedLink 
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/10' 
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow shadow-indigo-500/10'
              }`}
            >
              <Link className="w-4 h-4" />
              <span>{copiedLink ? 'Đã copy thành công!' : 'Copy Link Gửi Khách'}</span>
            </button>

            {/* Export Receipt */}
            <button
              onClick={handleExportCustomerProfile}
              disabled={exportingCustomer}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all hover:shadow shadow-emerald-500/10 cursor-pointer disabled:cursor-wait uppercase tracking-wider"
            >
              <Download className="w-4.5 h-4.5" />
              <span>{exportingCustomer ? 'Đang gom hình ảnh...' : 'Xuất toàn bộ hồ sơ'}</span>
            </button>

            <button
              onClick={handleExportPDF}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all hover:shadow shadow-blue-500/10 cursor-pointer uppercase tracking-wider"
            >
              <Download className="w-4.5 h-4.5" />
              <span>Xuất đối soát PDF</span>
            </button>
          </div>
        </div>

        {/* Detailed KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900 border border-slate-800 text-white p-5 rounded-2xl shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
              {currentCustomer.type === 'dtf' ? 'Tổng số mét in' : 'Tổng số lượng hàng'}
            </span>
            <span className="text-2xl font-black mt-3 font-mono text-blue-400">
              {Number(totalQty.toFixed(2)).toLocaleString('vi-VN')} <span className="text-xs font-bold text-slate-400">{currentCustomer.type === 'dtf' ? 'm' : 'chiếc'}</span>
            </span>
            <span className="text-[10px] text-slate-500 block mt-1.5">Trong chu kỳ đã chọn</span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Tổng tiền đơn hàng</span>
            <span className="text-2xl font-black mt-3 font-mono text-slate-800">{formatCurrency(totalAmount)}</span>
            <span className="text-[10px] text-slate-400 block mt-1.5">Phát sinh từ {filteredCustomerOrders.length} hóa đơn</span>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between relative">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Tổng tiền đã trả</span>
              <span className="text-2xl font-black mt-3 font-mono text-emerald-650 block">{formatCurrency(totalPaid)}</span>
            </div>
            {currentCustomer.debtAmount > 0 && (
              <button
                onClick={() => {
                  setPayCustomer(currentCustomer);
                  setPayAmount(currentCustomer.debtAmount);
                  setPayAmountInputStr(currentCustomer.debtAmount.toLocaleString('vi-VN'));
                  setPaymentNote('');
                }}
                className="mt-3.5 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 uppercase tracking-wide cursor-pointer"
              >
                <span>💰 NHẬP TIỀN KHÁCH TRẢ</span>
              </button>
            )}
            <span className="text-[10px] text-emerald-500 block mt-1.5">Lũy kế thực thu ghi sổ</span>
          </div>

          <div className="bg-rose-50 border border-rose-100 p-5 rounded-2xl shadow-inner flex flex-col justify-between animate-pulse">
            <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest block">Dư nợ hiện tại</span>
            <span className="text-2xl font-black mt-3 font-mono text-rose-600">{formatCurrency(currentCustomer.debtAmount)}</span>
            <span className="text-[10px] text-rose-500 font-bold block mt-1.5">
              {currentCustomer.debtAmount > 0 ? '⚠️ Cần đối soát thu nợ gấp' : '✅ Hoàn thành thanh khoản'}
            </span>
          </div>
        </div>

        {/* Action bar and transaction table */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-fade-in">
          <div className="px-6 py-4.5 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
              <h3 className="font-bold text-slate-800">Bảng kê chi tiết đơn hàng lịch sử</h3>
            </div>
            
            {/* Quick Record Payment here */}
            {currentCustomer.debtAmount > 0 && (
              <button
                onClick={() => {
                  setPayCustomer(currentCustomer);
                  setPayAmount(currentCustomer.debtAmount);
                  setPayAmountInputStr(currentCustomer.debtAmount.toLocaleString('vi-VN'));
                  setPaymentNote('');
                }}
                className="px-3.5 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-bold rounded-lg transition-colors cursor-pointer shadow-sm flex items-center gap-1.5 uppercase tracking-wide"
              >
                <span>💰 NHẬP TIỀN KHÁCH TRẢ</span>
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-4 px-6">Ngày mua</th>
                  <th className="py-4 px-6">Ghi chú / Mã đơn</th>
                  <th className="py-4 px-6">Tóm tắt mặt hàng</th>
                  <th className="py-4 px-6 text-right">Tổng tiền hóa đơn</th>
                  <th className="py-4 px-6 text-right">Đã thanh toán</th>
                  <th className="py-4 px-6 text-right">Số nợ còn lại</th>
                  <th className="py-4 px-6 text-center">Xử lý thu nợ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredCustomerOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-slate-400 font-medium">
                      Không tìm thấy giao dịch nào của khách trong thời kỳ được chọn
                    </td>
                  </tr>
                ) : (
                  filteredCustomerOrders.map((order) => (
                    <tr key={order.id} className="hover:bg-slate-50/40 transition-colors text-slate-650">
                      <td className="py-4 px-6 font-medium text-slate-500">
                        {new Date(order.createdAt).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="py-4 px-6">
                        {order.notes ? (
                          <div className="font-semibold text-slate-700 bg-slate-150/70 border border-slate-200/50 px-2 pl-2.5 pr-2.5 py-1 rounded-xl text-xs max-w-[220px] break-words whitespace-pre-wrap leading-snug" title={order.notes}>
                            {order.notes}
                          </div>
                        ) : (
                          <span className="font-bold text-slate-400 font-mono text-xs">{order.orderCode}</span>
                        )}
                      </td>
                      <td className="py-4 px-6">
                        <div className="space-y-1">
                          <span className="block font-bold text-slate-850 leading-tight">{order.productName}</span>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-medium select-none">
                            <span>S.Lượng: <strong className="text-slate-600">{order.quantity}</strong></span>
                            <span>•</span>
                            <span>Đơn giá: <strong className="text-slate-600">{formatCurrency(order.unitPrice)}</strong></span>
                            {order.color && (
                              <>
                                <span>•</span>
                                <span>Màu: <strong className="text-slate-600">{(order.color || '').replace(/\s*\(Phân khúc nhập sỉ\)/gi, '')}</strong></span>
                              </>
                            )}
                          </div>
                          {Array.isArray(order.orderImages) && order.orderImages.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {order.orderImages.map((img, imIdx) => (
                                <img
                                  key={imIdx}
                                  src={img}
                                  alt="Thiết kế"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActivePreviewImage(img);
                                  }}
                                  className="w-8 h-8 object-cover rounded-lg border border-slate-200 shadow-sm cursor-zoom-in hover:brightness-90 hover:scale-105 transition-all"
                                  referrerPolicy="no-referrer"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-right font-mono font-bold text-slate-700">
                        {formatCurrency(order.totalPrice)}
                      </td>
                      <td className="py-4 px-6 text-right font-mono text-emerald-600 font-medium">
                        {formatCurrency(order.paidAmount)}
                      </td>
                      <td className="py-4 px-6 text-right font-mono text-rose-600 font-extrabold bg-rose-50/10">
                        {formatCurrency(order.debtAmount)}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {order.debtAmount > 0 ? (
                            <button
                              onClick={() => {
                                setPayOrder(order);
                                setPayOrderAmount(order.debtAmount);
                              }}
                              className="px-3 py-1.5 bg-emerald-600 font-bold hover:bg-emerald-700 text-white text-xs rounded-lg shadow-sm cursor-pointer transition-colors whitespace-nowrap"
                            >
                              Thu nợ đơn
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400 font-medium inline-flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-md whitespace-nowrap">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              Đã thu đủ
                            </span>
                          )}
                          <button
                            onClick={() => openEditOrder(order)}
                            className="p-1.5 bg-blue-55 hover:bg-blue-105 text-blue-605 rounded-lg border border-blue-200 transition-colors cursor-pointer flex items-center justify-center"
                            title="Sửa trực tiếp đơn hàng"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lịch sử thu tiền (Nhật ký thanh toán) */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden animate-fade-in mt-6 text-slate-700">
          <div className="px-6 py-4.5 border-b border-slate-100 bg-slate-50/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
              <h3 className="font-bold text-slate-800">Lịch sử thu tiền (Nhật ký thanh toán)</h3>
            </div>
            {(() => {
              const paymentsList = StorageManager.getPaymentHistory().filter(
                p => p.customerName === currentCustomer.name && p.type === currentCustomer.type
              );
              return (
                <span className="text-[11px] font-semibold text-slate-400">
                  Tổng cộng {paymentsList.length} giao dịch
                </span>
              );
            })()}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-4 px-6">Ngày thu</th>
                  <th className="py-4 px-6 text-right">Số tiền</th>
                  <th className="py-4 px-6">Phương thức / Ghi chú</th>
                  <th className="py-4 px-6 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {(() => {
                  const paymentsList = StorageManager.getPaymentHistory().filter(
                    p => p.customerName === currentCustomer.name && p.type === currentCustomer.type
                  );

                  if (paymentsList.length === 0) {
                    return (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-slate-400 font-medium">
                          Chưa có lịch sử thu tiền nào được ghi nhận cho khách hàng này.
                        </td>
                      </tr>
                    );
                  }

                  return paymentsList.map((pay) => (
                    <tr key={pay.id} className="hover:bg-slate-50/40 transition-colors text-slate-650">
                      <td className="py-4 px-6 font-medium text-slate-550">
                        {new Date(pay.createdAt).toLocaleDateString('vi-VN')} {new Date(pay.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-4 px-6 text-right font-mono font-bold text-emerald-650">
                        {formatCurrency(pay.amount)}
                      </td>
                      <td className="py-4 px-6 text-slate-600 font-semibold text-xs">
                        {pay.paymentMethod || 'Mặc định'}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Bạn có chắc chắn muốn XÓA và HOÀN TÁC giao dịch thu tiền ${formatCurrency(pay.amount)} này? Lúc này hệ thống sẽ tự động tính toán lại công nợ FIFO từ đầu cho khách.`)) {
                              if (onUndoPayment) {
                                onUndoPayment(pay.id, pay.customerName, pay.type);
                                showToast(`Đã hủy giao dịch thu nợ và tự động phân bổ lại FIFO thành công!`, 'success');
                              } else {
                                showToast(`Không thiết lập hàm hoàn tác ở máy chủ.`, 'error');
                              }
                            }
                          }}
                          className="px-2.5 py-1 text-xs font-bold bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200/50 rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Hủy / Hoàn tác</span>
                        </button>
                      </td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Lightbox Zoom Preview Modal for images */}
        {activePreviewImage && (
          <div 
            className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setActivePreviewImage(null)}
          >
            <div className="relative max-w-4xl max-h-[90vh] overflow-hidden flex flex-col items-center">
              <button
                onClick={() => setActivePreviewImage(null)}
                className="absolute top-4 right-4 bg-white/20 hover:bg-white/40 text-white w-10 h-10 rounded-full flex items-center justify-center font-bold text-xl transition-all cursor-pointer shadow z-50 hover:scale-105"
              >
                &times;
              </button>
              <img
                src={activePreviewImage}
                alt="Zoom Design Preview"
                className="max-w-full max-h-[80vh] object-contain rounded-2xl border border-white/15 shadow-2xl animate-scale-in"
                referrerPolicy="no-referrer"
                onClick={(e) => e.stopPropagation()}
              />
              <div className="mt-4 bg-slate-900/95 text-white border border-slate-800 px-4 py-2 rounded-xl text-xs font-semibold shadow" onClick={(e) => e.stopPropagation()}>
                Bấm ra ngoài nền đen hoặc dấu X để ẩn ảnh mẫu
              </div>
            </div>
          </div>
        )}

        {/* Render Order-specific payment modal if triggered */}
        {renderOrderPaymentModal()}
      </div>
    );
  };

  // STANDARD SUMMARY CUSTOMERS LIST VIEW
  return (
    <div className="space-y-6 animate-fade-in text-slate-700">
      {selectedCustomer && currentCustomer ? renderDetailView() : (
        <>
          {/* Category Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('dtf')}
          className={`px-5 py-3 font-bold text-sm tracking-wide border-b-2 cursor-pointer transition-colors ${
            activeTab === 'dtf'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Khách hàng In Pet DTF
        </button>
        <button
          onClick={() => setActiveTab('tshirt')}
          className={`px-5 py-3 font-bold text-sm tracking-wide border-b-2 cursor-pointer transition-colors ${
            activeTab === 'tshirt'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          Khách hàng Áo thun
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:max-w-md">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
            <Search className="w-5 h-5" />
          </span>
          <input
            type="text"
            placeholder={`Tìm kiếm tên khách nợ ${activeTabLabel}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm shadow-sm font-semibold"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs bg-slate-100 px-3.5 py-2 rounded-xl text-slate-500 font-medium">
          <Sparkles className="w-3.5 h-3.5 text-blue-600" />
          <span>Bấm trực tiếp vào tên khách hàng để mở Sổ Cái chi tiết</span>
        </div>
      </div>

      {/* KPI Cards for Debt */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-gradient-to-tr from-slate-900 to-slate-950 p-5 rounded-2xl border border-slate-800 text-white shadow-md">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Phân loại nợ theo mảng</span>
          <span className="block text-lg font-bold mt-1 text-blue-400">{activeTabLabel}</span>
          <span className="block text-2xl font-black mt-3 text-slate-100 font-mono">
            {formatCurrency(filtered.reduce((acc, curr) => acc + curr.debtAmount, 0))}
          </span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Số lượng khách cần đối soát</span>
          <span className="block text-2xl font-black mt-3 text-slate-800">
            {filtered.filter(c => c.debtAmount > 0).length} nhà in/xưởng
          </span>
          <span className="text-xs text-rose-500 font-semibold block mt-1">● Đang có dư nợ chậm thanh quyết toán</span>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex flex-col justify-between md:col-span-2 lg:col-span-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tỷ lệ thu hồi nợ thành công</span>
          <div className="flex items-center gap-3 mt-4">
            {(() => {
              const spent = filtered.reduce((acc, curr) => acc + curr.totalSpent, 0);
              const paid = filtered.reduce((acc, curr) => acc + curr.paidAmount, 0);
              const pct = spent > 0 ? (paid / spent) * 100 : 0;
              return (
                <>
                  <span className="text-2xl font-black text-slate-800 font-mono">{pct.toFixed(0)}%</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3 max-w-[124px] overflow-hidden">
                    <div className="bg-emerald-500 h-3 rounded-full" style={{ width: `${pct}%` }}></div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Debt Table List */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-4 px-6">Tên khách hàng</th>
                <th className="py-4 px-6 text-center">Số đơn chưa thanh toán hết</th>
                <th className="py-4 px-6 text-right">Tổng số tiền đang nợ</th>
                <th className="py-4 px-6 text-center">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-slate-400 font-medium">
                    Không tìm thấy dữ liệu khách nợ nào trong danh sách
                  </td>
                </tr>
              ) : (
                filtered.map((customer) => {
                  const unpaidCount = countUnpaidOrders(customer.name, customer.type);
                  return (
                    <tr 
                      key={customer.id} 
                      onClick={() => setSelectedCustomer(customer)}
                      className="hover:bg-slate-50/60 transition-colors cursor-pointer group"
                    >
                      <td className="py-4.5 px-6">
                        <div className="font-bold text-slate-850 group-hover:text-blue-600 transition-colors text-[15px] flex items-center gap-2">
                          <span>{customer.name}</span>
                          {customer.debtAmount > 0 && (
                            <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse" />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">Bấm để xem sổ công nợ chi tiết</div>
                      </td>
                      <td className="py-4.5 px-6 text-center">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold leading-none ${
                          unpaidCount > 0 
                            ? 'bg-rose-50 text-rose-700 border border-rose-100/50' 
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-100/50'
                        }`}>
                          {unpaidCount > 0 ? `${unpaidCount} đơn chưa trả` : 'Đã thanh toán hết'}
                        </span>
                      </td>
                      <td className="py-4.5 px-6 text-right font-mono font-extrabold text-base">
                        {customer.debtAmount > 0 ? (
                          <span className="text-rose-600 bg-rose-50/50 px-3.5 py-1.5 rounded-xl border border-rose-100/30">
                            {formatCurrency(customer.debtAmount)}
                          </span>
                        ) : (
                          <span className="text-emerald-600 bg-emerald-50/30 px-3.5 py-1.5 rounded-xl">
                            {formatCurrency(0)}
                          </span>
                        )}
                      </td>
                      <td className="py-4.5 px-6 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCustomer(customer);
                            }}
                            className="px-3 py-1.5 bg-slate-50 text-slate-600 hover:bg-blue-50 hover:text-blue-600 border border-slate-200 hover:border-blue-200 text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-all flex items-center gap-1"
                          >
                            <span>Xem sổ</span>
                            <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                          </button>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditCustomer(customer);
                            }}
                            className="px-3 py-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200 text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-all flex items-center gap-1"
                            title="Sửa nhanh thông tin công nợ khách hàng"
                          >
                            <Edit className="w-3.5 h-3.5" />
                            <span>Sửa</span>
                          </button>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingCustomer(customer);
                            }}
                            className="px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 border border-rose-200 text-xs font-bold rounded-xl shadow-xs cursor-pointer transition-all flex items-center gap-1"
                            title="Xóa thông tin công nợ khách hàng"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Box Cấu hình Trạng thái hệ thống */}
      <div className="bg-white border border-slate-100 p-6 rounded-2xl shadow-sm font-sans max-w-xl mx-auto">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center font-bold">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-wide">Trạng thái hệ thống</h3>
              <p className="text-xs text-slate-400 font-medium">Kết nối cơ sở dữ liệu thời gian thực</p>
            </div>
          </div>

          <button
            onClick={handleSyncSupabase}
            disabled={isSyncing}
            className={`px-4 py-2 rounded-xl text-xs font-bold tracking-wide transition-all uppercase flex items-center gap-2 cursor-pointer text-white shadow-sm hover:shadow-md ${
              isSyncing ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {isSyncing ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Đang đồng bộ...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
                </svg>
                <span>Đồng bộ ngay</span>
              </>
            )}
          </button>
        </div>

        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium">Nền tảng lưu trữ:</span>
            <span className="font-bold text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded">Supabase Cloud Postgres</span>
          </div>
          <div className="flex justify-between items-center text-xs">
            <span className="text-slate-500 font-medium">Trạng thái đồng bộ:</span>
            <span className="font-bold text-emerald-600 flex items-center gap-1.5 bg-emerald-50 px-2.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse text-xs"></span>
              Thời gian thực (Real-time)
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-4 italic text-center leading-relaxed">
          * Hệ thống đã tự động cấu hình và đồng bộ hóa, không cần can thiệp bằng lệnh SQL thủ công.
        </p>
      </div>

      </>
      )}

      {/* Render Settle Debt modals */}
      {renderPaymentModal()}

      {/* Edit Customer Modal */}
      {editingCustomer && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in text-slate-700">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-blue-900 text-white">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Edit className="w-5 h-5 text-blue-200" />
                <span>Chỉnh sửa thông tin công nợ</span>
              </h3>
              <button
                onClick={() => setEditingCustomer(null)}
                className="text-white/80 hover:text-white cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleEditCustomerSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">
                  Tên Khách Hàng
                </label>
                <input
                  type="text"
                  required
                  value={editCustName}
                  onChange={(e) => setEditCustName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold text-slate-800"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">
                    Tổng tiền hàng sỉ (VND)
                  </label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editCustTotalSpent}
                    onChange={(e) => setEditCustTotalSpent(Math.max(0, Number(e.target.value)))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-slate-800"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Cập nhật tổng chi tiêu
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">
                    Đã thanh toán (VND)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={editCustTotalSpent}
                    required
                    value={editCustTotalPaid}
                    onChange={(e) => setEditCustTotalPaid(Math.min(editCustTotalSpent, Math.max(0, Number(e.target.value))))}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-emerald-700 focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 block mt-1">
                    Phân bổ từ cũ đến mới
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 font-sans">
                  Số dư nợ còn lại trực tiếp (VND)
                </label>
                <div className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl font-mono text-sm font-bold text-rose-600 font-sans">
                  {formatCurrency(Math.max(0, editCustTotalSpent - editCustTotalPaid))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"></span>
                  <span>Mã bảo mật (PIN Code)</span>
                </label>
                <input
                  type="text"
                  maxLength={10}
                  placeholder="Để trống nếu không khóa. Khuyên dùng: 4-6 số cuối ĐT"
                  value={editCustPinCode}
                  onChange={(e) => setEditCustPinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-bold text-slate-800 placeholder:text-slate-400 placeholder:font-normal"
                />
                <span className="text-[10px] text-slate-400 block mt-1">
                  Khóa trang tra cứu công nợ ngoại quan công khai của khách hàng này.
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingCustomer(null)}
                  className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl cursor-pointer"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Customer Confirmation Dialog */}
      {deletingCustomer && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in text-slate-700">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-rose-100 flex items-center justify-between bg-rose-600 text-white">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-200" />
                <span>Xóa thông tin công nợ khách hàng</span>
              </h3>
              <button
                onClick={() => setDeletingCustomer(null)}
                className="text-white hover:text-rose-100 cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm font-semibold text-slate-750">
                Bạn có chắc chắn muốn xóa toàn bộ thông tin công nợ & lịch sử mua bán của khách hàng này không?
              </p>
              <div className="p-4 bg-rose-50 border border-rose-105 rounded-xl text-xs space-y-1.5 text-slate-850">
                <div className="flex justify-between">
                  <span>Khách hàng:</span>
                  <span className="font-extrabold text-slate-900">{deletingCustomer.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Mảng kinh doanh:</span>
                  <span className="font-bold text-blue-600">
                    {deletingCustomer.type === 'dtf' ? 'In Pet DTF' : 'Áo thun Kho'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Tổng nợ hiện tại:</span>
                  <span className="font-bold text-rose-600 font-mono">
                    {formatCurrency(deletingCustomer.debtAmount)}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 italic">
                Lưu ý: Xóa khách hàng này sẽ xóa tất cả các đơn hàng liên quan của họ trong cơ sở dữ liệu Supabase.
              </p>
            </div>

            <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 text-sm font-sans">
              <button
                type="button"
                onClick={() => setDeletingCustomer(null)}
                className="px-4 py-2 hover:bg-slate-200 text-slate-500 font-semibold rounded-xl cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleDeleteCustomerConfirm}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl cursor-pointer"
              >
                Đồng ý xóa dữ liệu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editingOrder && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in text-slate-700">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-blue-900 text-white">
              <h3 className="font-bold text-lg">Chỉnh Sửa Chi Tiết Đơn Hàng</h3>
              <button
                onClick={() => setEditingOrder(null)}
                className="text-white/80 hover:text-white cursor-pointer text-xl"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleEditOrderSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Tên Khách Hàng</label>
                <input
                  type="text"
                  required
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-sm font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Mã đơn hàng</label>
                  <input
                    type="text"
                    disabled
                    value={editingOrder.orderCode}
                    className="w-full px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm font-semibold text-slate-400 cursor-not-allowed font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Ngày ghi sổ (Tạo đơn)</label>
                  <input
                    type="date"
                    required
                    value={editCreatedAt}
                    onChange={(e) => setEditCreatedAt(e.target.value)}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Số lượng / Số mét</label>
                  <input
                    type="text"
                    required
                    value={editQtyStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditQtyStr(val);
                      const parsedQty = parseFloat(val);
                      if (!isNaN(parsedQty) && parsedQty >= 0) {
                        setEditQuantity(parsedQty);
                        
                        // Recalculate totalPrice if unit price is valid
                        const currentUnitPrice = parseFloat(editUnitPriceStr) || 0;
                        const newTotal = Number((parsedQty * currentUnitPrice).toFixed(0));
                        setEditTotalPrice(newTotal);
                        setEditTotalPriceStr(String(newTotal));
                        
                        const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                        if (parsedPaid > newTotal) {
                          setEditPaidAmount(newTotal);
                          setEditPaidAmountStr(String(newTotal));
                        }
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Đơn Giá (VND)</label>
                  <input
                    type="text"
                    required
                    value={editUnitPriceStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditUnitPriceStr(val);
                      const parsedPrice = parseFloat(val);
                      if (!isNaN(parsedPrice) && parsedPrice >= 0) {
                        setEditUnitPrice(parsedPrice);
                        
                        // Recalculate totalPrice if quantity is valid
                        const currentQty = parseFloat(editQtyStr) || 0;
                        const newTotal = Number((currentQty * parsedPrice).toFixed(0));
                        setEditTotalPrice(newTotal);
                        setEditTotalPriceStr(String(newTotal));
                        
                        const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                        if (parsedPaid > newTotal) {
                          setEditPaidAmount(newTotal);
                          setEditPaidAmountStr(String(newTotal));
                        }
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Tổng Tiền (VND)</label>
                  <input
                    type="text"
                    required
                    value={editTotalPriceStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditTotalPriceStr(val);
                      const parsedTotal = parseFloat(val);
                      if (!isNaN(parsedTotal) && parsedTotal >= 0) {
                        setEditTotalPrice(parsedTotal);
                        
                        const parsedPaid = parseFloat(editPaidAmountStr) || 0;
                        if (parsedPaid > parsedTotal) {
                          setEditPaidAmount(parsedTotal);
                          setEditPaidAmountStr(String(parsedTotal));
                        }
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Đã Thanh Toán (VND)</label>
                  <input
                    type="text"
                    required
                    value={editPaidAmountStr}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditPaidAmountStr(val);
                      const parsedPaid = parseFloat(val);
                      if (!isNaN(parsedPaid) && parsedPaid >= 0) {
                        setEditPaidAmount(parsedPaid);
                      }
                    }}
                    className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-emerald-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Trạng thái đơn hàng</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as any)}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="pending">Đang công nợ (Pending)</option>
                  <option value="completed">Đã thu đủ (Completed)</option>
                  <option value="cancelled">Đã hủy bỏ (Cancelled)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5 font-sans">Ghi chú đơn hàng (Thay thế mã đơn hàng)</label>
                <textarea
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Nhập ghi chú riêng của đơn này (Ví dụ: Ship xe đò, Ủi nhãn mác, v.v.)"
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingOrder(null)}
                  className="px-4 py-2 hover:bg-slate-100 text-slate-500 font-semibold text-sm rounded-xl cursor-pointer"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl cursor-pointer"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-[200] max-w-sm bg-slate-900 border border-slate-700 text-white rounded-xl shadow-2xl p-4 flex items-center gap-3 animate-fade-in font-sans">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
            toastType === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
            toastType === 'error' ? 'bg-rose-500/20 text-rose-400' :
            'bg-blue-500/20 text-blue-400'
          }`}>
            {toastType === 'error' ? (
              <Ban className="w-5 h-5 text-rose-500" />
            ) : (
              <CheckCircle className="w-5 h-5 text-emerald-500" />
            )}
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold leading-tight">{toastMessage}</p>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-white font-bold text-sm cursor-pointer"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}
