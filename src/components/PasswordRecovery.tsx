import { useState } from 'react';
import { supabase } from '../lib/storage';

export default function PasswordRecovery({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
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
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || userResult.user?.email?.toLowerCase() !== 'hoangkenlee@gmail.com') {
        throw new Error('Liên kết không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.');
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      window.history.replaceState(null, '', window.location.pathname);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể đặt lại mật khẩu.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-5">
      <form onSubmit={save} className="w-full max-w-md bg-slate-800 p-8 rounded-2xl space-y-5">
        <h1 className="text-xl font-bold">Thiết lập mật khẩu bảo mật</h1>
        <p className="text-sm text-slate-300">Sau khi hoàn tất, đăng nhập bằng tên hoanguyen và mật khẩu mới.</p>
        {error && <p role="alert" className="text-red-300">{error}</p>}
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
    </main>
  );
}
