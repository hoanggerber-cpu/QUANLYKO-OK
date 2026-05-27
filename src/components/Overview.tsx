import { DashboardStats } from '../types';
import { TrendingUp, CreditCard, AlertCircle, ShoppingBag, Layers, Activity, Percent } from 'lucide-react';

interface OverviewProps {
  stats: DashboardStats;
  onNavigate: (section: string) => void;
}

export default function Overview({ stats, onNavigate }: OverviewProps) {
  const formatVND = (num: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num);
  };

  const debtRatio = stats.totalRevenue > 0 ? (stats.totalDebtUrl / stats.totalRevenue) * 100 : 0;
  const payRatio = stats.totalRevenue > 0 ? (stats.totalPaid / stats.totalRevenue) * 100 : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Welcome Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 text-white p-6 rounded-2xl border border-slate-800 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-64 h-64 bg-blue-600/10 rounded-full blur-2xl" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold tracking-tight text-white mb-1">Hệ Thống Tổng Quan</h1>
          <p className="text-sm text-slate-400">
            Bảng điều khiển bento kiểm soát tình hình kinh doanh, tồn kho và công nợ thực tế.
          </p>
        </div>
        <div className="flex items-center gap-2 relative z-10">
          <button
            onClick={() => onNavigate('sales')}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-blue-500/20 cursor-pointer"
          >
            Tạo đơn hàng mới
          </button>
          <button
            onClick={() => onNavigate('inventory')}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-705 text-slate-200 border border-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
          >
            Nhập sản phẩm kho
          </button>
        </div>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-5">
        
        {/* Bento Cell 1: Total Revenue (Spans 2 columns) */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Tổng doanh thu tháng</span>
            <span className="text-3xl font-extrabold text-slate-800 tracking-tight block font-mono">
              {formatVND(stats.totalRevenue)}
            </span>
          </div>
          <div className="mt-4 flex items-center text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-lg w-fit">
            <span className="mr-1">↑ {payRatio.toFixed(0)}%</span> đã thu tiền về quỹ
          </div>
        </div>

        {/* Bento Cell 2: Current Debt (Spans 2 columns) */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Tổng nợ chưa thu</span>
            <span className="text-3xl font-extrabold text-red-600 tracking-tight block font-mono">
              {formatVND(stats.totalDebtUrl)}
            </span>
          </div>
          <div className="mt-4 flex items-center text-xs text-rose-600 font-bold bg-rose-50 px-2.5 py-1 rounded-lg w-fit">
            <span className="mr-1">!</span> Chiếm {debtRatio.toFixed(0)}% tổng giá trị đơn hàng
          </div>
        </div>

        {/* Bento Cell 3: T-shirt Stock Status (Spans 2 columns) */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Tồn kho áo phông</span>
            <span className="text-3xl font-extrabold text-slate-800 tracking-tight block font-mono">
              {stats.lowStockCount} <span className="text-sm text-slate-400 font-sans">mã sắp hết</span>
            </span>
          </div>
          <div className={`mt-4 flex items-center text-xs font-bold px-2.5 py-1 rounded-lg w-fit ${
            stats.lowStockCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
          }`}>
            <span>{stats.lowStockCount > 0 ? 'Cần bổ sung kho áo trơn' : 'Hệ kho đang ổn định'}</span>
          </div>
        </div>

        {/* Bento Cell 4: In Pet DTF Split Visualization (Spans 4 columns) */}
        <div className="md:col-span-4 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-slate-800 text-sm tracking-wide">Phân đoạn Doanh nghiệp In PET DTF</h3>
              </div>
              <span className="text-[10px] uppercase font-mono bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-bold">Kỹ thuật số</span>
            </div>

            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Các nhà in lẻ liên kết in trực tiếp cuộn PET 60cm từ file thiết kế. Doanh thu chiếm ưu thế với các tệp đối tác VIP.
            </p>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-slate-600 mb-1 font-semibold">
                  <span>Doanh thu mảng In PET DTF</span>
                  <span className="font-extrabold text-slate-800">{formatVND(stats.dtfRevenue)}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full" style={{ width: stats.totalRevenue > 0 ? `${(stats.dtfRevenue / stats.totalRevenue) * 100}%` : '0%' }}></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 bg-slate-50 border border-slate-1 py-3 rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-0.5">Đã thu về</span>
                  <span className="text-sm font-bold text-emerald-600 font-mono">{formatVND(stats.dtfRevenue - stats.dtfDebt)}</span>
                </div>
                <div className="p-3 bg-rose-50/40 border border-slate-1 py-3 rounded-xl">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 block mb-0.5">Nợ phải thu</span>
                  <span className="text-sm font-bold text-rose-600 font-mono">{formatVND(stats.dtfDebt)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bento Cell 5: Monitoring Debt Tshirt (Spans 2 columns) */}
        <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200/60 p-6 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div>
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-slate-800 text-sm tracking-wide">Công nợ sỉ Áo thun</h3>
              <span className="text-[10px] uppercase font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-md font-bold">Quản lý</span>
            </div>

                     <div className="space-y-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Doanh thu áo sỉ</span>
                  <span className="block text-sm font-bold text-slate-800 font-mono mt-0.5">{formatVND(stats.tshirtRevenue)}</span>
                </div>
              </div>

              <div className="p-3 bg-rose-50/50 rounded-xl border border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-rose-500 uppercase font-bold tracking-wider font-semibold">Khách sỉ đang nợ</span>
                  <span className="block text-sm font-bold text-rose-600 font-mono mt-0.5">{formatVND(stats.tshirtDebt)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bento Cell 6: Warnings / Alerts / Large Banner (Spans 6 columns) */}
        <div className="md:col-span-6 bg-slate-900 border border-slate-800 p-6 rounded-2xl text-white shadow-lg relative overflow-hidden">
          <div className="absolute right-0 top-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl" />
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-xl">
              <span className="inline-flex items-center gap-1 bg-amber-500 text-slate-950 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-1">
                ⚠️ Báo động hàng tồn thấp
              </span>
              <h4 className="text-lg font-bold">Quay vòng kho & Tăng hiệu suất sản xuất</h4>
              <p className="text-xs text-slate-300 leading-relaxed">
                Có <span className="text-amber-400 font-bold font-mono">{stats.lowStockCount}</span> mặt hàng áo thun đang rơi xuống dưới 10 sản phẩm mẫu có sẵn. Đề xuất đặt may thêm hàng trơn tự sản xuất ngay để giữ tiến độ giao trả sỉ cho đại lý tỉnh.
              </p>
            </div>
            <div className="flex gap-3 self-start md:self-auto">
              <button
                onClick={() => onNavigate('inventory')}
                className="px-4 py-2 bg-blue-600 text-white font-bold text-xs rounded-xl hover:bg-blue-500 active:bg-blue-700 transition-colors cursor-pointer"
              >
                Nhập kho áo trơn
              </button>
              <button
                onClick={() => onNavigate('debts')}
                className="px-4 py-2 bg-slate-800 text-slate-200 border border-slate-705 font-bold text-xs rounded-xl hover:bg-slate-750 active:bg-slate-800 transition-colors cursor-pointer"
              >
                Thu nợ xoay vốn
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
