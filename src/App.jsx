import React, { useState, useEffect, useCallback } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import MasterBarang from './components/MasterBarang';
import DivisiPelanggan from './components/DivisiPelanggan';
import DivisiFO from './components/DivisiFO';
import DivisiTower from './components/DivisiTower';
import KeluarMasukBarang from './components/KeluarMasukBarang';
import Laporan from './components/Laporan';
import BarcodeScannerModal from './components/BarcodeScannerModal';
import BarcodeLabelModal from './components/BarcodeLabelModal';
import { RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [foSites, setFoSites] = useState([]);
  const [towerSites, setTowerSites] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [itemForLabel, setItemForLabel] = useState(null);
  const [isResetting, setIsResetting] = useState(false);

  // Toast / notification
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

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
    loadAllData();
  }, [loadAllData]);

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

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans text-slate-800 antialiased selection:bg-indigo-500 selection:text-white">
      {/* Toast Alert Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl shadow-2xl border border-slate-700 animate-slideUp text-xs font-medium">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onOpenScanner={() => setIsScannerOpen(true)}
        onResetSeed={handleResetSeed}
        isResetting={isResetting}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-400">
            <RefreshCw className="w-10 h-10 animate-spin text-indigo-600 mb-3" />
            <p className="text-sm font-semibold text-slate-700">Memuat Sistem Barang & Aset Terpadu...</p>
            <p className="text-xs text-slate-400 mt-1">Menghubungkan ke database terintegrasi</p>
          </div>
        ) : (
          <>
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
              />
            )}

            {currentTab === 'pelanggan' && (
              <DivisiPelanggan
                customers={customers}
                items={items}
                onRefresh={loadAllData}
                onOpenBarcodeModal={handleOpenBarcodeLabel}
              />
            )}

            {currentTab === 'fo' && (
              <DivisiFO
                foSites={foSites}
                items={items}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === 'tower' && (
              <DivisiTower
                towerSites={towerSites}
                items={items}
                onRefresh={loadAllData}
              />
            )}

            {currentTab === 'transaksi' && (
              <KeluarMasukBarang
                items={items}
                onRefreshMaster={loadAllData}
              />
            )}

            {currentTab === 'laporan' && (
              <Laporan
                onRefreshData={loadAllData}
              />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="no-print bg-white border-t border-slate-200 py-6 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">SIM-ASET ISP</span>
            <span>•</span>
            <span>Sistem Terintegrasi Pelanggan, Divisi FO, Divisi Tower & Barcode Scanner</span>
          </div>
          <div className="text-slate-400">
            Database SQLite Terpusat • Realtime Stock Mutation Tracking
          </div>
        </div>
      </footer>

      {/* Barcode Scanner Modal (Webcam + USB Barcode Gun) */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onPrintBarcode={(item) => {
          setIsScannerOpen(false);
          handleOpenBarcodeLabel(item);
        }}
        onStockAdjust={(item) => {
          setIsScannerOpen(false);
          setCurrentTab('master');
        }}
      />

      {/* Barcode Label Print Modal */}
      <BarcodeLabelModal
        isOpen={isLabelModalOpen}
        onClose={() => {
          setIsLabelModalOpen(false);
          setItemForLabel(null);
        }}
        item={itemForLabel}
      />
    </div>
  );
}
