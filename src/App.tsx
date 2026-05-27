import { useState, useEffect } from 'react';
import { Product, Order, Customer, DashboardStats, OrderType } from './types';
import { StorageManager } from './lib/storage';
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
    window.addEventListener('supabase_sync_error', handleSyncError);
    return () => {
      window.removeEventListener('supabase_sync_error', handleSyncError);
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
    const match = path.match(/\/(?:tracking|cong-no|c)\/([a-f0-9-]+)/i) || 
                  hash.match(/\/(?:tracking|cong-no|c)\/([a-f0-9-]+)/i) ||
                  path.match(/\/(?:tracking|cong-no|c)\/([^\/]+)/i) ||
                  hash.match(/\/(?:tracking|cong-no|c)\/([^\/]+)/i);
    if (match) {
      setTrackingId(match[1]);
    }
  }, []);

  // 1. Check database/storage state on boot
  useEffect(() => {
    async function initData() {
      try {
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
  const handleAddProduct = (newProd: Omit<Product, 'id' | 'createdAt'>) => {
    const p = StorageManager.addProduct(newProd);
    // Reload products list
    setProducts(StorageManager.getProducts());
  };

  const handleUpdateProduct = (id: string, updatedFields: Partial<Product>) => {
    StorageManager.updateProduct(id, updatedFields);
    setProducts(StorageManager.getProducts());
  };

  const handleDeleteProduct = (id: string) => {
    StorageManager.deleteProduct(id);
    setProducts(StorageManager.getProducts());
  };

  const handleAddOrder = (newOrder: Omit<Order, 'id' | 'orderCode'> & { createdAt?: string }) => {
    StorageManager.addOrder(newOrder);
    // Reload orders and products (since products stock changes)
    setOrders(StorageManager.getOrders());
    setProducts(StorageManager.getProducts());
  };

  const handleRecordPayment = (customerName: string, type: OrderType, amount: number, paymentMethod: string) => {
    StorageManager.recordCustomerPayment(customerName, type, amount, paymentMethod);
    // Reload orders
    setOrders(StorageManager.getOrders());
  };

  const handleUndoPayment = async (paymentId: string, customerName: string, type: OrderType) => {
    await StorageManager.deletePaymentAndRecalculate(paymentId, customerName, type);
    // Reload ordersafter rollback
    setOrders(StorageManager.getOrders());
  };

  const handleRecordOrderPayment = (orderId: string, amount: number) => {
    StorageManager.updateOrderPayment(orderId, amount);
    // Reload orders
    setOrders(StorageManager.getOrders());
  };

  const handleUpdateOrder = (id: string, updatedFields: Partial<Order>) => {
    StorageManager.updateOrder(id, updatedFields);
    setOrders(StorageManager.getOrders());
    setProducts(StorageManager.getProducts());
  };

  const handleDeleteOrder = (id: string) => {
    StorageManager.deleteOrder(id);
    setOrders(StorageManager.getOrders());
    setProducts(StorageManager.getProducts());
  };

  const handleUpdateCustomer = (oldName: string, type: OrderType, newName: string, newTotalSpent?: number, newTotalPaid?: number, newPinCode?: string | null) => {
    StorageManager.updateCustomer(oldName, type, newName, newTotalSpent, newTotalPaid, newPinCode);
    setOrders(StorageManager.getOrders());
    setProducts(StorageManager.getProducts());
  };

  const handleDeleteCustomer = (customerName: string, type: OrderType) => {
    StorageManager.deleteCustomer(customerName, type);
    setOrders(StorageManager.getOrders());
    setProducts(StorageManager.getProducts());
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
          <button 
            type="button"
            onClick={() => setDbMigrationNeeded(true)}
            className="mt-1 text-blue-400 hover:text-blue-300 text-[10px] font-bold underline flex items-center gap-1 cursor-pointer bg-transparent border-none p-0 text-left self-start"
          >
            📋 Xem câu lệnh SQL đồng bộ cột
          </button>
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
          {dbMigrationNeeded && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <h4 className="text-amber-900 font-bold text-sm">
                    ⚠️ Cần cập nhật kiểu dữ liệu cột Số lượng trong Supabase
                  </h4>
                  <p className="text-amber-700 text-xs mt-1.5 leading-relaxed">
                    Hệ thống ghi nhận lỗi <code className="bg-amber-100/60 font-semibold px-1 py-0.5 rounded font-mono text-[11px]">invalid input syntax for type integer</code> khi đồng bộ dữ liệu đơn hàng in PET/DTF có kích thước lẻ (như <code className="font-mono font-semibold">0.415m</code>). Hãy sao chép và chạy câu lệnh SQL bên dưới tại mục <strong>SQL Editor</strong> trên Supabase của bạn để đổi kiểu dữ liệu cột sang <code className="font-semibold">NUMERIC</code> (số thập phân).
                  </p>
                  
                  <div className="mt-4 flex flex-col gap-3">
                    <pre className="flex-1 bg-slate-900 text-slate-100 rounded-xl p-4 font-mono text-[10px] md:text-[11px] select-all relative group overflow-x-auto leading-relaxed whitespace-pre font-medium">
                      {MIGRATION_SQL}
                    </pre>
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(MIGRATION_SQL);
                          setCopiedCode(true);
                          setTimeout(() => setCopiedCode(false), 2000);
                        }}
                        className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer shrink-0 flex items-center justify-center gap-1.5 h-10"
                      >
                        {copiedCode ? <Check className="w-4 h-4 text-emerald-450" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedCode ? 'Đã copy!' : 'Copy SQL'}</span>
                      </button>
                      <button
                        onClick={() => {
                          localStorage.removeItem('supabase_migration_needed');
                          setDbMigrationNeeded(false);
                        }}
                        className="px-4 py-2 bg-white text-slate-600 border border-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer shrink-0 h-10"
                      >
                        Bỏ qua
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
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
                <Overview stats={stats} onNavigate={setActiveSection} />
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
