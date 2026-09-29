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

// `label`  = nama lengkap → dipakai di baris menu geser (layar kecil/sempit) & tooltip.
// `short`  = nama ringkas → dipakai di baris menu utama desktop. WAJIB diisi: tanpa
//            `short` yang cukup pendek, 8 menu tidak muat satu baris di laptop
//            dan baris menu ikut tergulir/menabrak tombol di sebelahnya.
// Menambah menu baru? Isi KEDUA kunci di bawah.
const ALL_NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', short: 'Dashboard', icon: LayoutDashboard },
  { id: 'master', label: 'Master Barang', short: 'Barang', icon: Package },
  { id: 'pelanggan', label: 'Divisi Pelanggan', short: 'Pelanggan', icon: Users },
  { id: 'fo', label: 'Divisi FO', short: 'FO', icon: Network },
  { id: 'tower', label: 'Divisi Tower', short: 'Tower', icon: Radio },
  { id: 'transaksi', label: 'Keluar / Masuk', short: 'Mutasi', icon: ArrowLeftRight },
  { id: 'laporan', label: 'Laporan Terpadu', short: 'Laporan', icon: FileText },
  { id: 'users', label: 'Manajemen User', short: 'User', icon: ShieldCheck }
];

// Lebar minimum agar menu utama tampil satu baris (lihat --breakpoint-nav di index.css).
const NAV_BREAKPOINT_PX = 1100;

