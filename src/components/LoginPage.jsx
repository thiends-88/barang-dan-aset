import React, { useState } from 'react';
import { Layers, User, Lock, Eye, EyeOff, LogIn, AlertTriangle, RefreshCw, ShieldCheck, Package, Users, Radio, Network, ArrowRight, Sparkles, CheckCircle2 } from 'lucide-react';

/**
 * Halaman login SIM-ASET — premium split-screen.
 * Kiri: hero branding + value prop + stats (desktop)
 * Kanan: kartu form login floating
 * Mobile: stack dengan hero ringkas di atas.
 */
export default function LoginPage({ onLogin, notice = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

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

  const fillDemo = (u, p) => { setUsername(u); setPassword(p); setError(''); };

  return (
    <div className="min-h-screen bg-[#020617] flex flex-col font-sans antialiased selection:bg-indigo-500 selection:text-white">
      {/* Background ornaments */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-[#0f172a] to-indigo-950" />
        {/* grid pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: `linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />
        <div className="absolute -top-40 -left-40 w-[700px] h-[700px] bg-indigo-600/25 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 right-0 w-[600px] h-[600px] bg-blue-600/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-violet-600/10 rounded-full blur-[140px]" />
      </div>

      {/* Top bar slim (desktop) */}
      <header className="relative z-10 hidden lg:flex items-center justify-between px-8 py-5 max-w-[1280px] w-full mx-auto">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Layers className="w-5 h-5 text-white" />
          </span>
          <span className="font-black text-white tracking-tight">SIM-ASET</span>
          <span className="hidden xl:inline-flex ml-2 px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-[11px] font-semibold text-indigo-200 backdrop-blur">ISP • Solok • v1.0</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Enkripsi • Audit Log • Role-Based Access</span>
        </div>
      </header>

      {/* Main split */}
      <div className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-[1120px] grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-6 lg:gap-8 items-center">

          {/* LEFT — Hero (hidden on small, compact on mobile) */}
          <div className="relative order-2 lg:order-1">
            {/* Mobile compact hero */}
            <div className="lg:hidden text-center mb-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-indigo-200 text-xs font-semibold backdrop-blur">
                <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                Sistem Terintegrasi untuk ISP Modern
              </div>
              <h1 className="mt-4 text-[22px] font-black text-white leading-tight">
                Ribuan aset, <span className="bg-gradient-to-r from-indigo-400 to-sky-400 bg-clip-text text-transparent">satu kendali.</span>
              </h1>
            </div>

            {/* Desktop hero card */}
            <div className="hidden lg:block relative rounded-[28px] overflow-hidden border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] backdrop-blur-xl shadow-2xl">
              {/* subtle top highlight */}
              <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
              <div className="absolute -top-24 -right-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />

              <div className="relative p-8 lg:p-9">
                {/* Badge */}
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/20 text-indigo-200 text-xs font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live Stock • Realtime Presisi
                </div>

                <h1 className="mt-5 text-[32px] leading-[1.05] font-black text-white tracking-tight">
                  Kelola ribuan aset
                  <span className="block bg-gradient-to-r from-indigo-300 via-sky-300 to-blue-300 bg-clip-text text-transparent">dalam satu dashboard</span>
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-slate-300 max-w-[520px]">
                  Gudang • Pelanggan • Jalur FO • Tower BTS — stok, mutasi, sebaran terpasang & barcode scanner dalam satu sistem terpadu. Akurat, cepat, siap audit.
                </p>

                {/* Feature pills */}
                <div className="mt-6 flex flex-wrap gap-2">
                  {[
                    { icon: Package, label: '1800+ SKU' },
                    { icon: Users, label: 'Pelanggan Terhubung' },
                    { icon: Network, label: 'Jalur FO Live' },
                    { icon: Radio, label: 'Site Tower' },
                  ].map((f) => (
                    <span key={f.label} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-white text-xs font-semibold backdrop-blur">
                      <f.icon className="w-3.5 h-3.5 text-indigo-300" />
                      {f.label}
                    </span>
                  ))}
                </div>

                {/* Mini preview card */}
                <div className="mt-8 rounded-2xl bg-white/95 backdrop-blur border border-white/20 shadow-xl overflow-hidden">
                  <div className="h-1.5 bg-gradient-to-r from-indigo-600 via-sky-500 to-emerald-500" />
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        Ringkasan Live
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400">hari ini • WIB</span>
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Masuk</div>
                        <div className="mt-1 text-lg font-black text-emerald-700">+248</div>
                        <div className="text-[11px] text-slate-400">unit</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Keluar</div>
                        <div className="mt-1 text-lg font-black text-rose-700">−176</div>
                        <div className="text-[11px] text-slate-400">unit</div>
                      </div>
                      <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3">
                        <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wide">Aset</div>
                        <div className="mt-1 text-sm font-black text-indigo-900">Rp 1,2M</div>
                        <div className="text-[11px] text-indigo-600">valuasi</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      Sinkron Gudang ↔ Pelanggan ↔ FO ↔ Tower • Barcode ready
                    </div>
                  </div>
                </div>

                {/* Trust */}
                <div className="mt-6 flex items-center gap-3 text-xs text-slate-400">
                  <div className="flex -space-x-2">
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 border-2 border-slate-900 flex items-center justify-center text-[10px] font-black text-white">A</span>
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 border-2 border-slate-900 flex items-center justify-center text-[10px] font-black text-white">G</span>
                    <span className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 border-2 border-slate-900 flex items-center justify-center text-[10px] font-black text-white">T</span>
                  </div>
                  <span>Dipercaya tim Gudang & Teknisi • <strong className="text-slate-200">PT. CINOXMEDIA</strong></span>
                </div>
              </div>

              {/* bottom strip */}
              <div className="relative bg-white/5 border-t border-white/10 px-8 py-3 flex items-center justify-between text-xs text-slate-300 backdrop-blur">
                <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Role • Audit • Backup</span>
                <span className="hidden sm:inline">Solok • Sumatera Barat</span>
              </div>
            </div>

            {/* Floating badge (desktop) */}
            <div className="hidden lg:flex absolute -bottom-4 -right-4 items-center gap-2 px-4 py-2 rounded-2xl bg-white shadow-xl border border-slate-200">
              <span className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <Package className="w-4 h-4" />
              </span>
              <div className="text-xs">
                <div className="font-bold text-slate-900">Stok Akurat</div>
                <div className="text-slate-500">Scanner + validasi stok</div>
              </div>
            </div>
          </div>

          {/* RIGHT — Login card */}
          <div className="order-1 lg:order-2 w-full max-w-[460px] mx-auto lg:mx-0">
            <div className="relative bg-white rounded-[24px] shadow-[0_20px_60px_rgba(0,0,0,0.35)] border border-slate-200 overflow-hidden">
              {/* top accent */}
              <div className="h-1 w-full bg-gradient-to-r from-indigo-600 via-blue-600 to-sky-500" />

              <div className="px-6 sm:px-8 pt-7 pb-6">
                {/* header inside card (also for mobile brand) */}
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
                    <Layers className="w-5 h-5 text-white" />
                  </span>
                  <div>
                    <div className="text-[15px] font-black text-slate-900 tracking-tight leading-none">SIM-ASET</div>
                    <div className="text-[11px] font-semibold text-indigo-600">Masuk untuk melanjutkan</div>
                  </div>
                  <span className="ml-auto hidden sm:inline-flex px-2.5 py-1 rounded-full bg-slate-900 text-white text-[11px] font-bold">v1.0 • Aman</span>
                </div>

                <h2 className="mt-6 text-[20px] font-black text-slate-900 tracking-tight">Selamat datang kembali</h2>
                <p className="mt-1 text-sm text-slate-500">Gunakan username & password yang diberikan admin. Sesi aman & tercatat di log.</p>

                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  {notice && (
                    <div className="flex items-start gap-2.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <span className="leading-snug">{notice}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1.5">Username</label>
                    <div className="relative group">
                      <User className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 absolute left-3.5 top-3.5 transition" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="mis. admin / gudang / teknisi"
                        autoComplete="username"
                        autoFocus
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none transition"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-slate-700">Password</label>
                      <button type="button" onClick={() => setShowDemo((s) => !s)} className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700">Akun demo ▾</button>
                    </div>
                    <div className="relative group">
                      <Lock className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-600 absolute left-3.5 top-3.5 transition" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Masukkan password"
                        autoComplete="current-password"
                        className="w-full pl-10 pr-11 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-2.5 top-2.5 p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                        aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>

                    {/* Demo accounts */}
                    {showDemo && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[
                          ['admin', 'admin123'],
                          ['gudang', 'gudang123'],
                          ['teknisi', 'teknisi123'],
                          ['viewer', 'viewer123'],
                        ].map(([u, p]) => (
                          <button key={u} type="button" onClick={() => fillDemo(u, p)} className="px-2.5 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-semibold flex items-center justify-between">
                            <span>{u}</span>
                            <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {error && (
                    <div className="flex items-start gap-2.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3.5 py-3">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="leading-snug">{error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60 text-white text-sm font-black rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition transform hover:-translate-y-0.5"
                  >
                    {isSubmitting ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /><span>Memeriksa…</span></>
                    ) : (
                      <><LogIn className="w-4 h-4" /><span>Masuk ke Sistem</span><ArrowRight className="w-4 h-4 opacity-70" /></>
                    )}
                  </button>

                  <div className="flex items-center gap-3 pt-1">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Aman & Terenkripsi</span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>

                  <div className="flex items-center justify-center gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Aktivitas tercatat</span>
                    <span className="w-1 h-1 rounded-full bg-slate-300" />
                    <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-indigo-500" /> Role terjaga</span>
                  </div>
                </form>
              </div>

              {/* card footer */}
              <div className="px-6 sm:px-8 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-slate-500">© PT. CINOXMEDIA NETWORK INDONESIA • Solok</span>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Sistem Aktif
                </span>
              </div>
            </div>

            {/* helper below card */}
            <p className="mt-4 text-center text-xs text-slate-400">
              Butuh bantuan? Hubungi admin untuk reset password • Kredensial demo tidak tampil di produksi
            </p>
          </div>
        </div>
      </div>

      {/* Bottom copyright for desktop */}
      <div className="relative z-10 hidden lg:block text-center text-xs text-slate-500 pb-6">
        Sistem Informasi Manajemen Barang & Aset Terintegrasi — Gudang • Pelanggan • FO • Tower • Scanner • Backup & Restore
      </div>
    </div>
  );
}
