import { useState, useEffect } from 'react';
import { Product, Order, Customer, DashboardStats, OrderType } from './types';
import { StorageManager, supabase } from './lib/storage';
import Login from './components/Login';
import Overview from './components/Overview';
import InventoryManager from './components/InventoryManager';
import SalesManager from './components/SalesManager';
import DebtManager from './components/DebtManager';
import PublicTracking from './components/PublicTracking';
import {
  ShieldCheck,
  TrendingUp,
  Boxes,
  Users2,
  Database,
  Coins,
  LogOut,
  AppWindow,
  Activity,
  User,
  Menu,
  X,
  AlertTriangle,
  Copy,
  Check
} from 'lucide-react';

const MIGRATION_SQL = `-- 1. Tạo bảng order_items nếu chưa tồn tại
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    type TEXT NOT NULL,
    product_name TEXT NOT NULL,
    color TEXT,
    size TEXT,
    quantity NUMERIC DEFAULT 1,
    unit_price NUMERIC DEFAULT 0,
    total_price NUMERIC DEFAULT 0,
    image TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Đổi kiểu dữ liệu cột quantity thành NUMERIC để hỗ trợ mét lẻ
ALTER TABLE orders ALTER COLUMN quantity TYPE NUMERIC;
ALTER TABLE order_items ALTER COLUMN quantity TYPE NUMERIC;

-- 3. Cấu hình bảo mật RLS và quyền truy cập cho order_items
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cho pheps doc order_items an danh" ON order_items;
CREATE POLICY "Cho pheps doc order_items an danh"
ON order_items FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Toan quyen order_items cho moi vai tro" ON order_items;
CREATE POLICY "Toan quyen order_items cho moi vai tro"
ON order_items FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);`;

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState('');
  const [activeSection, setActiveSection] = useState<string>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trackingId, setTrackingId] = useState<string | null>(null);

  // Core records state
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  // Status flags
  const [isSupabaseOnline, setIsSupabaseOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dbMigrationNeeded, setDbMigrationNeeded] = useState(true);
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

  // 1. Check database/storage state on boot
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
    initData();
  }, []);

  // 2. Reactively derive client debts and statistical widgets
  useEffect(() => {
    // Recalculate derived customers and dashboard metrics whenever orders or products update
    const c = StorageManager.getCustomers();
    const s = StorageManager.getDashboardStats();
    setCustomers(c);
    setStats(s);
  }, [orders, products]);

  // 3. Listen to Realtime updates from Supabase to auto-sync cross-device actions
  useEffect(() => {
    if (isSupabaseOnline) {
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
  }, [isSupabaseOnline]);

  // Auth logins
  const handleLoginSuccess = (adminUser: string) => {
    setUser(adminUser);
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUser('');
  };

  // --- ACTIONS ---
  const handleAddProduct = async (newProd: Omit<Product, 'id' | 'createdAt'>) => {
    try {
      await StorageManager.addProduct(newProd);
      // Reload products list
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể thêm sản phẩm mới vào hệ thống, vui lòng kiểm tra lại kết nối mạng!");
    }
  };

  const handleUpdateProduct = async (id: string, updatedFields: Partial<Product>) => {
    try {
      await StorageManager.updateProduct(id, updatedFields);
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể lưu sản phẩm vào hệ thống, vui lòng thử lại!");
    }
  };

  const handleDeleteProduct = async (id: string) => {
    try {
      await StorageManager.deleteProduct(id);
      setProducts(StorageManager.getProducts());
    } catch (error) {
      alert("Lỗi: Không thể xóa sản phẩm khỏi hệ thống!");
    }
  };

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
    }
  };

  const handleUndoPayment = async (paymentId: string, customerName: string, type: OrderType) => {
    try {
      await StorageManager.deletePaymentAndRecalculate(paymentId, customerName, type);
      // Reload ordersafter rollback
      setOrders(StorageManager.getOrders());
    } catch (error) {
      alert("Lỗi: Không thể hủy giao dịch thu tiền!");
    }
  };

  const handleRecordOrderPayment = async (orderId: string, amount: number) => {
    try {
      await StorageManager.updateOrderPayment(orderId, amount);
      setOrders(StorageManager.getOrders());
    } catch (error) {
      alert("Lỗi: Không thể lưu hóa đơn thanh toán vào hệ thống!");
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

  if (trackingId) {
    return <PublicTracking trackingId={trackingId} />;
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
              <h2 className="text-white font-bold leading-none tracking-tight">Xưởng In & May</h2>
              <span className="text-[10px] text-slate-500 font-mono">Quản Trị Admin Portal</span>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar Navigation Items */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          <button
            onClick={() => { setActiveSection('overview'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
              activeSection === 'overview'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                : 'hover:bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4.5 h-4.5" />
            <span>Tổng quan</span>
          </button>

          <button
            onClick={() => { setActiveSection('sales'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
              activeSection === 'sales'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                : 'hover:bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-4.5 h-4.5" />
            <span>Quản lý Bán Hàng</span>
          </button>

          <button
            onClick={() => { setActiveSection('inventory'); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${
              activeSection === 'inventory'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/10'
                : 'hover:bg-slate-800/60 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Boxes className="w-4.5 h-4.5" />
            <span>Quản lý Kho áo</span>
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
            <span>Quản lý Công nợ</span>
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
              {activeSection === 'overview'
                ? 'Màn hình chính / Doanh số chung'
                : activeSection === 'sales'
                ? 'Giao dịch bán hàng & In hĐ'
                : activeSection === 'inventory'
                ? 'Nhập xuất kho mảng Áo thun'
                : 'Kiểm soát số nợ khách lẻ'}
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
              {activeSection === 'overview' && stats && (
                <Overview
                  stats={stats}
                  onNavigate={setActiveSection}
                  onBackup={async () => {
                    try {
                      const result = await StorageManager.downloadFullBackup();
                      alert(
                        result.failedImages.length === 0
                          ? `Đã tạo gói backup portable hoàn chỉnh, nhúng ${result.embeddedImages} hình ảnh thật. Gói này sẵn sàng restore trên web hoặc bản setup Windows/macOS.`
                          : `Đã tạo backup với ${result.embeddedImages} hình ảnh thật. Có ${result.failedImages.length} ảnh không tải được; danh sách lỗi đã được ghi trong tệp backup.`
                      );
                    } catch (error: any) {
                      alert(error?.message || 'Không thể tạo bản backup đầy đủ.');
                    }
                  }}
                  onRestore={async (file) => {
                    try {
                      const inspection = await StorageManager.inspectFullBackup(file);
                      if (!inspection.integrityValid) {
                        alert('Tệp backup không vượt qua kiểm tra toàn vẹn. Không thể restore.');
                        return;
                      }
                      const confirmation = [
                        'Restore sẽ thay thế TOÀN BỘ dữ liệu hiện tại bằng danh mục gốc trong backup.',
                        `Kho áo: ${inspection.products} sản phẩm`,
                        `Hóa đơn: ${inspection.orders}`,
                        `Thanh toán: ${inspection.paymentHistory}`,
                        `Ảnh nhúng thật: ${inspection.embeddedImages}`,
                        inspection.failedImages > 0 ? `Cảnh báo: ${inspection.failedImages} ảnh bị thiếu trong lúc tạo backup.` : 'Ảnh: đầy đủ, không có lỗi được ghi nhận.',
                        '',
                        'Bạn có chắc chắn muốn tiếp tục?'
                      ].join('\n');
                      if (!window.confirm(confirmation)) return;
                      const restored = await StorageManager.restoreFullBackup(file);
                      setProducts(StorageManager.getProducts());
                      setOrders(StorageManager.getOrders());
                      setIsSupabaseOnline(false);
                      alert(`Đã khôi phục thành công: ${restored.products} sản phẩm kho, ${restored.orders} hóa đơn, ${restored.paymentHistory} giao dịch thanh toán và ${restored.embeddedImages} hình ảnh nhúng. Dữ liệu đang được bảo vệ ở chế độ Local Backup trong 1 giờ.`);
                    } catch (error: any) {
                      alert(error?.message || 'Không thể khôi phục tệp sao lưu.');
                    }
                  }}
                />
              )}
              {activeSection === 'sales' && (
                <SalesManager 
                  orders={orders} 
                  products={products} 
                  onAddOrder={handleAddOrder} 
                  onUpdateOrder={handleUpdateOrder}
                  onDeleteOrder={handleDeleteOrder}
                />
              )}
              {activeSection === 'inventory' && (
                <InventoryManager 
                  products={products} 
                  onAddProduct={handleAddProduct} 
                  onUpdateProduct={handleUpdateProduct}
                  onDeleteProduct={handleDeleteProduct}
                />
              )}
              {activeSection === 'debts' && (
                <DebtManager 
                  customers={customers} 
                  orders={orders} 
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
