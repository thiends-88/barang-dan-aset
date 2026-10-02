import React, { useState, useEffect } from 'react';
import { 
  DollarSign, 
  Package, 
  Users, 
  Network, 
  Radio, 
  ArrowDownLeft, 
  ArrowUpRight, 
  AlertTriangle, 
  TrendingUp, 
  Barcode as BarcodeIcon, 
  Plus, 
  FileText, 
  CheckCircle2, 
  Wifi, 
  Clock, 
  RefreshCw,
  ChevronRight,
  Wrench
} from 'lucide-react';
import { formatRupiah, formatNumber, formatDate } from '../utils/formatters';

export default function Dashboard({ 
  onNavigate, 
  onOpenScanner, 
  onRefreshAll 
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/reports/dashboard-summary');
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      }
    } catch (err) {
      console.error('Fetch dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (loading || !data) {
    return (
      <div className="py-24 text-center text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" />
        <p className="text-sm font-medium text-slate-600">Memuat data ringkasan inventaris...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero Executive Valuation Card */}
      <div className="relative overflow-hidden bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-8 rounded-3xl shadow-xl border border-indigo-900">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-20 w-72 h-72 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-400/30 text-indigo-300 text-xs font-semibold mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Sistem Terintegrasi Lini Divisi Pelanggan, FO & Tower
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white">
              Total Valuasi Barang & Aset Jaringan
            </h1>
            <div className="text-3xl sm:text-4xl font-extrabold text-white mt-2 tracking-tight">
              {formatRupiah(data.grand_total_valuation)}
            </div>
            <p className="text-xs sm:text-sm text-indigo-200 mt-2 max-w-xl">
              Akumulasi nilai seluruh aset fisik yang berada di Gudang Logistik, terpasang di seluruh Pelanggan, Jalur Titik FO, dan Site Menara BTS Wireless.
            </p>
          </div>

          {/* Quick Action Buttons on Hero */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onOpenScanner}
              className="px-5 py-3 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-2xl font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition transform hover:-translate-y-0.5"
            >
              <BarcodeIcon className="w-4 h-4" />
              <span>Scan Barcode / Cek Aset</span>
            </button>
            <button
              onClick={() => onNavigate('laporan')}
              className="px-5 py-3 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-2xl font-bold text-xs flex items-center gap-2 backdrop-blur-sm transition"
            >
              <FileText className="w-4 h-4" />
              <span>Laporan Lengkap</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4 Division KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gudang */}
        <div 
          onClick={() => onNavigate('master')}
          className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Gudang Logistik</span>
            <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-indigo-50 flex items-center justify-center text-slate-600 group-hover:text-indigo-600 transition">
              <Package className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900">
            {formatRupiah(data.warehouse.total_nilai)}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <span>{data.warehouse.total_skus} Item SKU</span>
            <span className="font-semibold text-slate-700">{formatNumber(data.warehouse.total_stok)} Unit</span>
          </div>
        </div>

        {/* Pelanggan */}
        <div 
          onClick={() => onNavigate('pelanggan')}
          className="bg-white p-5 rounded-2xl border border-blue-200/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-blue-700 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Divisi Pelanggan</span>
            <div className="w-10 h-10 rounded-xl bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center text-blue-600 transition">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-blue-950">
            {formatRupiah(data.pelanggan.total_nilai)}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <span className="text-blue-700 font-semibold">{data.pelanggan.total_pelanggan} Pelanggan</span>
            <span className="flex items-center gap-1 text-slate-600">
              Perangkat CPE
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* FO */}
        <div 
          onClick={() => onNavigate('fo')}
          className="bg-white p-5 rounded-2xl border border-emerald-200/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-emerald-700 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Divisi FO (Optik)</span>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 group-hover:bg-emerald-100 flex items-center justify-center text-emerald-600 transition">
              <Network className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-950">
            {formatRupiah(data.fo.total_nilai)}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <span className="text-emerald-700 font-semibold">{data.fo.total_sites} Titik ODP / ODC</span>
            <span className="flex items-center gap-1 text-slate-600">
              Kabel & Node
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>

        {/* Tower */}
        <div 
          onClick={() => onNavigate('tower')}
          className="bg-white p-5 rounded-2xl border border-purple-200/80 shadow-sm hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between text-purple-700 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Divisi Tower BTS</span>
            <div className="w-10 h-10 rounded-xl bg-purple-50 group-hover:bg-purple-100 flex items-center justify-center text-purple-600 transition">
              <Radio className="w-5 h-5" />
            </div>
          </div>
          <div className="text-2xl font-black text-purple-950">
            {formatRupiah(data.tower.total_nilai)}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-xs text-slate-500">
            <span className="text-purple-700 font-semibold">{data.tower.total_sites} Site Menara</span>
            <span className="flex items-center gap-1 text-slate-600">
              Radio & Section
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
        </div>
      </div>

      {/* Stok transit lapangan: barang yang sedang dibawa teknisi (Bon Teknisi aktif) */}
      {data.teknisi && (
        <div
          onClick={() => onNavigate('bonteknisi')}
          className="bg-white px-5 py-4 rounded-2xl border border-amber-200/80 shadow-sm hover:shadow-md transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-700">Dibawa Teknisi (Stok Transit Lapangan)</div>
              <div className="text-xs text-slate-500 mt-0.5">
                Barang yang sudah keluar dari gudang lewat Bon Teknisi dan belum dipasang / dikembalikan
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5 text-xs sm:text-right">
            <div>
              <div className="text-lg font-black text-amber-900">{formatRupiah(data.teknisi.nilai_transit)}</div>
              <div className="text-slate-500">nilai sedang dibawa</div>
            </div>
            <div>
              <div className="text-lg font-black text-slate-900">{data.teknisi.bon_berjalan}</div>
              <div className="text-slate-500">bon berjalan</div>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      )}

      {/* Grid: Low Stock Alert & Quick Operations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Low Stock Alert Warning Box */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-sm text-slate-800">Peringatan Stok Menipis</h3>
            </div>
            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
              {data.warehouse.low_stock_count} Item
            </span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2.5 max-h-72">
            {data.warehouse.low_stock_list.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
                <p className="font-semibold text-slate-700">Semua Stok Aman</p>
                <p>Tidak ada barang yang berada di bawah batas minimum.</p>
              </div>
            ) : (
              data.warehouse.low_stock_list.map((it) => (
                <div 
                  key={it.id} 
                  className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/80 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-900 block truncate max-w-[180px]">
                      {it.nama_barang}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">{it.kode_barang}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-rose-700 block">
                      Sisa: {it.stok} {it.satuan}
                    </span>
                    <span className="text-[10px] text-slate-400">Min: {it.min_stok} {it.satuan}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            onClick={() => onNavigate('master')}
            className="w-full mt-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-semibold border border-slate-200 transition"
          >
            Lihat & Tambah Stok di Master Barang
          </button>
        </div>

        {/* Right Column (span 2): Recent Transactions Feed */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-sm text-slate-800">Mutasi Transaksi Barang Terkini</h3>
            </div>
            <button
              onClick={() => onNavigate('transaksi')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
            >
              <span>Lihat Semua Mutasi</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <tr>
                  <th className="py-2 px-3">Tanggal</th>
                  <th className="py-2 px-3">Tipe</th>
                  <th className="py-2 px-3">Divisi / Penerima</th>
                  <th className="py-2 px-3">Barang</th>
                  <th className="py-2 px-3 text-right">Jumlah</th>
                  <th className="py-2 px-3 text-right">Nilai (Rp)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recent_transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-3 whitespace-nowrap text-slate-500">{formatDate(tx.tanggal)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                        tx.jenis === 'MASUK' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {tx.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {tx.jenis}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-800 truncate max-w-[140px]">
                      <span className="font-semibold text-slate-700">{tx.divisi}</span> • {tx.lokasi_penerima}
                    </td>
                    <td className="py-2.5 px-3 text-slate-900 font-medium truncate max-w-[160px]">
                      {tx.nama_barang}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-slate-800 whitespace-nowrap">
                      {formatNumber(tx.jumlah)} {tx.satuan}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-indigo-700 whitespace-nowrap">
                      {formatRupiah(tx.total_harga)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Monthly In vs Out Activity Graph Summary */}
      {data.monthly_trend && data.monthly_trend.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm text-slate-800">
                Aktivitas Arus Barang Masuk & Keluar per Bulan
              </h3>
              <p className="text-xs text-slate-400">
                Perbandingan kuantitas dan nilai pengeluaran vs penerimaan logistik
              </p>
            </div>
            <button
              onClick={() => onNavigate('laporan')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              Buka Filter Mingguan / Bulanan →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {data.monthly_trend.map((m, idx) => (
              <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                <div className="font-bold text-slate-800 text-sm flex items-center justify-between">
                  <span>Bulan {m.bulan}</span>
                </div>
                <div className="flex items-center justify-between text-emerald-700 bg-white p-2 rounded-lg border border-emerald-100">
                  <span className="flex items-center gap-1 font-semibold">
                    <ArrowDownLeft className="w-3.5 h-3.5" /> Masuk:
                  </span>
                  <span className="font-bold">{formatRupiah(m.nilai_masuk)} ({m.qty_masuk} unit)</span>
                </div>
                <div className="flex items-center justify-between text-rose-700 bg-white p-2 rounded-lg border border-rose-100">
                  <span className="flex items-center gap-1 font-semibold">
                    <ArrowUpRight className="w-3.5 h-3.5" /> Keluar:
                  </span>
                  <span className="font-bold">{formatRupiah(m.nilai_keluar)} ({m.qty_keluar} unit)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