export default function Navbar({
  currentTab,
  onSelectTab,
  onOpenScanner,
  onResetSeed,
  isResetting,
  user,
  onLogout
}) {
  // Ref untuk baris menu geser: tab aktif otomatis digeser ke tengah
  const mobileNavRef = useRef(null);
  const activeTabRef = useRef(null);
  // Ref baris menu utama: dipakai untuk mengukur sisa ruang tiap resize
  const mainNavRef = useRef(null);

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

  // Peringatan developer (konsol) bila 8 menu tidak lagi muat dalam satu baris:
  // biasanya berarti ada menu ke-9 atau label `short` yang terlalu panjang.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(`(min-width: ${NAV_BREAKPOINT_PX}px)`);
    const warn = () => {
      const nav = mainNavRef.current;
      if (!nav || nav.clientWidth === 0) return;
      if (nav.scrollWidth > nav.clientWidth + 1) {
        console.warn(
          `[Navbar] Menu utama tidak muat satu baris (butuh ${nav.scrollWidth}px, tersedia ${nav.clientWidth}px). ` +
          'Menu bisa tergulir/tertimpa. Pendekkan `short` atau turunkan --breakpoint-nav.'
        );
      }
    };
    warn();
    mq.addEventListener?.('change', warn);
    window.addEventListener('resize', warn);
    return () => {
      mq.removeEventListener?.('change', warn);
      window.removeEventListener('resize', warn);
    };
  }, [navItems.length]);

  return (
    <>
    {/* ------------------------------------------------------------------
        Header menempel = SATU baris (h-14 / sm:h-16) pada lebar >= 1100px
        (varian `nav:` dari --breakpoint-nav).

        Aturan ruang di baris ini — JANGAN dilanggar:
        1. Menu utama yang diprioritaskan. Brand & tombol alat dibuat RINGKAS
           (ikon saja, tanpa teks) supaya 8 menu selalu muat tanpa tergulir.
           Inilah penyebab bug lama: label tombol ikut tampil pada 1100–1535px,
           memakan ~540px, sehingga menu hanya dapat 392px dari 602px yang
           dibutuhkan → item menu tergeser keluar & tertimpa tombol "Pindai
           Barcode". Jangan pakai `min-[1100px]:` untuk menyalakan/mematikan
           tampilan: varian arbitrer kalah urutan dari sm:/md:/2xl: (lihat index.css).
        2. Maksimal SATU pasangan tampil/sembunyi per elemen
           (`hidden` + `nav:`/`2xl:`). Menggabungkannya dengan `sm:`/`md:`
           berisiko aturan salah urutan diam-diam.
        ------------------------------------------------------------------ */}
    <header className="no-print bg-slate-900 text-white sticky top-0 z-40 shadow-lg">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-3">
          {/* Brand: logo + nama saja. Badge "ISP TERPADU" & subtitle dipindah ke
              hero Dashboard agar tidak memakan lebar dari menu utama. */}
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            title="Kembali ke Dashboard"
            aria-label="SIM-ASET — kembali ke Dashboard"
            className="flex items-center gap-2 shrink-0 min-w-0 cursor-pointer"
          >
            <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 shrink-0">
              <Layers className="w-4 h-4 sm:w-5 sm:h-5" />
            </span>
            <span className="font-black text-sm sm:text-base tracking-tight text-white whitespace-nowrap">SIM-ASET</span>
          </button>

          {/* Menu utama (>= 1100px): satu baris, tidak pernah membungkus.
              `overflow-x-auto` + `justify-center-safe` berfungsi sebagai pengaman:
              andai someday menu tidak muat, isinya bergeser ke kiri (bukan
              tertimpa tombol di sebelah kanan). */}
          <nav
            ref={mainNavRef}
            aria-label="Menu utama"
            className="hidden nav:flex flex-1 min-w-0 items-center justify-center-safe gap-0.5 overflow-x-auto scrollbar-none"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  title={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  className={`px-2 xl:px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.short}</span>
                </button>
              );
            })}
          </nav>

          {/* Alat: HANYA IKON (label penuh pindah ke title/aria-label).
              Menghemat ~390px, cukup untuk seluruh menu utama + brand. */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              onClick={onOpenScanner}
              className="p-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl shadow-sm transition transform hover:-translate-y-0.5"
              title="Pindai Barcode / QR Code (Kamera & USB Gun)"
              aria-label="Pindai Barcode"
            >
              <BarcodeIcon className="w-4 h-4 text-emerald-100" />
            </button>

            {isAdmin && (
              <button
                onClick={onResetSeed}
                disabled={isResetting}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl border border-slate-700 transition disabled:opacity-60"
                title="Reset dan isi ulang data contoh simulasi ISP"
                aria-label="Reset Data Contoh"
              >
                <RotateCcw className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} />
              </button>
            )}

            {/* Identitas user + logout. Nama & peran baru tampil di 2xl (>=1536px),
                tempat ruangnya memang tersedia; di bawah itu cukup avatar + tooltip. */}
            {user && (
              <div className="flex items-center gap-1.5 pl-1.5 sm:pl-2.5 border-l border-slate-700">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0 cursor-default"
                  title={`${user.nama_lengkap || user.username} • ${ROLE_LABELS[user.role] || user.role}`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center ${isAdmin ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-200'}`}>
                    {(user.nama_lengkap || user.username || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="hidden 2xl:block min-w-0">
                  <div className="text-xs font-bold text-white leading-tight max-w-[120px] truncate">
                    {user.nama_lengkap || user.username}
                  </div>
                  <div className="text-[10px] text-indigo-300 font-semibold leading-tight">
                    {ROLE_LABELS[user.role] || user.role}
                  </div>
                </div>
                <button
                  onClick={onLogout}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-rose-600/80 text-slate-400 hover:text-white border border-slate-700 transition"
                  title="Keluar dari sistem"
                  aria-label="Logout"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>

    {/* Lebar < 1100px: menu pindah ke baris geser sendiri di bawah baris atas yang
        TIDAK menempel (ikut tergulung), jadi konten tidak tertutup dua baris header.
        Label penuh dipakai di sini karena layar sempit & jaraknya besar. */}
    <div className="no-print nav:hidden bg-slate-900 border-y border-slate-800">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div
          ref={mobileNavRef}
          role="navigation"
          aria-label="Menu utama"
          className="relative flex items-center gap-1 overflow-x-auto py-1.5 scrollbar-none snap-x snap-mandatory"
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
                className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition shrink-0 snap-start ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
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
