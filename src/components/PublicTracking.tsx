import React, { useState, useEffect } from 'react';
import { Customer, Order } from '../types';
import { StorageManager, supabase } from '../lib/storage';
import { formatCurrency } from '../utils/pdfGenerator';
import { 
  ShieldAlert, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Coins, 
  TrendingDown, 
  Phone, 
  ShoppingBag, 
  Sparkles,
  Info,
  X,
  Lock,
  Download,
  ExternalLink,
  RotateCw,
  Image as ImageIcon
} from 'lucide-react';

const getOrderImagesArray = (item: any): string[] => {
  if (!item) return [];
  if (Array.isArray(item)) return item.filter(Boolean);
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter(Boolean);
        }
      } catch (e) {
        // Not a JSON Array
      }
    }
    return [trimmed].filter(Boolean);
  }
  return [];
};

interface PublicTrackingProps {
  trackingId: string;
}

export default function PublicTracking({ trackingId }: PublicTrackingProps) {
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  const setSortedOrders = (rawOrders: Order[]) => {
    const parseOrderDate = (dateVal: any): Date => {
      if (!dateVal) return new Date(0);
      if (dateVal instanceof Date) return dateVal;
      
      const dateStr = String(dateVal).trim();
      
      // Match DD/MM/YYYY or D/M/YYYY formats
      const vRegex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/;
      const match = dateStr.match(vRegex);
      if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const year = parseInt(match[3], 10);
        const timePart = dateStr.slice(match[0].length).trim();
        if (timePart) {
          const timeMatch = timePart.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const mins = parseInt(timeMatch[2], 10);
            const secs = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
            return new Date(year, month, day, hours, mins, secs);
          }
        }
        return new Date(year, month, day);
      }
      
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? new Date(0) : parsed;
    };

    const sorted = [...rawOrders].sort((a, b) => {
      const dateA = parseOrderDate(a.createdAt || (a as any).date);
      const dateB = parseOrderDate(b.createdAt || (b as any).date);
      return dateB.getTime() - dateA.getTime();
    });
    setOrders(sorted);
  };

  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [lightboxZoom, setLightboxZoom] = useState<number>(1);
  const [lightboxRendering, setLightboxRendering] = useState<'smooth' | 'crisp'>('crisp');
  const [lightboxRotate, setLightboxRotate] = useState<number>(0);

  // Secure PIN Code feature states
  const [hasPinCode, setHasPinCode] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Sync live data from Supabase first so anonymous devices have the latest context
        await StorageManager.syncAllDataFromSupabase();
      } catch (err) {
        console.warn('Failed to sync live data:', err);
      }
      
      const cust = StorageManager.getCustomerByTrackingId(trackingId);
      if (cust) {
        setCustomer(cust);
        
        let pinCodeValue: string | null = cust.pinCode || null;
        if (StorageManager.getIsSupabaseActive()) {
          try {
            const customerId = `c_${cust.type}_` + btoa(encodeURIComponent(cust.name)).replace(/=/g, '');
            const { data } = await supabase
              .from('customers')
              .select('pin_code')
              .eq('id', customerId)
              .maybeSingle();
            if (data && data.pin_code !== undefined) {
              pinCodeValue = data.pin_code;
            }
          } catch (e) {
            console.warn('Failed to get PIN from remote DB:', e);
          }
        }

        if (pinCodeValue) {
          setHasPinCode(true);
          const sessionAuthKey = 'tracking_auth_' + trackingId;
          const isAuthedInSession = sessionStorage.getItem(sessionAuthKey) === 'true';
          if (isAuthedInSession) {
            setIsVerified(true);
            const custOrders = StorageManager.getOrdersForCustomer(cust.name, cust.type);
            setSortedOrders(custOrders);
          } else {
            setIsVerified(false);
            setOrders([]); // Security: Ensure orders are completely empty until PIN matches
          }
        } else {
          setHasPinCode(false);
          setIsVerified(true);
          const custOrders = StorageManager.getOrdersForCustomer(cust.name, cust.type);
          setSortedOrders(custOrders);
        }
      }
      setLoading(false);
    }
    loadData();
  }, [trackingId]);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer) return;

    setVerifying(true);
    setPinError(null);

    const enteredPin = pinInput.trim();
    if (!enteredPin) {
      setPinError('Vui lòng nhập mã bảo mật.');
      setVerifying(false);
      return;
    }

    let correctPin: string | null = customer.pinCode || null;
    if (StorageManager.getIsSupabaseActive()) {
      try {
        const customerId = `c_${customer.type}_` + btoa(encodeURIComponent(customer.name)).replace(/=/g, '');
        const { data } = await supabase
          .from('customers')
          .select('pin_code')
          .eq('id', customerId)
          .maybeSingle();
        if (data && data.pin_code !== undefined) {
          correctPin = data.pin_code;
        }
      } catch (err) {
        console.error('DB error during PIN check:', err);
      }
    }

    if (correctPin === enteredPin) {
      const sessionAuthKey = 'tracking_auth_' + trackingId;
      sessionStorage.setItem(sessionAuthKey, 'true');
      setIsVerified(true);

      const custOrders = StorageManager.getOrdersForCustomer(customer.name, customer.type);
      setSortedOrders(custOrders);
    } else {
      setPinError('Mã bảo mật không chính xác. Vui lòng nhập lại.');
    }
    setVerifying(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-xs font-mono text-slate-400">Đang tải thông tin sổ nợ...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6 font-sans">
        <div className="bg-slate-800 border border-slate-700/60 p-8 rounded-2xl max-w-md text-center shadow-2xl space-y-4">
          <div className="w-16 h-16 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mx-auto border border-rose-500/20">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold tracking-tight text-white">Liên kết không khả dụng</h2>
          <p className="text-xs text-slate-400 leading-relaxed font-sans">
            Đường link tra cứu công nợ này không tồn tại hoặc đã hết hạn. Hãy liên hệ với Quản lý xưởng in để nhận liên kết tra cứu mới nhất qua Zalo.
          </p>
          <div className="pt-2">
            <a 
              href="/"
              className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-lg shadow-blue-500/10 text-white font-sans"
            >
              Về Trang Chủ Admin
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (customer && hasPinCode && !isVerified) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 font-sans select-none relative overflow-hidden">
        {/* Glow backgrounds */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl opacity-60 pointer-events-none" />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl opacity-40 pointer-events-none" />

        <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-md rounded-3xl border border-white/5 py-8 px-6 shadow-2xl relative overflow-hidden text-center space-y-6">
          {/* Logo details */}
          <div className="space-y-2">
            <div className="w-14 h-14 bg-blue-600/10 text-blue-500 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-blue-500/5">
              <Lock className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest font-mono">
                CỔNG TRA CỨU ĐỐI TÁC
              </span>
              <h2 className="text-lg font-black tracking-tight text-white mt-1 uppercase">
                XƯỞNG IN HOÀNG UYÊN
              </h2>
            </div>
          </div>

          <div className="space-y-1 bg-slate-100/5 p-4 rounded-xl border border-white/5">
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Yêu cầu bảo mật: Sổ công nợ của quý khách <strong className="text-white font-bold">{customer.name}</strong> đã được khóa bằng mã bảo mật.
            </p>
            <p className="text-[10px] text-slate-400 font-sans mt-1">
              Vui lòng nhập mã bảo mật để xem công nợ tài chính chi tiết.
            </p>
          </div>

          <form onSubmit={handleVerifyPin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 font-mono text-left">
                MÃ BẢO MẬT (PIN)
              </label>
              <input
                type="password"
                pattern="[a-zA-Z0-9]*"
                inputMode="numeric"
                maxLength={10}
                autoFocus
                placeholder="Nhập mã PIN..."
                value={pinInput}
                onChange={(e) => {
                  setPinError(null);
                  setPinInput(e.target.value.replace(/[^a-zA-Z0-9]/g, ''));
                }}
                className="w-full px-5 py-3.5 bg-slate-950 border border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-center font-mono text-lg font-bold tracking-widest text-white placeholder:text-slate-600 placeholder:text-sm placeholder:font-normal placeholder:tracking-normal"
              />
              {pinError && (
                <p className="text-rose-500 text-[11px] font-semibold mt-2.5 flex items-center justify-center gap-1.5 animate-bounce">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{pinError}</span>
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={verifying}
              className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-sm font-bold rounded-xl transition-all shadow-lg shadow-blue-500/10 text-white cursor-pointer select-none flex items-center justify-center gap-2"
            >
              {verifying ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>Xác nhận mở khóa</span>
              )}
            </button>
          </form>

          <div className="text-[10px] text-slate-500 font-mono leading-normal">
            * Nếu quý khách quên mã bảo vệ hoặc đổi mã PIN, vui lòng liên hệ trực tiếp với Xưởng in để được cập nhật.
          </div>
        </div>
      </div>
    );
  }

  // Derived calculations
  const totalDue = customer.debtAmount;
  const totalPaid = customer.paidAmount;
  const grandTotal = customer.totalSpent;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Decorative Branding Top Banner */}
      <span className="hidden">🚀 TRỰC TUYẾN</span>
      <header className="bg-slate-900/60 backdrop-blur-md border-b border-white/5 sticky top-0 z-40 px-5 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black shadow-md shadow-blue-500/10">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white leading-none">CỔNG TRA CỨU ĐỐI TÁC</h1>
              <span className="text-[9px] text-blue-400 font-bold uppercase tracking-wider font-mono">
                Xưởng In Hoàng Uyên
              </span>
            </div>
          </div>
          <div className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[9px] font-bold text-emerald-400 tracking-wider uppercase font-mono animate-pulse">
            Tài liệu số nợ Live
          </div>
        </div>
      </header>

      {/* Main Container tailored as Mobile-first responsive scroll container */}
      <main className="flex-1 max-w-md w-full mx-auto px-4 py-6 space-y-6">
        {/* Customer Branding Card */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-850 p-5 rounded-2xl border border-white/5 shadow-xl space-y-1.5 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl" />
          <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider font-mono">Đối tác lâu năm</span>
          <h2 className="text-xl font-extrabold text-white tracking-tight">{customer.name}</h2>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="px-2 py-0.5 bg-slate-800 rounded-md font-bold text-slate-300">
              {customer.type === 'dtf' ? 'Mảng: In Pet DTF' : 'Mảng: Kho Áo Sỉ'}
            </span>
            <span>•</span>
            <span className="font-mono text-[10px]">Cập nhật {new Date(customer.updatedAt).toLocaleDateString('vi-VN')}</span>
          </div>
        </div>

        {/* Highlight Card: TỔNG SỐ TIỀN CÒN NỢ */}
        <div className="bg-rose-500/90 hover:bg-rose-500/95 duration-200 text-white rounded-2xl shadow-xl p-6 relative overflow-hidden flex flex-col border border-rose-400/10">
          <div className="absolute top-0 right-0 p-5 opacity-10">
            <TrendingDown className="w-24 h-24" />
          </div>
          <span className="text-white/80 text-[11px] font-extrabold uppercase tracking-widest font-mono">
            TỔNG SỐ TIỀN CÒN NỢ HIỆN TẠI
          </span>
          <h3 className="text-3xl font-black mt-1 font-mono tracking-tight filter drop-shadow-sm">
            {formatCurrency(totalDue)}
          </h3>
          <p className="text-white/70 text-[10px] italic mt-2.5 font-sans leading-relaxed">
            * Quy khách vui lòng kiểm tra và hoàn thành đối soát định kỳ. Quét Zalo / thanh toán ngân hàng trực tiếp.
          </p>
        </div>

        {/* Debt Progress Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-900 border border-white/5 rounded-xl p-4 flex flex-col">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider font-mono">Tổng tiền hàng sỉ</span>
            <span className="text-base font-bold text-white mt-1 font-mono">{formatCurrency(grandTotal)}</span>
          </div>
          <div className="bg-slate-900 border border-white/5 rounded-xl p-4 flex flex-col">
            <span className="text-[10px] text-slate-300 font-bold uppercase tracking-wider font-mono">Đã thanh toán</span>
            <span className="text-base font-bold text-emerald-400 mt-1 font-mono">{formatCurrency(totalPaid)}</span>
          </div>
        </div>

        {/* Timeline of Orders (Sổ nợ chi tiết) */}
        <div className="space-y-3.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 font-sans">
              <ShoppingBag className="w-3.5 h-3.5 text-blue-500" />
              <span>Sổ Chi Tiết Mua Bán</span>
            </h4>
            <span className="text-[10px] font-mono text-slate-500 font-semibold">{orders.length} Đơn hàng</span>
          </div>

          <div className="space-y-3 font-sans">
            {orders.length === 0 ? (
              <div className="py-12 bg-slate-900 border border-white/5 rounded-2xl text-center text-xs text-slate-400">
                Không tìm thấy đơn hàng nào có công nợ.
              </div>
            ) : (
              orders.map((order) => {
                const orderDebt = order.debtAmount;
                const orderPaid = order.paidAmount;
                return (
                  <div 
                    key={order.id}
                    className="bg-slate-900 border border-white/5 rounded-xl p-4.5 shadow-sm space-y-3 hover:border-white/10 transition-colors"
                  >
                    {/* Header: Date + Status */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 font-mono">
                        <Calendar className="w-3.5 h-3.5 text-slate-500" />
                        <span>{new Date(order.createdAt).toLocaleDateString('vi-VN')}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {orderDebt === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[9px] font-bold text-emerald-400">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Đã thu đủ</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded-full text-[9px] font-bold text-amber-400">
                            <Clock className="w-3 h-3" />
                            <span>Còn nợ</span>
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-md font-mono text-[9px]">
                          {order.notes || order.orderCode}
                        </span>
                      </div>
                    </div>

                    {/* Product Name Details */}
                    <div className="space-y-3">
                      <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider mb-1">Sản phẩm chi tiết</span>
                      
                      {order.items && order.items.length > 0 ? (
                        <div className="space-y-2">
                          {order.items.map((item, idx) => {
                            const imgArray = getOrderImagesArray(item.image);
                            const displayImg = imgArray.length > 0 ? imgArray[0] : null;

                            return (
                              <div key={item.id || idx} className="flex gap-3 bg-slate-950/40 p-3 rounded-xl border border-white/5 items-center">
                                {/* Nice thumbnail with rounded corners - Zoom clickable */}
                                <div 
                                  className={`w-14 h-14 rounded-lg bg-slate-800 border border-slate-700/65 overflow-hidden flex-shrink-0 flex items-center justify-center transition-all ${
                                    displayImg ? 'cursor-zoom-in hover:brightness-110 hover:border-blue-500/50 active:scale-95' : ''
                                  }`}
                                  onClick={() => displayImg && setSelectedImage(displayImg)}
                                  title={displayImg ? "Bấm để xem ảnh lớn" : undefined}
                                >
                                  {displayImg ? (
                                    <img 
                                      src={displayImg} 
                                      alt={item.productName} 
                                      className="w-full h-full object-cover" 
                                      referrerPolicy="no-referrer"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                        const parent = e.currentTarget.parentElement;
                                        if (parent) {
                                          const fallback = document.createElement('span');
                                          fallback.className = 'text-slate-500 text-[10px] uppercase font-bold text-center p-1';
                                          fallback.innerText = 'LỖI ẢNH';
                                          parent.appendChild(fallback);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <ShoppingBag className="w-5 h-5 text-slate-500" />
                                  )}
                                </div>

                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-extrabold text-white leading-tight mb-1">
                                    {item.productName}
                                  </p>
                                  
                                  {item.color && item.color.toLowerCase().includes('độ dài') ? (
                                    <div className="space-y-1">
                                      <div className="text-xs sm:text-sm font-bold text-blue-300 bg-blue-500/10 border border-blue-500/25 rounded-md px-2 py-0.5 leading-normal inline-block select-all">
                                        {item.color}
                                      </div>
                                      <div className="text-xs text-slate-400 font-mono font-semibold">
                                        Số lượng: <span className="text-white text-xs sm:text-sm font-bold font-sans">{item.quantity}</span>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
                                      {item.color && (
                                        <span className="bg-slate-800 px-2 py-0.5 rounded font-sans leading-normal">
                                          Màu: {item.color}
                                        </span>
                                      )}
                                      {item.size && (
                                        <span className="bg-slate-800 px-2 py-0.5 rounded font-sans uppercase font-bold text-blue-400">
                                          Size: {item.size}
                                        </span>
                                      )}
                                      <span className="text-slate-400 font-mono font-bold bg-slate-950 px-2 py-0.5 rounded">
                                        x{item.quantity}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="text-right text-xs font-mono font-bold text-slate-300">
                                  {formatCurrency(item.totalPrice)}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex gap-3 bg-slate-950/40 p-3 rounded-xl border border-white/5 items-center">
                          {/* Fallback image check for general order */}
                          {(() => {
                            const orderImgs = getOrderImagesArray(order.orderImages);
                            const displayImg = orderImgs.length > 0 ? orderImgs[0] : null;
                            return (
                              <div 
                                className={`w-14 h-14 rounded-lg bg-slate-800 border border-slate-700/65 overflow-hidden flex-shrink-0 flex items-center justify-center transition-all ${
                                  displayImg ? 'cursor-zoom-in hover:brightness-110 hover:border-blue-500/50 active:scale-95' : ''
                                }`}
                                onClick={() => displayImg && setSelectedImage(displayImg)}
                                title={displayImg ? "Bấm để xem ảnh lớn" : undefined}
                              >
                                {displayImg ? (
                                  <img 
                                    src={displayImg} 
                                    alt={order.productName} 
                                    className="w-full h-full object-cover" 
                                    referrerPolicy="no-referrer"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      const parent = e.currentTarget.parentElement;
                                      if (parent) {
                                        const fallback = document.createElement('span');
                                        fallback.className = 'text-slate-500 text-[10px] uppercase font-bold text-center p-1';
                                        fallback.innerText = 'LỖI ẢNH';
                                        parent.appendChild(fallback);
                                      }
                                    }}
                                  />
                                ) : (
                                  <ShoppingBag className="w-5 h-5 text-slate-500" />
                                )}
                              </div>
                            );
                          })()}

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-extrabold text-white leading-tight mb-1">{order.productName}</p>
                            {order.color && (
                              <div className="mt-1.5">
                                {order.color.toLowerCase().includes('độ dài') ? (
                                  <div className="space-y-1">
                                    <span className="text-xs sm:text-sm font-bold text-blue-300 bg-blue-500/10 border border-blue-500/25 rounded-md px-2 py-0.5 inline-block leading-normal">
                                      {order.color}
                                    </span>
                                    <div className="text-xs text-slate-400 font-mono font-semibold">
                                      Số lượng: <span className="text-white text-xs sm:text-sm font-bold font-sans">{order.quantity}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-200 bg-slate-850 px-2.5 py-1 rounded-md border border-white/5 inline-block">
                                    Màu: {order.color} • SL: {order.quantity}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* If the order itself has extra images, render clickable tags/thumbnails */}
                      {(() => {
                        const extraImgs = getOrderImagesArray(order.orderImages);
                        if (extraImgs.length > 0) {
                          return (
                            <div className="flex flex-wrap gap-2 pt-1 font-sans">
                              {extraImgs.map((imgUrl, i) => (
                                <button 
                                  key={i} 
                                  type="button"
                                  onClick={() => setSelectedImage(imgUrl)}
                                  className="group relative flex items-center gap-1.5 text-[11px] text-blue-400 font-bold hover:text-blue-300 transition-all bg-blue-500/5 hover:bg-blue-500/10 border border-blue-500/10 rounded-lg px-2.5 py-1.5 cursor-zoom-in"
                                >
                                  <span>Ảnh thiết kế #{i + 1}</span>
                                  <span className="text-[9px] opacity-70 underline">(Xem cỡ lớn)</span>
                                </button>
                              ))}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>

                    {/* Bill Prices Breakdown */}
                    <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5 text-[11px] font-semibold font-mono">
                      <div>
                        <span className="text-[9px] text-slate-500 block uppercase tracking-wider mb-0.5">Giá Trị Đơn</span>
                        <span className="text-white font-bold">{formatCurrency(order.totalPrice)}</span>
                      </div>
                      <div>
                        <span className="text-[9px] text-emerald-500 block uppercase tracking-wider mb-0.5">Đã Thanh Toán</span>
                        <span className="text-emerald-400 font-bold">{formatCurrency(orderPaid)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-[9px] text-rose-500 block uppercase tracking-wider mb-0.5">Dư nợ</span>
                        <span className={orderDebt > 0 ? 'text-rose-400 font-extrabold text-sm' : 'text-slate-400'}>
                          {formatCurrency(orderDebt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Hotline support info */}
        <div className="bg-slate-900/50 p-4 border border-white/5 rounded-xl flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/10 text-blue-400 rounded-lg">
            <Phone className="w-4.5 h-4.5" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Hỗ Trợ & Đối Soát Nhầm Lẫn</p>
            <p className="text-xs font-bold text-white mt-0.5">Hotline: 0941727079 - 0931325512 (Zalo)</p>
          </div>
        </div>

        {/* Secure Disclaimer Footnote */}
        <div className="text-center space-y-1 py-4 text-slate-500 text-[10px] font-mono leading-relaxed px-4">
          <div className="flex items-center justify-center gap-1">
            <Info className="w-3.5 h-3.5 text-slate-600" />
            <span>Liên kết Live được bảo mật mã hóa AES-256</span>
          </div>
          <p>Bản quyền thuộc về Xưởng In Hoàng Uyên © 2026</p>
        </div>
      </main>

      {/* Modern High-Fidelity Lightbox Modal Overlay */}
      {selectedImage && (
        <div 
          className="fixed inset-0 bg-slate-950/95 backdrop-blur-md z-50 flex flex-col justify-between p-4 text-slate-200 select-none outline-none"
          onClick={() => {
            setSelectedImage(null);
            setLightboxZoom(1);
            setLightboxRotate(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
              setSelectedImage(null);
              setLightboxZoom(1);
              setLightboxRotate(0);
            }
          }}
          tabIndex={0}
        >
          {/* Lightbox Header */}
          <div 
            className="w-full flex items-center justify-between border-b border-slate-900 pb-3 h-14 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                <ImageIcon className="w-4.5 h-4.5 text-blue-400" />
              </div>
              <div className="text-left">
                <h4 className="font-extrabold text-white text-xs sm:text-sm uppercase tracking-wider flex items-center gap-2">
                  <span>Xem ảnh thiết kế gốc</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-0.5 rounded-full lowercase font-mono">100% uncompressed</span>
                </h4>
                <p className="text-[10px] text-slate-400">Hình ảnh thiết kế lưu trữ chất lượng tối đa, không bị nén dung lượng.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedImage(null);
                  setLightboxZoom(1);
                  setLightboxRotate(0);
                }}
                className="w-9 h-9 bg-slate-900 hover:bg-slate-800 active:scale-95 text-slate-300 rounded-xl flex items-center justify-center font-black text-lg transition-all cursor-pointer shadow border border-slate-800 hover:text-white"
                title="Đóng (Esc/X)"
              >
                &times;
              </button>
            </div>
          </div>

          {/* Interactive Zoom and Pan Workspace */}
          <div 
            className="flex-1 w-full my-3 overflow-auto flex items-center justify-center relative bg-slate-950/50 rounded-2xl border border-slate-900 shadow-inner group/workspace"
            onClick={() => {
              setSelectedImage(null);
              setLightboxZoom(1);
              setLightboxRotate(0);
            }}
          >
            <div 
              className="max-w-full max-h-full transition-transform duration-200"
              style={{
                transform: `rotate(${lightboxRotate}deg)`,
                width: 'fit-content',
                height: 'fit-content'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={selectedImage}
                alt="Ảnh phóng to"
                className="object-contain transition-all duration-155 rounded-lg max-w-[85vw] max-h-[70vh] shadow-2xl border border-white/5"
                style={{
                  transform: `scale(${lightboxZoom})`,
                  transformOrigin: 'center center',
                  imageRendering: lightboxRendering === 'crisp' ? 'pixelated' : 'auto',
                  maxWidth: lightboxZoom > 1 ? 'none' : '85vw',
                  maxHeight: lightboxZoom > 1 ? 'none' : '70vh',
                }}
                referrerPolicy="no-referrer"
              />
            </div>
          </div>

          {/* Controls Footer */}
          <div 
            className="w-full bg-slate-900 border border-slate-850 rounded-2xl p-4 md:px-6 flex flex-col md:flex-row items-center justify-between gap-4 flex-shrink-0 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Zoom Controls */}
            <div className="flex items-center gap-4.5 w-full md:w-auto">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest min-w-[64px]">Thu phóng:</span>
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl p-1.5 px-3">
                <button
                  type="button"
                  onClick={() => setLightboxZoom(prev => Math.max(0.5, prev - 0.25))}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer font-bold flex items-center justify-center transition-colors text-sm"
                  title="Thu nhỏ (-25%)"
                >
                  -
                </button>
                <span className="text-xs font-mono font-bold text-blue-400 min-w-[50px] text-center bg-slate-900 py-1 px-2.5 rounded-md border border-slate-800">
                  {Math.round(lightboxZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxZoom(prev => Math.min(4, prev + 0.25))}
                  className="w-7 h-7 bg-slate-800 hover:bg-slate-700 text-white rounded-lg cursor-pointer font-bold flex items-center justify-center transition-colors text-sm"
                  title="Phóng to (+25%)"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => setLightboxZoom(1)}
                  className="text-[10px] bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white px-2 py-1.5 rounded-md cursor-pointer transition-colors uppercase font-bold tracking-wide"
                  title="Về kích thước chuẩn ban đầu"
                >
                  Chuẩn
                </button>
              </div>
            </div>

            {/* Quality & Detail Toggles */}
            <div className="flex flex-wrap items-center gap-3.5 w-full md:w-auto">
              {/* Rotate Option */}
              <button
                type="button"
                onClick={() => setLightboxRotate(prev => (prev + 90) % 360)}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-755 border border-slate-700 text-slate-250 text-[11px] font-bold rounded-xl cursor-pointer transition-all hover:text-white inline-flex items-center gap-1.5"
                title="Xoay hình ảnh thêm 90 độ"
              >
                <RotateCw className="w-3.5 h-3.5 text-blue-400" />
                <span>Xoay 90°</span>
              </button>

              {/* Crisp Rendering Option */}
              <button
                type="button"
                onClick={() => setLightboxRendering(prev => prev === 'smooth' ? 'crisp' : 'smooth')}
                className={`px-3.5 py-2 border rounded-xl text-[11px] font-extrabold cursor-pointer transition-all inline-flex items-center gap-1.5 ${
                  lightboxRendering === 'crisp' 
                    ? 'bg-blue-600 border-blue-500 text-white shadow-md shadow-blue-500/10' 
                    : 'bg-slate-800 border-slate-705 text-slate-400 hover:text-white'
                }`}
                title="Bật tính năng này giúp hiển thị ảnh sắc nét đến từng điểm ảnh (không bị mờ bệt do trình duyệt tự làm mịn)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Chế độ: {lightboxRendering === 'crisp' ? 'Hiện Siêu Nét' : 'Làm mịn thường'}</span>
              </button>
            </div>

            {/* Download and Original File actions */}
            <div className="flex items-center gap-2.5 w-full md:w-auto">
              <a
                href={selectedImage}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 md:flex-none px-4 py-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-700 text-blue-400 text-center font-bold text-[11px] rounded-xl transition-all hover:text-white inline-flex items-center justify-center gap-1.5 uppercase tracking-wider"
                title="Mở ảnh trong một tab mới ở độ phân giải thật của file để kiểm duyệt"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Mở tab mới (100% Gốc)</span>
              </a>

              <button
                type="button"
                onClick={async () => {
                  try {
                    const response = await fetch(selectedImage);
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    // Try to guess extension or default to png
                    const extension = blob.type ? blob.type.split('/')[1] : 'png';
                    a.download = `file_thiet_ke_goc_${Date.now()}.${extension}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(url);
                  } catch (err) {
                    // Fallback to simple a href download
                    const a = document.createElement('a');
                    a.href = selectedImage;
                    a.download = `file_goc_${Date.now()}.png`;
                    a.target = '_blank';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }
                }}
                className="flex-1 md:flex-none px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:brightness-110 text-white font-extrabold text-[11px] rounded-xl transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-lg shadow-blue-500/10"
                title="Tải tập tin thiết kế gốc độ nét tuyệt đối về máy tính/điện thoại"
              >
                <Download className="w-4 h-4" />
                <span>Tải File Gốc (Full Size)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
