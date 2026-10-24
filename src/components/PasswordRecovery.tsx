import { useEffect, useState } from 'react';
import { supabase } from '../lib/storage';

const OWNER_EMAIL = 'hoangkenlee@gmail.com';

export default function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    const checkRecoverySession = async () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      // Supabase uses this fragment for expired, invalid, or already consumed links.
      if (params.has('error_code') || params.has('error')) {
        if (active) {
          setError('Liên kết đã hết hạn hoặc không hợp lệ. Hãy yêu cầu email khôi phục mới.');
          setChecking(false);
        }
        return;
      }
      try {
        // getUser verifies the current session against the Auth server.
        const { data, error: authError } = await supabase.auth.getUser();
        if (!active) return;
        if (authError || data.user?.email?.toLowerCase() !== OWNER_EMAIL) {
          setError('Không có phiên xác thực hợp lệ. Hãy mở liên kết mới từ email.');
        } else {
          setAuthorized(true);
        }
      } catch {
        if (active) setError('Không thể xác minh liên kết. Vui lòng thử lại sau.');
      } finally {
        if (active) setChecking(false);
      }
    };
    void checkRecoverySession();
    return () => { active = false; };
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!authorized || loading) return;
    if (password.length < 12) {
      setError('Mật khẩu mới cần ít nhất 12 ký tự.');
      return;
    }
    if (password !== confirm) {
      setError('Hai mật khẩu không trùng khớp.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || data.user?.email?.toLowerCase() !== OWNER_EMAIL) {
        setAuthorized(false);
        throw new Error('Phiên xác thực đã hết hạn. Hãy yêu cầu email khôi phục mới.');
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đặt lại mật khẩu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-5">
      <div className="w-full max-w-md bg-slate-800 p-8 rounded-2xl space-y-5">
        <h1 className="text-xl font-bold">Thiết lập mật khẩu bảo mật</h1>
        <p className="text-sm text-slate-300">Sau khi hoàn tất, đăng nhập bằng tên hoanguyen và mật khẩu mới.</p>
        {checking && <p role="status">Đang xác minh liên kết...</p>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        {!checking && !authorized && (
          <a href="/" className="inline-block rounded-lg bg-blue-600 p-3">Quay về trang đăng nhập</a>
        )}
        {!checking && authorized && (
          <form onSubmit={save} className="space-y-5">
            <label className="block space-y-2">
              <span>Mật khẩu mới</span>
              <input className="w-full rounded-lg p-3 text-slate-900" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <label className="block space-y-2">
              <span>Nhập lại mật khẩu</span>
              <input className="w-full rounded-lg p-3 text-slate-900" type="password" autoComplete="new-password" minLength={12} required value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
            <button disabled={loading} className="w-full rounded-lg bg-blue-600 p-3 disabled:opacity-50" type="submit">{loading ? 'Đang lưu...' : 'Lưu mật khẩu mới'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
