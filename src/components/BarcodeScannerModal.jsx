import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  Camera, 
  X, 
  Search, 
  Package, 
  Users, 
  Network, 
  Radio, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Printer, 
  AlertTriangle,
  CheckCircle2,
  Barcode as BarcodeIcon,
  RefreshCw
} from 'lucide-react';
import BarcodeRenderer from './BarcodeRenderer';
import { formatRupiah, formatNumber, formatDate } from '../utils/formatters';

export default function BarcodeScannerModal({ isOpen, onClose, onPrintBarcode, onStockAdjust }) {
  const [scanCode, setScanCode] = useState('');
  const [isScanningCamera, setIsScanningCamera] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [lookupData, setLookupData] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const html5QrCodeRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        if (inputRef.current) inputRef.current.focus();
      }, 100);

      // Check available cameras
      Html5Qrcode.getCameras()
        .then(devices => {
          if (devices && devices.length) {
            setCameras(devices);
            setSelectedCameraId(devices[0].id);
          }
        })
        .catch(err => {
          console.warn('No camera found or permission denied:', err);
        });
    } else {
      stopCamera();
      setLookupData(null);
      setErrorMsg('');
      setScanCode('');
    }

    return () => {
      stopCamera();
    };
  }, [isOpen]);

  const startCamera = async (cameraId) => {
    try {
      setErrorMsg('');
      setIsScanningCamera(true);

      const html5QrCode = new Html5Qrcode('barcode-camera-reader');
      html5QrCodeRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: { width: 280, height: 180 },
        aspectRatio: 1.777778
      };

      await html5QrCode.start(
        cameraId || { facingMode: 'environment' },
        config,
        (decodedText) => {
          console.log('Barcode scanned:', decodedText);
          handlePerformLookup(decodedText);
          // Play audio beep
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
          } catch {
            // Audio context not allowed or not supported
          }
          stopCamera();
        },
        (errorMessage) => {
          // Ignore scanning frame errors
        }
      );
    } catch (err) {
      console.error('Camera start error:', err);
      setErrorMsg('Gagal menyalakan kamera. Pastikan izin kamera telah diberikan di browser.');
      setIsScanningCamera(false);
    }
  };

  const stopCamera = async () => {
    if (html5QrCodeRef.current && isScanningCamera) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (e) {
        console.warn('Stop camera error:', e);
      }
      html5QrCodeRef.current = null;
      setIsScanningCamera(false);
    }
  };

  const handlePerformLookup = async (codeToSearch) => {
    const code = (codeToSearch || scanCode).trim();
    if (!code) return;

    setLoading(true);
    setErrorMsg('');
    setLookupData(null);

    try {
      const res = await fetch(`/api/scanner/lookup/${encodeURIComponent(code)}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.error || `Barang dengan kode barcode "${code}" tidak ditemukan`);
      } else {
        setLookupData(data.data);
        setScanCode(code);
      }
    } catch (err) {
      setErrorMsg('Gagal menghubungkan ke server.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handlePerformLookup();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-indigo-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/50 flex items-center justify-center border border-indigo-400/30">
              <BarcodeIcon className="w-6 h-6 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Pindai Barcode / Pelacakan Aset</h3>
              <p className="text-xs text-indigo-200">
                Pindai kode barcode untuk cek stok dan lokasi terpasang di Pelanggan, FO, dan Tower
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Camera Toolbar */}
        <div className="p-6 bg-slate-50 border-b border-slate-200">
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                placeholder="Scan dengan Barcode Gun USB atau ketik Kode Barang (cth: BRG-ONT-HG8546M)..."
                className="w-full pl-11 pr-4 py-3 bg-white border-2 border-indigo-200 focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 rounded-xl text-slate-900 font-mono text-sm tracking-wider uppercase placeholder:normal-case placeholder:font-sans shadow-sm transition"
              />
              <BarcodeIcon className="w-5 h-5 text-indigo-500 absolute left-3.5 top-3.5" />
            </div>

            <button
              type="submit"
              disabled={loading || !scanCode.trim()}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-50"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span>Cari Aset</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (isScanningCamera) {
                  stopCamera();
                } else {
                  startCamera(selectedCameraId);
                }
              }}
              className={`px-5 py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition ${
                isScanningCamera
                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200 shadow-sm'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-200 shadow-sm'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>{isScanningCamera ? 'Matikan Kamera' : 'Buka Kamera Scan'}</span>
            </button>
          </form>

          {/* Camera Viewport */}
          {isScanningCamera && (
            <div className="mt-4 p-4 bg-slate-900 rounded-xl border border-slate-800 flex flex-col items-center">
              <div className="w-full max-w-md overflow-hidden rounded-lg bg-black relative">
                <div id="barcode-camera-reader" className="w-full min-h-[220px]" />
                <div className="absolute inset-0 pointer-events-none border-2 border-emerald-400/40 rounded-lg flex items-center justify-center">
                  <div className="w-64 h-32 border-2 border-dashed border-emerald-400 rounded-lg animate-pulse" />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2 text-center">
                Arahkan kamera ke barcode / QR code perangkat. Sistem akan mendeteksi otomatis.
              </p>
              {cameras.length > 1 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-300">Pilih Kamera:</span>
                  <select
                    value={selectedCameraId}
                    onChange={(e) => {
                      setSelectedCameraId(e.target.value);
                      stopCamera();
                      startCamera(e.target.value);
                    }}
                    className="text-xs bg-slate-800 text-white border border-slate-700 rounded px-2 py-1"
                  >
                    {cameras.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label || `Camera ${c.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-sm">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Pencarian Tidak Ditemukan</p>
                <p className="text-xs mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {!lookupData && !loading && !errorMsg && (
            <div className="text-center py-12 text-slate-400">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center mx-auto mb-3 text-slate-400">
                <BarcodeIcon className="w-8 h-8" />
              </div>
              <h4 className="text-base font-semibold text-slate-700">Siap Memindai Barcode</h4>
              <p className="text-sm max-w-md mx-auto mt-1">
                Gunakan scanner barcode USB, kamera laptop/hp, atau ketik kode barang di atas untuk melihat detail stok dan sebaran pemasangan di seluruh divisi.
              </p>
            </div>
          )}

          {lookupData && (
            <div className="space-y-6 animate-fadeIn">
              {/* Item Profile Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                      <Package className="w-8 h-8 text-indigo-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-100 text-indigo-800">
                          {lookupData.item.jenis_barang}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-md font-mono bg-slate-100 text-slate-700">
                          {lookupData.item.kode_barang}
                        </span>
                      </div>
                      <h4 className="text-lg font-bold text-slate-900 mt-1">
                        {lookupData.item.nama_barang}
                      </h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Suplayer / Referensi: <span className="font-medium text-slate-700">{lookupData.item.referensi_suplayer || '-'}</span>
                      </p>
                      {lookupData.item.catatan && (
                        <p className="text-xs text-slate-500 italic mt-0.5">
                          "{lookupData.item.catatan}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col md:items-end gap-2 shrink-0">
                    <div className="text-left md:text-right">
                      <span className="text-xs text-slate-500 block">Harga Satuan:</span>
                      <span className="text-xl font-bold text-indigo-600">
                        {formatRupiah(lookupData.item.harga_barang)}
                      </span>
                      <span className="text-xs text-slate-400 block">/ {lookupData.item.satuan}</span>
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => onPrintBarcode && onPrintBarcode(lookupData.item)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg flex items-center gap-1.5 border border-slate-300 transition"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Cetak Label</span>
                      </button>
                      <button
                        onClick={() => onStockAdjust && onStockAdjust(lookupData.item)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-medium rounded-lg flex items-center gap-1.5 border border-indigo-200 transition"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Update Stok</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Rendered Barcode */}
                <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg">
                  <div className="text-center sm:text-left">
                    <span className="text-xs font-medium text-slate-600 block">Preview Barcode Code-128:</span>
                    <span className="text-[11px] text-slate-400">Dapat dipindai langsung dari layar monitor</span>
                  </div>
                  <div className="bg-white px-3 py-1.5 rounded border border-slate-200">
                    <BarcodeRenderer value={lookupData.item.kode_barang} width={1.4} height={36} fontSize={11} />
                  </div>
                </div>
              </div>

              {/* Distribution Metric Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between text-slate-500 mb-1">
                    <span className="text-xs font-medium">Stok Gudang</span>
                    <Package className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="text-xl font-bold text-slate-900">
                    {formatNumber(lookupData.distribution.gudang_stock)}{' '}
                    <span className="text-xs font-normal text-slate-500">{lookupData.item.satuan}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Min. stok: {lookupData.item.min_stok} {lookupData.item.satuan}
                  </div>
                </div>

                <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-200">
                  <div className="flex items-center justify-between text-blue-700 mb-1">
                    <span className="text-xs font-medium">Pelanggan</span>
                    <Users className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-xl font-bold text-blue-900">
                    {formatNumber(lookupData.distribution.installed_pelanggan)}{' '}
                    <span className="text-xs font-normal text-blue-600">{lookupData.item.satuan}</span>
                  </div>
                  <div className="text-[11px] text-blue-700 mt-0.5">
                    {lookupData.locations.pelanggan.length} Pelanggan
                  </div>
                </div>

                <div className="bg-emerald-50/60 p-3.5 rounded-xl border border-emerald-200">
                  <div className="flex items-center justify-between text-emerald-700 mb-1">
                    <span className="text-xs font-medium">Divisi FO</span>
                    <Network className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-xl font-bold text-emerald-900">
                    {formatNumber(lookupData.distribution.installed_fo)}{' '}
                    <span className="text-xs font-normal text-emerald-600">{lookupData.item.satuan}</span>
                  </div>
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    {lookupData.locations.fo.length} Titik FO
                  </div>
                </div>

                <div className="bg-purple-50/60 p-3.5 rounded-xl border border-purple-200">
                  <div className="flex items-center justify-between text-purple-700 mb-1">
                    <span className="text-xs font-medium">Divisi Tower</span>
                    <Radio className="w-4 h-4 text-purple-600" />
                  </div>
                  <div className="text-xl font-bold text-purple-900">
                    {formatNumber(lookupData.distribution.installed_tower)}{' '}
                    <span className="text-xs font-normal text-purple-600">{lookupData.item.satuan}</span>
                  </div>
                  <div className="text-[11px] text-purple-700 mt-0.5">
                    {lookupData.locations.tower.length} Site Tower
                  </div>
                </div>

                <div className="col-span-2 md:col-span-1 bg-indigo-50/80 p-3.5 rounded-xl border border-indigo-200">
                  <div className="flex items-center justify-between text-indigo-700 mb-1">
                    <span className="text-xs font-medium">Total Aset</span>
                    <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="text-xl font-bold text-indigo-950">
                    {formatNumber(lookupData.distribution.total_keseluruhan)}{' '}
                    <span className="text-xs font-normal text-indigo-700">{lookupData.item.satuan}</span>
                  </div>
                  <div className="text-[11px] text-indigo-700 font-semibold mt-0.5">
                    Valuasi: {formatRupiah(lookupData.distribution.total_nilai_aset)}
                  </div>
                </div>
              </div>

              {/* Exact Location Breakdown (Where is it installed?) */}
              <div className="space-y-4">
                <h5 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                  <span>Lokasi Terpasang Dimananya:</span>
                  <span className="text-xs font-normal text-slate-500">
                    (Rincian lengkap pelanggan dan site divisi yang menggunakan barang ini)
                  </span>
                </h5>

                {/* 1. Pelanggan */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="bg-blue-50/50 px-4 py-2.5 border-b border-blue-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-900 flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-600" />
                      Terpasang di Divisi Pelanggan ({lookupData.locations.pelanggan.length})
                    </span>
                    <span className="text-xs font-semibold text-blue-800">
                      Subtotal Terpasang: {formatNumber(lookupData.distribution.installed_pelanggan)} {lookupData.item.satuan}
                    </span>
                  </div>
                  {lookupData.locations.pelanggan.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Tidak ada barang ini yang terpasang di divisi pelanggan.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3">ID Pelanggan</th>
                            <th className="py-2 px-3">Nama Pelanggan</th>
                            <th className="py-2 px-3">Paket / Infra</th>
                            <th className="py-2 px-3">Status</th>
                            <th className="py-2 px-3">Alamat</th>
                            <th className="py-2 px-3 text-right">Jumlah</th>
                            <th className="py-2 px-3 text-right">Nilai Barang</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lookupData.locations.pelanggan.map((p, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3 font-mono font-medium text-indigo-700">{p.id_pelanggan}</td>
                              <td className="py-2.5 px-3 font-medium text-slate-900">{p.nama_pelanggan}</td>
                              <td className="py-2.5 px-3 capitalize">
                                <span className="font-semibold text-slate-700">{p.paket}</span>
                                <span className="text-slate-400"> ({p.infrastruktur})</span>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  p.status === 'aktif' ? 'bg-emerald-100 text-emerald-800' :
                                  p.status === 'blokir' ? 'bg-rose-100 text-rose-800' :
                                  p.status === 'cuti' ? 'bg-amber-100 text-amber-800' :
                                  'bg-slate-200 text-slate-700'
                                }`}>
                                  {p.status}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">{p.alamat || '-'}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                                {formatNumber(p.jumlah)} {p.satuan}
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-indigo-600">
                                {formatRupiah(p.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 2. Divisi FO */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="bg-emerald-50/50 px-4 py-2.5 border-b border-emerald-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-2">
                      <Network className="w-4 h-4 text-emerald-600" />
                      Terpasang di Divisi Fiber Optic (FO) ({lookupData.locations.fo.length})
                    </span>
                    <span className="text-xs font-semibold text-emerald-800">
                      Subtotal Terpasang: {formatNumber(lookupData.distribution.installed_fo)} {lookupData.item.satuan}
                    </span>
                  </div>
                  {lookupData.locations.fo.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Tidak ada barang ini yang terpasang di divisi FO.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3">Tipe</th>
                            <th className="py-2 px-3">Daerah / Titik Lokasi FO</th>
                            <th className="py-2 px-3">PIC Teknisi</th>
                            <th className="py-2 px-3">Tanggal Pasang</th>
                            <th className="py-2 px-3 text-right">Jumlah</th>
                            <th className="py-2 px-3 text-right">Nilai Barang</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lookupData.locations.fo.map((f, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-emerald-100 text-emerald-800 font-semibold">
                                  {f.tipe_lokasi}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-medium text-slate-900">{f.daerah_lokasi}</td>
                              <td className="py-2.5 px-3 text-slate-600">{f.pic_teknisi || '-'}</td>
                              <td className="py-2.5 px-3 text-slate-500">{formatDate(f.tanggal_pasang)}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                                {formatNumber(f.jumlah)} {f.satuan}
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-emerald-700">
                                {formatRupiah(f.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 3. Divisi Tower */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="bg-purple-50/50 px-4 py-2.5 border-b border-purple-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-900 flex items-center gap-2">
                      <Radio className="w-4 h-4 text-purple-600" />
                      Terpasang di Divisi Tower ({lookupData.locations.tower.length})
                    </span>
                    <span className="text-xs font-semibold text-purple-800">
                      Subtotal Terpasang: {formatNumber(lookupData.distribution.installed_tower)} {lookupData.item.satuan}
                    </span>
                  </div>
                  {lookupData.locations.tower.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Tidak ada barang ini yang terpasang di divisi Tower.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="py-2 px-3">Jenis & Type</th>
                            <th className="py-2 px-3">Daerah / Lokasi Site Tower</th>
                            <th className="py-2 px-3">Tinggi</th>
                            <th className="py-2 px-3">Kepemilikan</th>
                            <th className="py-2 px-3">PIC Teknisi</th>
                            <th className="py-2 px-3 text-right">Jumlah</th>
                            <th className="py-2 px-3 text-right">Nilai Barang</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lookupData.locations.tower.map((t, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="py-2.5 px-3">
                                <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-purple-100 text-purple-800 font-semibold uppercase">
                                  {t.jenis} - {t.type}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-medium text-slate-900">{t.daerah_lokasi}</td>
                              <td className="py-2.5 px-3 text-slate-600 font-medium">{t.ketinggian}</td>
                              <td className="py-2.5 px-3 text-slate-600">{t.kepemilikan}</td>
                              <td className="py-2.5 px-3 text-slate-600">{t.pic_teknisi || '-'}</td>
                              <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                                {formatNumber(t.jumlah)} {t.satuan}
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-purple-700">
                                {formatRupiah(t.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* 4. Riwayat Transaksi */}
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">
                      Riwayat Transaksi Keluar / Masuk Barang Ini ({lookupData.transactions.length})
                    </span>
                  </div>
                  {lookupData.transactions.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Belum ada catatan mutasi transaksi untuk barang ini.
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-52">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 sticky top-0">
                          <tr>
                            <th className="py-2 px-3">Tanggal</th>
                            <th className="py-2 px-3">No Transaksi</th>
                            <th className="py-2 px-3">Tipe</th>
                            <th className="py-2 px-3">Divisi / Lokasi</th>
                            <th className="py-2 px-3 text-right">Jumlah</th>
                            <th className="py-2 px-3">Keterangan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lookupData.transactions.map((tx, idx) => (
                            <tr key={idx} className="hover:bg-slate-50">
                              <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{formatDate(tx.tanggal)}</td>
                              <td className="py-2 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">{tx.no_transaksi}</td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                  tx.jenis === 'MASUK' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                                }`}>
                                  {tx.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                  {tx.jenis}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                                <span className="font-semibold">{tx.divisi}</span> - {tx.lokasi_penerima}
                              </td>
                              <td className="py-2 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                                {formatNumber(tx.jumlah)} {tx.satuan}
                              </td>
                              <td className="py-2 px-3 text-slate-500 truncate max-w-xs">{tx.keterangan || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl font-medium text-sm transition"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
