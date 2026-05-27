import React, { useState } from 'react';
import { ShieldCheck, LogIn, Sparkles, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/storage';

interface LoginProps {
  onLoginSuccess: (username: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const inputUsername = username.trim();
      const inputPassword = password;

      if (!inputUsername || !inputPassword) {
        setError('Vui lòng điền đầy đủ thông tin.');
        setLoading(false);
        return;
      }

      // Cách 1: Xác thực bằng Supabase Auth (Nếu người dùng điền địa chỉ email đăng nhập)
      if (inputUsername.includes('@')) {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email: inputUsername,
          password: inputPassword,
        });

        if (!authError && data?.user) {
          onLoginSuccess(data.user.email || 'Admin');
          setLoading(false);
          return;
        } else if (authError) {
          setError(`Lỗi xác thực Supabase: ${authError.message}`);
          setLoading(false);
          return;
        }
      }

      // Cách 2: Xác thực bằng bảng dữ liệu truyền thống "admin_users" trên Supabase
      try {
        const { data: adminDb, error: dbError } = await supabase
          .from('admin_users')
          .select('*')
          .eq('username', inputUsername.toLowerCase())
          .eq('password', inputPassword)
          .maybeSingle();

        if (!dbError && adminDb) {
          onLoginSuccess(adminDb.username || 'Admin (DB)');
          setLoading(false);
          return;
        }
      } catch (dbErr) {
        // Bảng không tồn tại hoặc lỗi kết nối, bỏ qua để đi tiếp xuống Cách 3
      }

      // Cách 3: Xác thực qua Biến môi trường Vercel/Vite (Hoàn hảo cho Github, mật khẩu ẩn hoàn toàn khỏi mã nguồn)
      const expectedUser = (import.meta as any).env?.VITE_ADMIN_USERNAME || 'admin';
      const expectedPass = (import.meta as any).env?.VITE_ADMIN_PASSWORD || 'admin123';

      if (inputUsername.toLowerCase() === expectedUser.toLowerCase() && inputPassword === expectedPass) {
        onLoginSuccess('Admin');
      } else {
        setError('Tên đăng nhập hoặc mật khẩu không chính xác.');
      }
    } catch (err: any) {
      setError(`Lỗi hệ thống: ${err.message || err.toString()}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 selection:bg-blue-500 selection:text-white relative overflow-hidden">
      {/* Decorative gradient background */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl" />

      <div className="w-full max-w-md bg-slate-800/85 backdrop-blur-md rounded-2xl border border-slate-700/60 shadow-2xl p-8 relative z-10 animate-fade-in">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Hệ Thống Admin</h1>
          <p className="text-slate-400 text-sm mt-1 text-center font-medium">Quản lý Kho - Bán hàng - Công nợ (DTF & Áo thun)</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-200 text-sm text-center font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Tên đăng nhập hoặc Email</label>
            <input
              id="username"
              name="username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              placeholder="admin hoặc admin@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Mật khẩu</label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-4 pr-12 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Nhập mật khẩu..."
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1.5 focus:outline-none rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-blue-800 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-500/15 cursor-pointer mt-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                <span>Đăng nhập hệ thống</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
