import { useState, useEffect } from 'react';
import { Product, Order, Customer, OrderType } from './types';
import { StorageManager, supabase } from './lib/storage';
import Login from './components/Login';
import PasswordRecovery from './components/PasswordRecovery';
import SalesManager from './components/SalesManager';
import DebtManager from './components/DebtManager';
import PublicTracking from './components/PublicTracking';
import TemporaryBillManager from './components/TemporaryBillManager';
import {
  ShieldCheck,
  TrendingUp,
  Boxes,
  Users2,
  Database,
  Coins,
  LogOut,
  User,
  Menu,
  X,
  AlertTriangle,
  Copy,
  Check
} from 'lucide-react';

// Owner-only database RLS is managed through reviewed migrations.
// Never give browser users a SQL snippet that grants anonymous CRUD privileges.

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [passwordSetupMode, setPasswordSetupMode] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    return ['recovery', 'invite'].includes(fragment.get('type') || '') ||
      fragment.has('error_code');
  });
  const [user, setUser] = useState('');
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  // Core records state
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Status flags
  const [isSupabaseOnline, setIsSupabaseOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dbMigrationNeeded, setDbMigrationNeeded] = useState(true);
  const [pendingOrderTick, setPendingOrderTick] = useState(0);
  const [syncingOutbox, setSyncingOutbox] = useState(false);
  useEffect(() => {
    const onPendingOrderChange = () => setPendingOrderTick(value => value + 1);
    window.addEventListener('order_sync_status', onPendingOrderChange);
    return () => window.removeEventListener('order_sync_status', onPendingOrderChange);
  }, []);
  void pendingOrderTick;

  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    const handleSyncError = () => {
      if (localStorage.getItem('supabase_migration_needed') === 'true') {
        setDbMigrationNeeded(true);
      }
    };
    const handleSyncSuccess = () => {
      setProducts(StorageManager.getProducts());
      setOrders(StorageManager.getOrders());
    };
    window.addEventListener('supabase_sync_error', handleSyncError);
    window.addEventListener('supabase_sync_success', handleSyncSuccess);
    return () => {
      window.removeEventListener('supabase_sync_error', handleSyncError);
      window.removeEventListener('supabase_sync_success', handleSyncSuccess);
    };
  }, []);

  // Parse tracking link on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idFromQuery = params.get('tracking_id') || params.get('tracking') || params.get('id');
    if (idFromQuery) {
      setTrackingId(idFromQuery);
      return;
    }
    const path = window.location.pathname;
    const hash = window.location.hash;
    const cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const cleanHash = hash.endsWith('/') ? hash.slice(0, -1) : hash;
    const match = cleanPath.match(/\/(?:tracking|cong-no|c)\/([^\/\?\#]+)/i) || 
                  cleanHash.match(/\/(?:tracking|cong-no|c)\/([^\/\?\#]+)/i);
    if (match) {
      setTrackingId(match[1]);
    }
  }, []);

  // An invite/recovery callback signs in temporarily so its password can be set.
  // Do not sign out that valid recovery session before PasswordRecovery consumes it.
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        if (!active || passwordSetupMode) return;
        if (!error && data.user?.email?.toLowerCase() === 'hoangkenlee@gmail.com') {
          setUser('hoanguyen');
          setIsLoggedIn(true);
        } else {
          setUser('');
          setIsLoggedIn(false);
          if (data.user) await supabase.auth.signOut();
        }
      } catch (error) {
        if (active && !passwordSetupMode) {
          setUser('');
          setIsLoggedIn(false);
          console.error('Owner session verification failed:', error);
        }
      }
    };
    void restore();

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordSetupMode(true);
        setIsLoggedIn(false);
        return;
      }
      if (event === 'SIGNED_OUT') {
        setIsLoggedIn(false);
        setUser('');
        setIsSupabaseOnline(false);
      }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [passwordSetupMode]);

  // 1. Load records only after the owner has authenticated.
  useEffect(() => {
    async function initData() {
      try {
        await StorageManager.initializeBackupAssets();
        if (StorageManager.isRestoreProtectionActive()) {
          setIsSupabaseOnline(false);
          setProducts(StorageManager.getProducts());
          setOrders(StorageManager.getOrders());
          return;
        }
        const isOnline = await StorageManager.checkSupabaseConnection();
        setIsSupabaseOnline(isOnline);

        if (isOnline) {
          await StorageManager.syncAllDataFromSupabase();
        }

        // Load products and orders
        const fetchedProducts = StorageManager.getProducts();
        const fetchedOrders = StorageManager.getOrders();

        setProducts(fetchedProducts);
        setOrders(fetchedOrders);
      } catch (err) {
        console.error('Lỗi khi thiết lập ứng dụng:', err);
      } finally {
        setLoading(false);
      }
    }
    if (isLoggedIn) void initData();
  }, [isLoggedIn]);

  // Derive customer records without mutating persisted data.
  useEffect(() => {
    setCustomers(StorageManager.getCustomers());
  }, [orders, products]);

  // 3. Listen to Realtime updates from Supabase to auto-sync cross-device actions
  useEffect(() => {
    if (isLoggedIn && isSupabaseOnline) {
      console.log('Initializing Supabase Realtime Listener...');
      const channel = supabase
        .channel('db_realtime_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public' },
          async (payload) => {
            console.log('Realtime change event received from Supabase:', payload);
            try {
              // Re-fetch all fresh records from database and update local storage/memory states
              await StorageManager.syncAllDataFromSupabase();
              setProducts(StorageManager.getProducts());
              setOrders(StorageManager.getOrders());
            } catch (e) {
              console.error('Realtime auto-sync error:', e);
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [isLoggedIn, isSupabaseOnline]);

  // Auth logins
  const handleLoginSuccess = (adminUser: string) => {
    setUser(adminUser);
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false);
    setUser('');
    setIsSupabaseOnline(false);
  };

  // --- ACTIONS ---
  const handleAddOrder = async (newOrder: Omit<Order, 'id' | 'orderCode'> & { createdAt?: string }) => {
    try {
      await StorageManager.addOrder(newOrder);
      // Reload orders and products (since products stock changes)
      setOrders(StorageManager.getOrders());
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể tạo đơn hàng mới, vui lòng kiểm tra lại cấu hình hoặc dữ liệu kết nối!");
      throw error;
    }
  };

  const handleRecordPayment = async (customerName: string, type: OrderType, amount: number, paymentMethod: string) => {
    try {
      await StorageManager.recordCustomerPayment(customerName, type, amount, paymentMethod);
      // Reload orders
      setOrders(StorageManager.getOrders());
    } catch (error) {
      alert("Lỗi: Không thể ghi nhận giao dịch thu tiền vào hệ thống!");
      throw error;
    }
  };

  const handleUndoPayment = async (paymentId: string, customerName: string, type: OrderType) => {
    try {
      await StorageManager.deletePaymentAndRecalculate(paymentId, customerName, type);
      // Reload ordersafter rollback
      setOrders(StorageManager.getOrders());
    } catch (error) {
      alert("Lỗi: Không thể hủy giao dịch thu tiền!");
      throw error;
    }
  };

  const handleRecordOrderPayment = async (orderId: string, amount: number) => {
    try {
      const result = await StorageManager.updateOrderPayment(orderId, amount);
      if (!result) throw new Error('Không tìm thấy đơn hàng cần gạch nợ.');
      setOrders(StorageManager.getOrders());
    } catch (error) {
      alert("Lỗi: Không thể lưu hóa đơn thanh toán vào hệ thống!");
      throw error;
    }
  };

  const handleUpdateOrder = async (id: string, updatedFields: Partial<Order>) => {
    try {
      await StorageManager.updateOrder(id, updatedFields);
      setOrders(StorageManager.getOrders());
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể lưu đơn hàng vào hệ thống, vui lòng thử lại!");
    }
  };

  const handleDeleteOrder = async (id: string) => {
    try {
      await StorageManager.deleteOrder(id);
      setOrders(StorageManager.getOrders());
      setProducts(StorageManager.getProducts());
    } catch (error) {
      throw error;
    }
  };

  const handleUpdateCustomer = async (oldName: string, type: OrderType, newName: string, newTotalSpent?: number, newTotalPaid?: number, newPinCode?: string | null) => {
    try {
      await StorageManager.updateCustomer(oldName, type, newName, newTotalSpent, newTotalPaid, newPinCode);
      setOrders(StorageManager.getOrders());
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể lưu khách hàng vào hệ thống!");
    }
  };

  const handleDeleteCustomer = async (customerName: string, type: OrderType) => {
    try {
      await StorageManager.deleteCustomer(customerName, type);
      setOrders(StorageManager.getOrders());
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể xóa khách hàng khỏi hệ thống!");
    }
  };


  let pendingOrderCount = 0;
  let pendingOrderStatusError = '';
  try {
    pendingOrderCount = StorageManager.getPendingOrderSyncCount();
  } catch (error) {
    pendingOrderStatusError = error instanceof Error ? error.message : String(error);
  }

  const retryOrderSync = async () => {
    if (syncingOutbox) return;
    setSyncingOutbox(true);
    try {
      if (!(await StorageManager.checkSupabaseConnection())) {
        throw new Error('Chưa xác thực hoặc mất kết nối Supabase.');
      }
      await StorageManager.flushPendingOrderSync();
      const refreshed = await StorageManager.syncAllDataFromSupabase();
      if (!refreshed) throw new Error('Không thể xác nhận đọc lại dữ liệu từ cloud.');
      setOrders(StorageManager.getOrders());
      setProducts(StorageManager.getProducts());
    } catch (error) {
      console.error('Unable to reconcile pending orders:', error);
      alert('Chưa thể xác nhận đồng bộ đơn hàng. KHÔNG ghi trùng. Kiểm tra kết nối và đối soát danh sách chờ.');
    } finally {
      setSyncingOutbox(false);
    }
  };

  const petOrders = orders.filter(order => order.type === 'dtf');
  const petCustomers = customers.filter(customer => customer.type === 'dtf');

  if (trackingId) {
    return <PublicTracking trackingId={trackingId} />;
  }

  if (passwordSetupMode) {
    return <PasswordRecovery onComplete={() => setPasswordSetupMode(false)} />;
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans selection:bg-blue-600 selection:text-white">
      {/* 1. Left Sidebar Navigation (Static & Fixed Desktop Menu) */}
      <aside className={`w-64 bg-slate-900 border-r border-slate-800 text-slate-300 flex flex-col fixed inset-y-0 left-0 z-50 transition-transform md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Core Branding Portal */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black shadow-md shadow-blue-500/10">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-white font-bold leading-none tracking-tight">Xưởng In PET</h2>
              <span className="text-[10px] text-slate-500 font-mono">Quản Trị Admin Portal</span>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar Navigation Items */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          <button onClick={() => { setActiveSection('overview'); setSidebarOpen(false); }} className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${activeSection === 'overview' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800/60 text-slate-400'}`}><ShieldCheck className="w-4.5 h-4.5" /><span>Tổng quan</span></button>
          <button onClick={() => { setActiveSection('temporary'); setSidebarOpen(false); }} className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${activeSection === 'temporary' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800/60 text-slate-400'}`}><Copy className="w-4.5 h-4.5" /><span>Bill tạm</span></button>


          <button
            onClick={() => { setActiveSection('sales'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
              activeSection === 'sales'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                : 'hover:bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4.5 h-4.5" />
            <span>Quản lý In PET</span>
          </button>



          <button
            onClick={() => { setActiveSection('debts'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
              activeSection === 'debts'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                : 'hover:bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Coins className="w-4.5 h-4.5" />
            <span>Khách hàng In PET</span>
          </button>
        </nav>

        {/* Current Database Connection indicator */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 text-[11px] font-medium flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-400">Trạng thái CSDL:</span>
          </div>
          {isSupabaseOnline ? (
            <span className="text-emerald-450 font-bold flex items-center gap-1.2 font-mono">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              🟢 Supabase Connected
            </span>
          ) : (
            <span className="text-amber-400 font-bold flex items-center gap-1.2 font-mono" title="Tự động đồng bộ cục bộ và đưa về Offline-First do Supabase chưa cấu hình bảng">
              <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
              🟠 Local Backup Mode
            </span>
          )}
        </div>

        {/* User Account summary */}
        <div className="p-4.5 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 font-bold border border-slate-700">
              AD
            </div>
            <div>
              <p className="font-semibold text-slate-200">{user}</p>
              <span className="text-[10px] text-slate-500 font-mono">Quản trị viên</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Đăng xuất"
            className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* 2. Main Content Board */}
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen">
        {(pendingOrderCount > 0 || pendingOrderStatusError) && (
          <div role="alert" className="p-3 bg-amber-50 border-b border-amber-300 text-amber-900 text-xs font-semibold flex flex-wrap items-center gap-3">
            <span>
              {pendingOrderStatusError ||
                `${pendingOrderCount} đơn đã lưu trên máy nhưng CHƯA XÁC NHẬN đồng bộ cloud. Không tạo lại các đơn đó trên máy khác.`}
            </span>
            {!pendingOrderStatusError && (
              <button
                type="button"
                disabled={syncingOutbox}
                onClick={() => { void retryOrderSync(); }}
                className="bg-amber-700 text-white rounded-lg px-3 py-2 disabled:opacity-50"
              >
                {syncingOutbox ? 'Đang đối chiếu...' : 'Thử đồng bộ và đối chiếu'}
              </button>
            )}
          </div>
        )}
        {/* Dynamic header navigation representing responsive layout toggles */}
        <header className="h-16 bg-white border-b border-slate-100 flex items-center justify-between px-6 sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 hover:bg-slate-100 rounded-xl text-slate-600 block cursor-pointer"
            >
              <Menu className="w-5.5 h-5.5" />
            </button>
            <h3 className="text-sm font-bold text-slate-800 font-mono capitalize tracking-wide">
              {activeSection === 'overview' ? 'Tổng quan In PET' : activeSection === 'temporary' ? 'Bill tạm In PET' : activeSection === 'sales' ? 'Giao dịch In PET' : 'Quản lý khách hàng In PET'}
            </h3>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="hidden sm:flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg text-slate-600 font-semibold font-mono">
              <User className="w-3.5 h-3.5 text-blue-600" />
              <span>{user}@xuongin.local</span>
            </div>
          </div>
        </header>

        {/* Component Panels rendering depending on selection flow */}
        <main className="flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl w-full mx-auto">
          {loading ? (
            <div className="h-96 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono text-slate-400">Khởi động bảng điều khiển...</span>
              </div>
            </div>
          ) : (
            <>
              {activeSection === 'overview' && (() => {
                const total = petOrders.reduce((sum, o) => sum + (Number(o.totalPrice) || 0), 0);
                const paid = petOrders.reduce((sum, o) => sum + (Number(o.paidAmount) || 0), 0);
                const debt = petOrders.reduce((sum, o) => sum + (Number(o.debtAmount) || 0), 0);
                const money = (n: number) => n.toLocaleString('vi-VN') + ' đ';
                return <div className="space-y-6">
                  <div className="bg-slate-900 text-white p-6 rounded-2xl"><h1 className="text-2xl font-bold">Hệ Thống Tổng Quan</h1><p className="text-sm text-slate-400 mt-2">Doanh thu, công nợ và hoạt động in PET DTF</p></div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="bg-white rounded-2xl border p-6"><p className="text-slate-500 text-sm">Tổng doanh thu PET</p><p className="text-2xl font-bold mt-2">{money(total)}</p></div>
                    <div className="bg-white rounded-2xl border p-6"><p className="text-slate-500 text-sm">Đã thu</p><p className="text-2xl font-bold mt-2 text-emerald-700">{money(paid)}</p></div>
                    <div className="bg-white rounded-2xl border p-6"><p className="text-slate-500 text-sm">Công nợ PET</p><p className="text-2xl font-bold mt-2 text-rose-700">{money(debt)}</p></div>
                    <div className="bg-white rounded-2xl border p-6"><p className="text-slate-500 text-sm">Số đơn PET</p><p className="text-2xl font-bold mt-2">{petOrders.length}</p></div>
                    <div className="bg-white rounded-2xl border p-6"><p className="text-slate-500 text-sm">Khách hàng PET</p><p className="text-2xl font-bold mt-2">{petCustomers.length}</p></div>
                  </div>
                  <div className="flex gap-3 flex-wrap"><button onClick={() => setActiveSection('sales')} className="bg-blue-600 text-white px-5 py-3 rounded-xl font-semibold">Quản lý đơn in PET</button><button onClick={() => setActiveSection('temporary')} className="bg-slate-800 text-white px-5 py-3 rounded-xl font-semibold">Bill tạm</button><button onClick={() => setActiveSection('debts')} className="bg-white border px-5 py-3 rounded-xl font-semibold">Công nợ khách PET</button></div>
                </div>;
              })()}
              {activeSection === 'temporary' && <TemporaryBillManager />}
              {activeSection === 'sales' && (
                <SalesManager 
                  orders={petOrders} 
                  products={products} 
                  onAddOrder={handleAddOrder} 
                  onUpdateOrder={handleUpdateOrder}
                  onDeleteOrder={handleDeleteOrder}
                />
              )}
              {activeSection === 'debts' && (
                <DebtManager 
                  customers={petCustomers} 
                  orders={petOrders} 
                  onRecordPayment={handleRecordPayment} 
                  onUndoPayment={handleUndoPayment}
                  onRecordOrderPayment={handleRecordOrderPayment}
                  onUpdateCustomer={handleUpdateCustomer}
                  onDeleteCustomer={handleDeleteCustomer}
                  onUpdateOrder={handleUpdateOrder}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
