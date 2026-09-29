import React, { useState } from 'react';
import { Layers, User, Lock, Eye, EyeOff, LogIn, AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

/**
 * Halaman login SIM-ASET — gerbang utama sebelum masuk aplikasi.
 * Menampilkan akun demo per peran agar mudah dicoba (data dari seed).
 */
export default function LoginPage({ onLogin, notice = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Username dan password wajib diisi');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Login gagal, periksa kembali username dan password');
        return;
      }
      onLogin(data.data.token, data.data.user);
    } catch (err) {
      setError('Tidak dapat terhubung ke server. Pastikan server API berjalan.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const demoAccounts = [
    { role: 'Administrator', username: 'admin', password: 'admin123', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30' },
    { role: 'Staff Gudang', username: 'gudang', password: 'gudang123', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30' },
    { role: 'Teknisi Lapangan', username: 'teknisi', password: 'teknisi123', color: 'bg-amber-500/20 text-amber-300 border-amber-400/30' },
    { role: 'Viewer', username: 'viewer', password: 'viewer123', color: 'bg-slate-500/20 text-slate-300 border-slate-400/30' }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4 font-sans antialiased">
      {/* Aksen latar */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Kartu login */}
        <div className="bg-white/95 backdrop-blur rounded-2xl shadow-2xl border border-white/20 overflow-hidden">
          {/* Header brand */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-6 py-7 text-center border-b border-indigo-800/50">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Layers className="w-8 h-8 text-white" />
            </div>
            <h1 className="mt-3 text-xl font-black text-white tracking-tight">SIM-ASET</h1>
            <p className="text-xs text-indigo-300 font-medium mt-0.5">Sistem Informasi Manajemen Barang & Aset Terintegrasi</p>
            <p className="text-[11px] text-slate-400 mt-1">Pelanggan • Divisi FO • Divisi Tower • Barcode Scanner</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
            {/* Pemberitahuan sesi berakhir — tampil terus sampai login berhasil */}
            {notice && (
              <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                <span className="leading-snug">{notice}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Username</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Masukkan username"
                  autoComplete="username"
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-11 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-indigo-600 transition"
                  title={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-bold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 transition transform hover:-translate-y-0.5"
            >
              {isSubmitting ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /><span>Memeriksa...</span></>
              ) : (
                <><LogIn className="w-4 h-4" /><span>Masuk ke Sistem</span></>
              )}
            </button>
          </form>
        </div>

        {/* Akun demo */}
        <div className="mt-4 bg-slate-900/70 backdrop-blur border border-slate-700/60 rounded-2xl p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-300 mb-2.5">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            <span>AKUN CONTOH PER PERAN (klik untuk mengisi form)</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {demoAccounts.map((acc) => (
              <button
                key={acc.username}
                onClick={() => { setUsername(acc.username); setPassword(acc.password); setError(''); }}
                className={`text-left px-3 py-2 rounded-xl border text-[11px] font-semibold transition hover:brightness-125 ${acc.color}`}
              >
                <div className="font-bold">{acc.role}</div>
                <div className="font-mono opacity-80">{acc.username} / {acc.password}</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-500 mt-2.5 text-center">
            * Segera ganti password contoh lewat menu Manajemen User setelah login sebagai admin.
          </p>
        </div>
      </div>
    </div>
  );
}
