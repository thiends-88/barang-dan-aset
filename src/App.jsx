import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import LoginPage from './components/LoginPage';
import VersionBadge from './components/VersionBadge';
import { subscribe, notify } from './utils/notify';
import {
  getSession,
  saveSession,
  clearSession,
  installAuthFetch,
  canAccessMenu,
  canManageInventory,
  canManageDivisions,
  canManageBon,
  canInstallFromBon
} from './utils/auth';
import { RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

// Semua halaman/tab selain Dashboard dimuat malas (React.lazy): masing-masing menjadi
// chunk JS terpisah yang baru diunduh saat tab/modal dibuka, supaya bundle awal
// (yang diunduh setiap kunjungan) tetap kecil. Dashboard dibiarkan eager karena
// merupakan halaman pertama yang selalu tampil setelah login.
const MasterBarang = lazy(() => import('./components/MasterBarang'));
const DivisiPelanggan = lazy(() => import('./components/DivisiPelanggan'));
const DivisiFO = lazy(() => import('./components/DivisiFO'));
const DivisiTower = lazy(() => import('./components/DivisiTower'));
const KeluarMasukBarang = lazy(() => import('./components/KeluarMasukBarang'));
const Laporan = lazy(() => import('./components/Laporan'));
const BonTeknisi = lazy(() => import('./components/BonTeknisi'));
const BarangRusak = lazy(() => import('./components/BarangRusak'));
const UserManagement = lazy(() => import('./components/UserManagement'));

// Modal label barcode menarik jsbarcode (via BarcodeRenderer) — cukup besar,
// jadi ikut dimuat malas sama seperti pemindai kamera di bawah.
const BarcodeLabelModal = lazy(() => import('./components/BarcodeLabelModal'));

// Pemindai barcode memuat library kamera yang besar (html5-qrcode),
// jadi baru diunduh saat pengguna benar-benar membuka pemindai.
const BarcodeScannerModal = lazy(() => import('./components/BarcodeScannerModal'));

// Fallback ringan saat chunk halaman sedang diunduh (dipakai <Suspense> di bawah)
function TabLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
      <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
      <p className="text-xs font-semibold text-slate-600">Memuat halaman...</p>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => getSession());
  const [currentTab, setCurrentTabRaw] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [foSites, setFoSites] = useState([]);
  const [towerSites, setTowerSites] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [itemForLabel, setItemForLabel] = useState(null);
  const [itemToAdjust, setItemToAdjust] = useState(null);
  const [isResetting, setIsResetting] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');

  const userRole = session?.user?.role;

  // Ganti tab dengan penjagaan sesuai peran (mencegah akses lewat state lama)
  const setCurrentTab = useCallback((tab) => {
    setCurrentTabRaw((prev) => (canAccessMenu(tab, userRole) ? tab : prev));
  }, [userRole]);

  // Pasang penambal fetch sekali: otomatis sertakan token & re-login bila 401
  useEffect(() => {
    installAuthFetch(
      () => {
        setSession(null);
        setCurrentTabRaw('dashboard');
        setLoginNotice('Sesi Anda berakhir (server dimulai ulang atau token kedaluwarsa). Silakan login kembali.');
      },
      () => {
        // 401 palsu dari gateway (sandbox bangun tidur) — sesi aman, beri tahu saja
        notify('Koneksi ke server tersendat sesaat. Bila data belum muncul, muat ulang halaman.', 'error');
      }
    );
  }, []);

  // Bila peran dibatasi, kembalikan ke dashboard saat tab aktif tidak diizinkan
  useEffect(() => {
    if (session && !canAccessMenu(currentTab, userRole)) {
      setCurrentTabRaw('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  const handleLogin = useCallback((token, user) => {
    saveSession(token, user);
    setSession({ token, user });
    setCurrentTabRaw('dashboard');
    setLoginNotice('');
    notify(`Selamat datang, ${user.nama_lengkap}!`);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch { /* abaikan — logout lokal tetap jalan */ }
    clearSession();
    setSession(null);
    setCurrentTabRaw('dashboard');
    setLoginNotice('');
  }, []);

  // Toast / notification
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    clearTimeout(toastTimer.current);
    // Pesan error dibiarkan lebih lama karena biasanya lebih panjang & penting
    toastTimer.current = setTimeout(() => setToast(null), type === 'error' ? 7000 : 4000);
  }, []);

  // Komponen lain bisa memanggil notify() tanpa perlu menerima prop
  useEffect(() => {
    const unsubscribe = subscribe(({ message, type }) => showToast(message, type));
    return () => {
      unsubscribe();
      clearTimeout(toastTimer.current);
    };
  }, [showToast]);

  // Load all master and division records
  const loadAllData = useCallback(async () => {
    try {
      const [resItems, resCust, resFO, resTower] = await Promise.all([
        fetch('/api/items').then(r => r.json()),
        fetch('/api/customers').then(r => r.json()),
        fetch('/api/fo').then(r => r.json()),
        fetch('/api/tower').then(r => r.json())
      ]);

      if (resItems.success) setItems(resItems.data);
      if (resCust.success) setCustomers(resCust.data);
      if (resFO.success) setFoSites(resFO.data);
      if (resTower.success) setTowerSites(resTower.data);
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      loadAllData();
    } else {
      setLoading(false);
    }
  }, [loadAllData, session]);

  // Open Barcode Label Modal
  const handleOpenBarcodeLabel = (item) => {
    setItemForLabel(item);
    setIsLabelModalOpen(true);
  };

  // Reset / Reseed Demo Data
  const handleResetSeed = async () => {
    if (!window.confirm('Reset data simulasi dan isi ulang contoh komprehensif ISP (Modem, FO, Tower)? Data custom yang belum disimpan akan ter-reset.')) {
      return;
    }

    setIsResetting(true);
    try {
      const res = await fetch('/api/reset-seed', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Data berhasil direset dan diisi ulang dengan dataset simulasi ISP!', 'success');
        await loadAllData();
      }
    } catch (err) {
      showToast('Gagal mereset data: ' + err.message, 'error');
    } finally {
      setIsResetting(false);
    }
  };

  // Belum login → tampilkan halaman login (toast tetap aktif di atasnya)
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 font-sans antialiased">
        {toast && (
          <div
            role="status"
            className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-[60] flex items-start gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl shadow-2xl border text-xs font-medium sm:max-w-md ${
              toast.type === 'success' ? 'border-emerald-500/40' : 'border-rose-500/50'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className="leading-snug">{toast.message}</span>
          </div>
        )}
        <LoginPage onLogin={handleLogin} notice={loginNotice} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Toast Alert Notification */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:bottom-5 z-[60] flex items-start justify-center sm:justify-start gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl shadow-2xl border animate-slideUp text-xs font-medium sm:max-w-md sm:ml-auto ${
            toast.type === 'success' ? 'border-emerald-500/40' : 'border-rose-500/50'
          }`}
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span className="leading-snug">{toast.message}</span>
        </div>
      )}

      {/* Main Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenScanner={() => setIsScannerOpen(true)}
        onResetSeed={handleResetSeed}
        isResetting={isResetting}
        user={session.user}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-400">
            <RefreshCw className="w-10 h-10 animate-spin text-indigo-600 mb-3" />
            <p className="text-sm font-semibold text-slate-700">Memuat Sistem Barang & Aset Terpadu...</p>
            <p className="text-xs text-slate-400 mt-1">Menghubungkan ke database terintegrasi</p>
          </div>
        ) : (
          <Suspense fallback={<TabLoading />}>
            {currentTab === 'dashboard' && (
              <Dashboard
                onNavigate={setCurrentTab}
                onOpenScanner={() => setIsScannerOpen(true)}
                onRefreshAll={loadAllData}
              />
            )}

            {currentTab === 'master' && (
              <MasterBarang
                items={items}
                onRefresh={loadAllData}
                onOpenBarcodeModal={handleOpenBarcodeLabel}
                onOpenScanner={() => setIsScannerOpen(true)}
                itemToAdjust={itemToAdjust}
                onItemToAdjustHandled={() => setItemToAdjust(null)}
                canEdit={canManageInventory(userRole)}
              />
            )}

            {currentTab === 'pelanggan' && (
              <DivisiPelanggan
                customers={customers}
                items={items}
                onRefresh={loadAllData}
                onOpenBarcodeModal={handleOpenBarcodeLabel}
                canEdit={canManageDivisions(userRole)}
              />
            )}

            {currentTab === 'fo' && (
              <DivisiFO
                foSites={foSites}
                items={items}
                onRefresh={loadAllData}
                canEdit={canManageDivisions(userRole)}
              />
            )}

            {currentTab === 'tower' && (
              <DivisiTower
                towerSites={towerSites}
                items={items}
                onRefresh={loadAllData}
                canEdit={canManageDivisions(userRole)}
              />
            )}

            {currentTab === 'transaksi' && (
              <KeluarMasukBarang
                items={items}
                onRefreshMaster={loadAllData}
              />
            )}

            {currentTab === 'bonteknisi' && (
              <BonTeknisi
                items={items}
                customers={customers}
                foSites={foSites}
                towerSites={towerSites}
                onRefresh={loadAllData}
                canManage={canManageBon(userRole)}
                canInstall={canInstallFromBon(userRole)}
                currentUser={session.user}
              />
            )}

            {currentTab === 'rusak' && (
              <BarangRusak items={items} />
            )}

            {currentTab === 'laporan' && (
              <Laporan
                onRefreshData={loadAllData}
              />
            )}

            {currentTab === 'users' && userRole === 'admin' && (
              <UserManagement currentUser={session.user} />
            )}
          </Suspense>
        )}
      </main>

      {/* Footer */}
      <footer className="no-print bg-white border-t border-slate-200 py-5 sm:py-6 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-3 text-center sm:text-left">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">SIM-ASET ISP</span>
            <span>•</span>
            <span>Sistem Terintegrasi Pelanggan, Divisi FO, Divisi Tower & Barcode Scanner</span>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 text-slate-400">
            <span>Database SQLite Terpusat • Realtime Stock Mutation Tracking</span>
            <VersionBadge />
          </div>
        </div>
      </footer>

      {/* Barcode Scanner Modal (Webcam + USB Barcode Gun) */}
      {isScannerOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm">
              <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl shadow-xl border border-slate-200 text-xs font-semibold text-slate-700">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Memuat pemindai barcode...</span>
              </div>
            </div>
          }
        >
          <BarcodeScannerModal
            isOpen
            onClose={() => setIsScannerOpen(false)}
            onPrintBarcode={(item) => {
              setIsScannerOpen(false);
              handleOpenBarcodeLabel(item);
            }}
            onStockAdjust={(item) => {
              setIsScannerOpen(false);
              setItemToAdjust(item);
              setCurrentTab('master');
            }}
          />
        </Suspense>
      )}

      {/* Barcode Label Print Modal (lazy — menarik jsbarcode saat dibuka) */}
      {isLabelModalOpen && itemForLabel && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm">
              <div className="flex items-center gap-2 px-4 py-3 bg-white rounded-xl shadow-xl border border-slate-200 text-xs font-semibold text-slate-700">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                <span>Memuat label barcode...</span>
              </div>
            </div>
          }
        >
          <BarcodeLabelModal
            isOpen
            onClose={() => {
              setIsLabelModalOpen(false);
              setItemForLabel(null);
            }}
            item={itemForLabel}
          />
        </Suspense>
      )}
    </div>
  );
}
