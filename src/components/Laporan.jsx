import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileText, 
  Calendar, 
  Download, 
  Printer, 
  Layers, 
  Package, 
  Users, 
  Network, 
  Radio, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Search, 
  DollarSign, 
  RefreshCw,
  FileSpreadsheet,
  Building,
  CheckCircle2
} from 'lucide-react';
import { formatRupiah, formatNumber, formatDate, exportToCSV } from '../utils/formatters';

const YEARS = [2026, 2025, 2024];
const MONTHS = [
  { val: '', label: 'Semua Bulan' },
  { val: '1', label: '01 - Januari' },
  { val: '2', label: '02 - Februari' },
  { val: '3', label: '03 - Maret' },
  { val: '4', label: '04 - April' },
  { val: '5', label: '05 - Mei' },
  { val: '6', label: '06 - Juni' },
  { val: '7', label: '07 - Juli' },
  { val: '8', label: '08 - Agustus' },
  { val: '9', label: '09 - September' },
  { val: '10', label: '10 - Oktober' },
  { val: '11', label: '11 - November' },
  { val: '12', label: '12 - Desember' }
];

export default function Laporan({ onRefreshData }) {
  const [activeTab, setActiveTab] = useState('mutasi'); // 'mutasi' | 'sebaran' | 'valuasi'

  // Mutasi Report State
  const [txData, setTxData] = useState([]);
  const [txSummary, setTxSummary] = useState(null);
  const [txLoading, setTxLoading] = useState(false);

  // Filters for Mutasi Report
  const [filterType, setFilterType] = useState('bulanan'); // 'mingguan' | 'bulanan' | 'tahunan' | 'kustom'
  const [year, setYear] = useState('2026');
  const [month, setMonth] = useState('9');
  const [week, setWeek] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [divisiFilter, setDivisiFilter] = useState('SEMUA');
  const [jenisFilter, setJenisFilter] = useState('');

  // Installed Assets Report State
  const [installedAssets, setInstalledAssets] = useState([]);
  const [installedLoading, setInstalledLoading] = useState(false);
  const [installedSearch, setInstalledSearch] = useState('');
  const [installedDivFilter, setInstalledDivFilter] = useState('');

  // Dashboard Valuation State
  const [valuationData, setValuationData] = useState(null);

  // Fetch Mutasi Transactions
  const fetchMutasiReport = async () => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams();
      if (divisiFilter && divisiFilter !== 'SEMUA') params.append('divisi', divisiFilter);
      if (jenisFilter) params.append('jenis', jenisFilter);

      if (filterType === 'tahunan') {
        params.append('year', year);
      } else if (filterType === 'bulanan') {
        params.append('year', year);
        if (month) params.append('month', month);
      } else if (filterType === 'mingguan') {
        params.append('year', year);
        params.append('month', month || '9');
        if (week) params.append('week', week);
      } else if (filterType === 'kustom') {
        if (customStart) params.append('start_date', customStart);
        if (customEnd) params.append('end_date', customEnd);
      }

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setTxData(data.data);
        setTxSummary(data.summary);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setTxLoading(false);
    }
  };

  // Fetch Installed Assets Report
  const fetchInstalledAssets = async () => {
    setInstalledLoading(true);
    try {
      const params = new URLSearchParams();
      if (installedSearch) params.append('search', installedSearch);
      if (installedDivFilter) params.append('divisi', installedDivFilter);

      const res = await fetch(`/api/reports/installed-assets?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setInstalledAssets(data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setInstalledLoading(false);
    }
  };

  // Fetch Valuation
  const fetchValuation = async () => {
    try {
      const res = await fetch('/api/reports/dashboard-summary');
      const data = await res.json();
      if (data.success) {
        setValuationData(data.data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchMutasiReport();
  }, [filterType, year, month, week, customStart, customEnd, divisiFilter, jenisFilter]);

  useEffect(() => {
    if (activeTab === 'sebaran') {
      fetchInstalledAssets();
    } else if (activeTab === 'valuasi') {
      fetchValuation();
    }
  }, [activeTab, installedSearch, installedDivFilter]);

  // Export Mutasi to CSV
  const handleExportMutasi = () => {
    if (!txData.length) return;
    const rows = txData.map((t, idx) => ({
      No: idx + 1,
      Tanggal: t.tanggal,
      Waktu: t.waktu,
      'No Transaksi': t.no_transaksi,
      Jenis: t.jenis,
      Kategori: t.kategori_transaksi,
      Divisi: t.divisi,
      'Penerima / Lokasi': t.lokasi_penerima,
      'Kode Barang': t.kode_barang,
      'Nama Barang': t.nama_barang,
      Qty: t.jumlah,
      Satuan: t.satuan,
      'Harga Satuan (Rp)': t.harga_satuan,
      'Total Nilai (Rp)': t.total_harga,
      Keterangan: t.keterangan
    }));
    exportToCSV(`Laporan_Barang_Masuk_Keluar_${filterType}_${year}.csv`, rows);
  };

  // Export Installed Assets to CSV
  const handleExportInstalled = () => {
    if (!installedAssets.length) return;
    const rows = installedAssets.map((a, idx) => ({
      No: idx + 1,
      'Kode Barang': a.kode_barang,
      'Nama Barang': a.nama_barang,
      Satuan: a.satuan,
      Kategori: a.jenis_barang,
      'Harga Satuan': a.harga_barang,
      'Stok di Gudang': a.stok_gudang,
      'Terpasang di Pelanggan': a.qty_pelanggan,
      'Terpasang di Divisi FO': a.qty_fo,
      'Terpasang di Divisi Tower': a.qty_tower,
      'Total Terpasang': a.total_terpasang,
      'Total Aset Keseluruhan': a.total_semua,
      'Nilai Gudang (Rp)': a.nilai_gudang,
      'Nilai Terpasang (Rp)': a.nilai_terpasang,
      'Total Nilai Aset (Rp)': a.nilai_total
    }));
    exportToCSV(`Laporan_Sebaran_Barang_Terpasang_${Date.now()}.csv`, rows);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation Header (No print) */}
      <div className="no-print bg-white p-2 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveTab('mutasi')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition ${
              activeTab === 'mutasi'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Laporan Barang Masuk & Keluar</span>
          </button>

          <button
            onClick={() => setActiveTab('sebaran')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition ${
              activeTab === 'sebaran'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Laporan Barang Terpasang Dimananya</span>
          </button>

          <button
            onClick={() => setActiveTab('valuasi')}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition ${
              activeTab === 'valuasi'
                ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-200'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <DollarSign className="w-4 h-4" />
            <span>Valuasi Aset per Divisi</span>
          </button>
        </div>

        <div className="flex items-center gap-2 pr-2">
          {activeTab === 'mutasi' && (
            <button
              onClick={handleExportMutasi}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 border border-slate-300 transition"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Export CSV</span>
            </button>
          )}

          {activeTab === 'sebaran' && (
            <button
              onClick={handleExportInstalled}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 border border-slate-300 transition"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span>Export CSV</span>
            </button>
          )}

          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Print PDF</span>
          </button>
        </div>
      </div>

      {/* Printable Report Header */}
      <div className="print-only mb-6 text-center border-b-2 border-slate-800 pb-4">
        <h1 className="text-xl font-black uppercase tracking-wider text-slate-900">
          SISTEM INFORMASI MANAJEMEN BARANG DAN ASET TERINTEGRASI
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Divisi Pelanggan • Divisi Fiber Optic (FO) • Divisi Tower & BTS Wireless • Gudang Logistik
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          Dicetak pada: {new Date().toLocaleString('id-ID')}
        </p>
      </div>

      {/* ==================================================== */}
      {/* TAB 1: LAPORAN BARANG MASUK & KELUAR                 */}
      {/* ==================================================== */}
      {activeTab === 'mutasi' && (
        <div className="space-y-6">
          {/* Filter Bar (No print) */}
          <div className="no-print bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Pilih Periode:</span>
                <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs">
                  <button
                    onClick={() => setFilterType('mingguan')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                      filterType === 'mingguan' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Per Minggu
                  </button>
                  <button
                    onClick={() => setFilterType('bulanan')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                      filterType === 'bulanan' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Per Bulan
                  </button>
                  <button
                    onClick={() => setFilterType('tahunan')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                      filterType === 'tahunan' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Per Tahun
                  </button>
                  <button
                    onClick={() => setFilterType('kustom')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                      filterType === 'kustom' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Rentang Bebas
                  </button>
                </div>
              </div>

              {/* Divisi & Jenis Filter */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={divisiFilter}
                  onChange={(e) => setDivisiFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
                >
                  <option value="SEMUA">Semua Divisi Terkait</option>
                  <option value="PELANGGAN">Divisi Pelanggan</option>
                  <option value="DIVISI FO">Divisi FO</option>
                  <option value="DIVISI TOWER">Divisi Tower</option>
                  <option value="GUDANG">Gudang Logistik</option>
                </select>

                <select
                  value={jenisFilter}
                  onChange={(e) => setJenisFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
                >
                  <option value="">Semua (Masuk & Keluar)</option>
                  <option value="MASUK">Hanya Barang Masuk</option>
                  <option value="KELUAR">Hanya Barang Keluar</option>
                </select>
              </div>
            </div>

            {/* Dynamic Period Dropdowns */}
            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 text-xs">
              {filterType === 'mingguan' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-600">Tahun:</span>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                    >
                      {YEARS.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-600">Bulan:</span>
                    <select
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                    >
                      {MONTHS.filter(m => m.val).map((m) => (
                        <option key={m.val} value={m.val}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-600">Minggu Ke:</span>
                    <select
                      value={week}
                      onChange={(e) => setWeek(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-indigo-700"
                    >
                      <option value="">Semua Minggu di Bulan Ini</option>
                      <option value="1">Minggu 1 (Tanggal 1 - 7)</option>
                      <option value="2">Minggu 2 (Tanggal 8 - 14)</option>
                      <option value="3">Minggu 3 (Tanggal 15 - 21)</option>
                      <option value="4">Minggu 4 (Tanggal 22 - 28)</option>
                      <option value="5">Minggu 5 (Tanggal 29 - Akhir)</option>
                    </select>
                  </div>
                </>
              )}

              {filterType === 'bulanan' && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-600">Tahun:</span>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                    >
                      {YEARS.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-600">Bulan:</span>
                    <select
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-indigo-700"
                    >
                      {MONTHS.map((m) => (
                        <option key={m.val} value={m.val}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {filterType === 'tahunan' && (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-600">Pilih Tahun:</span>
                  <select
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-indigo-700"
                  >
                    {YEARS.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}

              {filterType === 'kustom' && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-600">Dari:</span>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                  />
                  <span className="font-semibold text-slate-600">Sampai:</span>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
              )}
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">Total Transaksi</span>
              <div className="text-xl font-bold text-slate-900 mt-1">
                {formatNumber(txSummary?.total_transaksi || 0)} <span className="text-xs font-normal text-slate-500">Mutasi</span>
              </div>
            </div>

            <div className="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm">
              <span className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wider block">Barang Masuk</span>
              <div className="text-xl font-bold text-emerald-950 mt-1">
                {formatNumber(txSummary?.total_masuk_qty || 0)} <span className="text-xs font-normal text-emerald-700">Unit</span>
              </div>
              <span className="text-[11px] font-bold text-emerald-700 block mt-0.5">
                {formatRupiah(txSummary?.total_masuk_nilai || 0)}
              </span>
            </div>

            <div className="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-sm">
              <span className="text-[11px] font-semibold text-rose-800 uppercase tracking-wider block">Barang Keluar</span>
              <div className="text-xl font-bold text-rose-950 mt-1">
                {formatNumber(txSummary?.total_keluar_qty || 0)} <span className="text-xs font-normal text-rose-700">Unit</span>
              </div>
              <span className="text-[11px] font-bold text-rose-700 block mt-0.5">
                {formatRupiah(txSummary?.total_keluar_nilai || 0)}
              </span>
            </div>

            <div className="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 shadow-sm">
              <span className="text-[11px] font-semibold text-indigo-800 uppercase tracking-wider block">Net Saldo Mutasi</span>
              <div className={`text-xl font-bold mt-1 ${(txSummary?.net_qty || 0) >= 0 ? 'text-indigo-950' : 'text-rose-900'}`}>
                {formatNumber(txSummary?.net_qty || 0)} <span className="text-xs font-normal text-indigo-700">Unit</span>
              </div>
              <span className="text-[11px] font-bold text-indigo-800 block mt-0.5">
                {formatRupiah(txSummary?.net_nilai || 0)}
              </span>
            </div>
          </div>

          {/* Visual Ratio & Division Breakdown Bar */}
          {txSummary && (txSummary.total_masuk_qty > 0 || txSummary.total_keluar_qty > 0) && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">Rasio Pergerakan Barang Periode Ini:</span>
                <span className="text-slate-500">
                  Total Volume Mutasi: {formatNumber(txSummary.total_masuk_qty + txSummary.total_keluar_qty)} Unit
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                <div
                  style={{
                    width: `${Math.round((txSummary.total_masuk_qty / ((txSummary.total_masuk_qty + txSummary.total_keluar_qty) || 1)) * 100)}%`
                  }}
                  className="bg-emerald-500 h-full transition-all"
                  title={`Barang Masuk: ${txSummary.total_masuk_qty} unit`}
                />
                <div
                  style={{
                    width: `${Math.round((txSummary.total_keluar_qty / ((txSummary.total_masuk_qty + txSummary.total_keluar_qty) || 1)) * 100)}%`
                  }}
                  className="bg-rose-500 h-full transition-all"
                  title={`Barang Keluar: ${txSummary.total_keluar_qty} unit`}
                />
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  Barang Masuk: {Math.round((txSummary.total_masuk_qty / ((txSummary.total_masuk_qty + txSummary.total_keluar_qty) || 1)) * 100)}% ({formatNumber(txSummary.total_masuk_qty)} unit)
                </span>
                <span className="text-rose-700 font-bold flex items-center gap-1.5">
                  Barang Keluar: {Math.round((txSummary.total_keluar_qty / ((txSummary.total_masuk_qty + txSummary.total_keluar_qty) || 1)) * 100)}% ({formatNumber(txSummary.total_keluar_qty)} unit)
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                </span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">
                  Laporan Rincian Keluar Masuk Barang
                </h3>
                <p className="text-xs text-slate-500">
                  Periode: {filterType.toUpperCase()} ({year} {month ? `Bulan ${month}` : ''} {week ? `Minggu ${week}` : ''}) • Divisi: {divisiFilter}
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {txData.length} Catatan Ditemukan
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] print:min-w-0 text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold uppercase">
                  <tr>
                    <th className="py-2.5 px-3">Tanggal</th>
                    <th className="py-2.5 px-3">No Transaksi</th>
                    <th className="py-2.5 px-3">Tipe</th>
                    <th className="py-2.5 px-3">Divisi</th>
                    <th className="py-2.5 px-3">Penerima / Lokasi Terkait</th>
                    <th className="py-2.5 px-3">Kode & Nama Barang</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Harga Satuan</th>
                    <th className="py-2.5 px-3 text-right">Total Nilai (Rp)</th>
                    <th className="py-2.5 px-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {txLoading ? (
                    <tr>
                      <td colSpan="10" className="py-8 text-center text-slate-400">
                        Memuat data laporan...
                      </td>
                    </tr>
                  ) : txData.length === 0 ? (
                    <tr>
                      <td colSpan="10" className="py-8 text-center text-slate-400">
                        Tidak ada transaksi mutasi pada periode yang dipilih.
                      </td>
                    </tr>
                  ) : (
                    txData.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-700">{formatDate(t.tanggal)}</td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">{t.no_transaksi}</td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            t.jenis === 'MASUK' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                          }`}>
                            {t.jenis}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-700">{t.divisi}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-900 truncate max-w-xs">{t.lokasi_penerima}</td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900 truncate max-w-xs">{t.nama_barang}</div>
                          <div className="text-[10px] font-mono text-indigo-700">{t.kode_barang}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                          {formatNumber(t.jumlah)} {t.satuan}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">
                          {formatRupiah(t.harga_satuan)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-indigo-700 whitespace-nowrap">
                          {formatRupiah(t.total_harga)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500 max-w-xs truncate">{t.keterangan || '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* TAB 2: LAPORAN SEBARAN BARANG TERPASANG DIMANANYA    */}
      {/* ==================================================== */}
      {activeTab === 'sebaran' && (
        <div className="space-y-6">
          {/* Header Info Banner */}
          <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-5 rounded-2xl shadow-sm">
            <h3 className="font-bold text-base flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-300" />
              <span>Laporan Posisi Barang Terpasang Dimananya di Seluruh Divisi</span>
            </h3>
            <p className="text-xs text-indigo-200 mt-1 max-w-2xl">
              Menampilkan matriks pelacakan lokasi setiap barang: berapa unit sisa di gudang, di pelanggan mana saja terpasang, di titik FO mana saja terpasang, dan di site tower mana saja terpasang.
            </p>
          </div>

          {/* Search & Filter Toolbar */}
          <div className="no-print bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md w-full">
              <input
                type="text"
                placeholder="Cari kode atau nama barang terpasang..."
                value={installedSearch}
                onChange={(e) => setInstalledSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-semibold text-slate-600">Filter Divisi:</span>
              <select
                value={installedDivFilter}
                onChange={(e) => setInstalledDivFilter(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700"
              >
                <option value="">Semua Divisi Terpasang</option>
                <option value="PELANGGAN">Hanya yang Terpasang di Pelanggan</option>
                <option value="DIVISI FO">Hanya yang Terpasang di FO</option>
                <option value="DIVISI TOWER">Hanya yang Terpasang di Tower</option>
                <option value="GUDANG">Hanya yang Ada Stok di Gudang</option>
              </select>
            </div>
          </div>

          {/* Comprehensive Table Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] print:min-w-0 text-left text-xs">
                <thead className="bg-slate-900 text-white uppercase text-[11px] font-semibold">
                  <tr>
                    <th className="py-3 px-3">Kode & Barang</th>
                    <th className="py-3 px-3 text-right">Gudang</th>
                    <th className="py-3 px-3">Di Pelanggan Mana Terpasang?</th>
                    <th className="py-3 px-3">Di Titik FO Mana Terpasang?</th>
                    <th className="py-3 px-3">Di Site Tower Mana Terpasang?</th>
                    <th className="py-3 px-3 text-right">Total Unit</th>
                    <th className="py-3 px-3 text-right">Total Nilai Aset</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {installedLoading ? (
                    <tr>
                      <td colSpan="7" className="py-12 text-center text-slate-400">
                        Memuat data sebaran barang...
                      </td>
                    </tr>
                  ) : installedAssets.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-12 text-center text-slate-400">
                        Tidak ada data barang yang cocok.
                      </td>
                    </tr>
                  ) : (
                    installedAssets.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 transition">
                        {/* Kode & Nama */}
                        <td className="py-3 px-3 min-w-[200px]">
                          <div className="font-bold text-slate-900">{item.nama_barang}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-indigo-700 font-semibold">{item.kode_barang}</span>
                            <span className="text-slate-300">•</span>
                            <span className="text-slate-500">{formatRupiah(item.harga_barang)}</span>
                          </div>
                        </td>

                        {/* Stok Gudang */}
                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          <span className="px-2 py-1 rounded bg-slate-100 font-bold text-slate-800">
                            {formatNumber(item.stok_gudang)} {item.satuan}
                          </span>
                        </td>

                        {/* Pelanggan Breakdown */}
                        <td className="py-3 px-3 min-w-[220px]">
                          <div className="font-bold text-blue-900 mb-1">
                            {formatNumber(item.qty_pelanggan)} {item.satuan} ({item.detail_pelanggan.length} Klien)
                          </div>
                          {item.detail_pelanggan.length > 0 ? (
                            <ul className="space-y-1 text-[11px] text-slate-600">
                              {item.detail_pelanggan.map((cp, idx) => (
                                <li key={idx} className="flex items-center justify-between border-b border-slate-100 pb-0.5">
                                  <span className="truncate max-w-[150px] font-medium" title={cp.nama_pelanggan}>
                                    • {cp.nama_pelanggan}
                                  </span>
                                  <span className="font-mono text-blue-700 font-bold ml-1">
                                    {cp.jumlah} {cp.satuan}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">- Tidak ada -</span>
                          )}
                        </td>

                        {/* FO Breakdown */}
                        <td className="py-3 px-3 min-w-[220px]">
                          <div className="font-bold text-emerald-900 mb-1">
                            {formatNumber(item.qty_fo)} {item.satuan} ({item.detail_fo.length} Titik)
                          </div>
                          {item.detail_fo.length > 0 ? (
                            <ul className="space-y-1 text-[11px] text-slate-600">
                              {item.detail_fo.map((fo, idx) => (
                                <li key={idx} className="flex items-center justify-between border-b border-slate-100 pb-0.5">
                                  <span className="truncate max-w-[150px] font-medium" title={fo.daerah_lokasi}>
                                    • {fo.daerah_lokasi}
                                  </span>
                                  <span className="font-mono text-emerald-700 font-bold ml-1">
                                    {fo.jumlah} {fo.satuan}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">- Tidak ada -</span>
                          )}
                        </td>

                        {/* Tower Breakdown */}
                        <td className="py-3 px-3 min-w-[220px]">
                          <div className="font-bold text-purple-900 mb-1">
                            {formatNumber(item.qty_tower)} {item.satuan} ({item.detail_tower.length} Site)
                          </div>
                          {item.detail_tower.length > 0 ? (
                            <ul className="space-y-1 text-[11px] text-slate-600">
                              {item.detail_tower.map((tw, idx) => (
                                <li key={idx} className="flex items-center justify-between border-b border-slate-100 pb-0.5">
                                  <span className="truncate max-w-[150px] font-medium" title={tw.daerah_lokasi}>
                                    • {tw.daerah_lokasi}
                                  </span>
                                  <span className="font-mono text-purple-700 font-bold ml-1">
                                    {tw.jumlah} {tw.satuan}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-slate-400 text-[11px] italic">- Tidak ada -</span>
                          )}
                        </td>

                        {/* Total Unit */}
                        <td className="py-3 px-3 text-right whitespace-nowrap font-black text-slate-900">
                          {formatNumber(item.total_semua)} {item.satuan}
                        </td>

                        {/* Total Nilai Aset */}
                        <td className="py-3 px-3 text-right whitespace-nowrap font-black text-indigo-700">
                          {formatRupiah(item.nilai_total)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
              <span>Menampilkan sebaran {installedAssets.length} barang inventaris</span>
              <span className="font-bold text-slate-800">
                Grand Total Valuasi: {formatRupiah(installedAssets.reduce((a, b) => a + b.nilai_total, 0))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================== */}
      {/* TAB 3: VALUASI ASET PER DIVISI                       */}
      {/* ==================================================== */}
      {activeTab === 'valuasi' && valuationData && (
        <div className="space-y-6">
          {/* Grand Total Valuation Hero */}
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-6 rounded-2xl shadow-md border border-indigo-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <span className="text-xs uppercase tracking-widest text-indigo-300 font-bold">
                REKAPITULASI VALUASI ASET TERPADU
              </span>
              <h2 className="text-3xl font-black mt-1 text-white">
                {formatRupiah(valuationData.grand_total_valuation)}
              </h2>
              <p className="text-xs text-indigo-200 mt-1">
                Total kekayaan aset barang fisik di Gudang Pusat, Jaringan Pelanggan, Jalur FO, dan Site Menara BTS.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrint}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow transition"
              >
                Cetak Lembar Valuasi
              </button>
            </div>
          </div>

          {/* 4 Division Valuation Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Gudang */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between text-slate-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Gudang Logistik</span>
                <Package className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="text-2xl font-black text-slate-900">
                {formatRupiah(valuationData.warehouse.total_nilai)}
              </div>
              <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                <div>• SKU Terdaftar: <strong className="text-slate-800">{valuationData.warehouse.total_skus} Item</strong></div>
                <div>• Total Stok Fisik: <strong className="text-slate-800">{formatNumber(valuationData.warehouse.total_stok)} Unit</strong></div>
              </div>
            </div>

            {/* Pelanggan */}
            <div className="bg-white p-5 rounded-2xl border border-blue-200 shadow-sm">
              <div className="flex items-center justify-between text-blue-700 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Divisi Pelanggan</span>
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-2xl font-black text-blue-950">
                {formatRupiah(valuationData.pelanggan.total_nilai)}
              </div>
              <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                <div>• Total Klien: <strong className="text-slate-800">{valuationData.pelanggan.total_pelanggan} Pelanggan</strong></div>
                <div>• Modem, Router, Dropcore terpasang</div>
              </div>
            </div>

            {/* FO */}
            <div className="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm">
              <div className="flex items-center justify-between text-emerald-700 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Divisi FO (Fiber)</span>
                <Network className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-emerald-950">
                {formatRupiah(valuationData.fo.total_nilai)}
              </div>
              <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                <div>• Titik Terpasang: <strong className="text-slate-800">{valuationData.fo.total_sites} Node Lokasi</strong></div>
                <div>• ODC, ODP, Joint Closure, Patchcord</div>
              </div>
            </div>

            {/* Tower */}
            <div className="bg-white p-5 rounded-2xl border border-purple-200 shadow-sm">
              <div className="flex items-center justify-between text-purple-700 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Divisi Tower</span>
                <Radio className="w-5 h-5 text-purple-600" />
              </div>
              <div className="text-2xl font-black text-purple-950">
                {formatRupiah(valuationData.tower.total_nilai)}
              </div>
              <div className="text-xs text-slate-500 mt-2 space-y-0.5">
                <div>• Menara / Site: <strong className="text-slate-800">{valuationData.tower.total_sites} Titik Site</strong></div>
                <div>• Radio BTS, Triangle, Monopole, UPS</div>
              </div>
            </div>
          </div>

          {/* Printable Signature Section */}
          <div className="print-only mt-12 pt-8 border-t border-slate-300">
            <div className="grid grid-cols-3 text-center text-xs text-slate-700">
              <div>
                <p className="font-semibold">Dibuat Oleh,</p>
                <div className="h-20" />
                <p className="font-bold underline">( Staff Logistik & Inventaris )</p>
              </div>
              <div>
                <p className="font-semibold">Diperiksa Oleh,</p>
                <div className="h-20" />
                <p className="font-bold underline">( Manager Operasional Teknis )</p>
              </div>
              <div>
                <p className="font-semibold">Disetujui Oleh,</p>
                <div className="h-20" />
                <p className="font-bold underline">( Direktur Operasional )</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
