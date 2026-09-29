import React, { useEffect, useRef } from 'react';
import {
  Package,
  Users,
  Network,
  Radio,
  ArrowLeftRight,
  FileText,
  Barcode as BarcodeIcon,
  LayoutDashboard,
  RotateCcw,
  Layers,
  ShieldCheck,
  LogOut
} from 'lucide-react';
import { canAccessMenu, ROLE_LABELS } from '../utils/auth';

const ALL_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'master', label: 'Master Barang', icon: Package },
  { id: 'pelanggan', label: 'Divisi Pelanggan', icon: Users },
  { id: 'fo', label: 'Divisi FO', icon: Network },
  { id: 'tower', label: 'Divisi Tower', icon: Radio },
  { id: 'transaksi', label: 'Keluar / Masuk', icon: ArrowLeftRight },
  { id: 'laporan', label: 'Laporan Terpadu', icon: FileText },
  { id: 'users', label: 'Manajemen User', icon: ShieldCheck }
];

export default function Navbar({
  currentTab,
  onSelectTab,
  onOpenScanner,
  onResetSeed,
  isResetting,
  user,
  onLogout
}) {
  // Ref untuk baris menu horizontal: tab aktif otomatis digeser ke tengah
  const mobileNavRef = useRef(null);
  const activeTabRef = useRef(null);

  const role = user?.role || 'admin';
  const isAdmin = role === 'admin';
  // Menu disaring sesuai hirarki peran pengguna
  const navItems = ALL_NAV_ITEMS.filter((item) => canAccessMenu(item.id, role));

  // Geser tab aktif agar selalu terlihat saat navigasi mobile di-scroll
  useEffect(() => {
    const container = mobileNavRef.current;
    const activeBtn = activeTabRef.current;
    if (!container || !activeBtn) return;

    const target = activeBtn.offsetLeft - (container.clientWidth - activeBtn.clientWidth) / 2;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    } else {
      container.scrollLeft = Math.max(0, target);
    }
  }, [currentTab]);

  return (
    <>
    {/* Bar atas (brand + alat) — satu-satunya bagian yang selalu menempel di semua ukuran layar.
        Tinggi tetap (h-14 / sm:h-16) supaya offset sticky baris menu di bawahnya bisa dihitung pasti. */}
    <header className="no-print bg-slate-900 text-white sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-4">
          {/* Logo & Brand Title */}
          <div 
            onClick={() => onSelectTab('dashboard')} 
            className="flex items-center gap-2 sm:gap-3 cursor-pointer shrink-0 min-w-0"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Layers className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-black text-sm sm:text-base tracking-tight text-white whitespace-nowrap">SIM-ASET</span>
                <span className="hidden sm:inline-block px-1.5 py-0.2 rounded text-[10px] font-bold bg-indigo-500/30 text-indigo-300 border border-indigo-400/20 whitespace-nowrap">
                  ISP TERPADU
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Pelanggan • Divisi FO • Divisi Tower
              </p>
            </div>
          </div>

          {/* Right Action Tools: Scanner, Reset (admin), User Chip & Logout */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              onClick={onOpenScanner}
              className="px-2.5 sm:px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition transform hover:-translate-y-0.5"
              title="Buka Scanner Barcode / QR Code Kamera & USB Gun"
              aria-label="Pindai Barcode"
            >
              <BarcodeIcon className="w-4 h-4 text-emerald-100" />
              <span className="hidden sm:inline">Pindai Barcode</span>
            </button>

            {isAdmin && (
              <button
                onClick={onResetSeed}
                disabled={isResetting}
                className="px-2.5 sm:px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition disabled:opacity-60"
                title="Reset dan isi ulang data contoh simulasi ISP"
                aria-label="Reset Data Contoh"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
                <span className="hidden md:inline">Reset Data Contoh</span>
              </button>
            )}

            {/* Identitas user + logout */}
            {user && (
              <div className="flex items-center gap-1.5 pl-1.5 sm:pl-2.5 border-l border-slate-700">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 ${
                    isAdmin ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200'
                  }`}>
                    {(user.nama_lengkap || user.username || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="hidden md:block min-w-0">
                    <div className="text-xs font-bold text-white leading-tight max-w-[120px] truncate">
                      {user.nama_lengkap || user.username}
                    </div>
                    <div className="text-[10px] text-indigo-300 font-semibold leading-tight">
                      {ROLE_LABELS[user.role] || user.role}
                    </div>
                  </div>
                </div>
                <button
                  onClick={onLogout}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-rose-600/80 text-slate-400 hover:text-white border border-slate-700 transition"
                  title="Keluar dari sistem"
                  aria-label="Logout"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </header>

    {/* Baris menu: satu baris yang bisa digeser (tidak pernah membungkus jadi 2 baris).
        - Layar kecil/tablet: ikut tergulung bersama halaman → hanya bar atas (56px) yang menutupi konten,
          bukan 2 baris sekaligus (±106px) seperti sebelumnya.
        - Desktop (lg+): menempel tepat di bawah bar atas (top-16) supaya tetap mudah berpindah menu. */}
    <div className="no-print bg-slate-900 border-y border-slate-800 lg:sticky lg:top-16 z-30 shadow-md">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div
          ref={mobileNavRef}
          role="navigation"
          aria-label="Menu utama"
          className="relative flex items-center gap-1 overflow-x-auto py-1.5 lg:py-2 scrollbar-none snap-x snap-mandatory"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                ref={isActive ? activeTabRef : null}
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`px-3 py-2 rounded-lg lg:rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 lg:gap-2 transition shrink-0 snap-start ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
}
