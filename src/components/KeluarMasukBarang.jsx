import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  ArrowLeftRight, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Search, 
  Filter, 
  Plus, 
  Download, 
  Printer, 
  Calendar, 
  Building2, 
  Package, 
  RefreshCw,
  AlertTriangle,
  FileSpreadsheet,
  Camera,
  ScanLine
} from 'lucide-react';
import { formatRupiah, formatNumber, formatDate, exportToCSV, todayLocal } from '../utils/formatters';
import { notify } from '../utils/notify';

const DIVISI_OPTIONS = ['SEMUA', 'PELANGGAN', 'DIVISI FO', 'DIVISI TOWER', 'GUDANG'];
const CURRENT_YEAR = 2026;
const YEARS = [2026, 2025, 2024];
const MONTHS = [
  { val: '', label: 'Semua Bulan' },
  { val: '1', label: 'Januari' },
  { val: '2', label: 'Februari' },
  { val: '3', label: 'Maret' },
  { val: '4', label: 'April' },
  { val: '5', label: 'Mei' },
  { val: '6', label: 'Juni' },
  { val: '7', label: 'Juli' },
  { val: '8', label: 'Agustus' },
  { val: '9', label: 'September' },
  { val: '10', label: 'Oktober' },
  { val: '11', label: 'November' },
  { val: '12', label: 'Desember' }
];

export default function KeluarMasukBarang({ items, onRefreshMaster }) {
  const [transactions, setTransactions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedDivisi, setSelectedDivisi] = useState('SEMUA');
  const [selectedJenis, setSelectedJenis] = useState(''); // '' | 'MASUK' | 'KELUAR'
  const [filterMode, setFilterMode] = useState('period'); // 'period' | 'custom_range'
  const [selectedYear, setSelectedYear] = useState('2026');
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedWeek, setSelectedWeek] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Manual Transaction Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState({
    jenis: 'MASUK',
    kategori_transaksi: 'Pembelian Supplier',
    divisi: 'GUDANG',
    lokasi_penerima: '',
    kode_barang: '',
    jumlah: 1,
    tanggal: todayLocal(),
    keterangan: ''
  });
  const [modalError, setModalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mode tertaut divisi + scan barcode dari stiker di barang fisik
  const [tujuanList, setTujuanList] = useState([]);
  const [tujuanLoading, setTujuanLoading] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [isCameraOn, setIsCameraOn] = useState(false);
  const scanInputRef = useRef(null);
  const qtyInputRef = useRef(null);
  const html5QrRef = useRef(null);

  const DIVISI_LINK_LABEL = { PELANGGAN: 'Pelanggan', 'DIVISI FO': 'Divisi FO', 'DIVISI TOWER': 'Divisi Tower' };
  const TUJUAN_API = { PELANGGAN: '/api/customers', 'DIVISI FO': '/api/fo', 'DIVISI TOWER': '/api/tower' };
  const isLinkedMode = modalData.divisi !== 'GUDANG';
  const selectedItem = items.find((it) => it.kode_barang === modalData.kode_barang);
  const labelTujuan = (row) => {
    if (!row) return '';
    if (modalData.divisi === 'PELANGGAN') {
      return `${row.nama_pelanggan}${row.id_pelanggan ? ` (${row.id_pelanggan})` : ''}`;
    }
    if (modalData.divisi === 'DIVISI FO') {
      return `${row.daerah_lokasi}${row.tipe_lokasi ? ` — ${row.tipe_lokasi}` : ''}`;
    }
    return `${row.daerah_lokasi}${row.type ? ` — ${row.type}` : ''}`;
  };

  // Terapkan hasil scan: isi otomatis kolom Barang, lalu fokus ke kolom Jumlah
  const applyScannedCode = (raw) => {
    const kode = (raw || '').trim().toUpperCase();
    if (!kode) return;
    const found = items.find((it) => it.kode_barang.toUpperCase() === kode);
    if (!found) {
      setModalError(`Kode "${kode}" tidak terdaftar di Master Barang`);
      return;
    }
    setModalError('');
    setModalData((m) => ({ ...m, kode_barang: found.kode_barang }));
    notify(`Terdeteksi: ${found.kode_barang} — ${found.nama_barang}`, 'success');
    setTimeout(() => qtyInputRef.current?.focus(), 60);
  };

  const stopTxCamera = () => {
    const inst = html5QrRef.current;
    html5QrRef.current = null;
    setIsCameraOn(false);
    if (inst) {
      inst.stop().then(() => inst.clear().catch(() => {})).catch(() => {});
    }
  };

  const startTxCamera = async () => {
    try {
      setModalError('');
      setIsCameraOn(true);
      const html5 = new Html5Qrcode('scan-area-transaksi');
      html5QrRef.current = html5;
      await html5.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 160 }, aspectRatio: 1.777778 },
        (decoded) => {
          stopTxCamera();
          applyScannedCode(decoded);
        },
        () => {}
      );
    } catch (err) {
      console.error('Camera start error:', err);
      setIsCameraOn(false);
      setModalError('Gagal menyalakan kamera. Beri izin kamera di browser, atau gunakan scanner USB / ketik manual.');
    }
  };

  // Fetch transactions based on filters
  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (selectedDivisi && selectedDivisi !== 'SEMUA') params.append('divisi', selectedDivisi);
      if (selectedJenis) params.append('jenis', selectedJenis);

      if (filterMode === 'period') {
        if (selectedYear) params.append('year', selectedYear);
        if (selectedMonth) params.append('month', selectedMonth);
        if (selectedWeek) params.append('week', selectedWeek);
      } else {
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
      }

      const res = await fetch(`/api/transactions?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setTransactions(data.data);
        setSummary(data.summary);
      }
    } catch (err) {
      console.error('Fetch transactions error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Muat daftar tujuan (pelanggan / site) saat modal dibuka dengan divisi selain GUDANG
  useEffect(() => {
    if (!isModalOpen || modalData.divisi === 'GUDANG') {
      setTujuanList([]);
      return;
    }
    let batal = false;
    setTujuanLoading(true);
    fetch(TUJUAN_API[modalData.divisi])
      .then((r) => r.json())
      .then((j) => { if (!batal && j.success) setTujuanList(j.data || []); })
      .catch(() => {})
      .finally(() => { if (!batal) setTujuanLoading(false); });
    return () => { batal = true; };
  }, [isModalOpen, modalData.divisi]);

  // Pastikan kamera scan mati saat modal ditutup / komponen dilepas
  useEffect(() => {
    if (!isModalOpen) stopTxCamera();
    return () => stopTxCamera();
  }, [isModalOpen]);

  useEffect(() => {
    fetchTransactions();
  }, [
    search, 
    selectedDivisi, 
    selectedJenis, 
    filterMode, 
    selectedYear, 
    selectedMonth, 
    selectedWeek, 
    startDate, 
    endDate
  ]);

  // Handle Export CSV
  const handleExportCSV = () => {
    if (!transactions.length) return;
    const rows = transactions.map((t, idx) => ({
      No: idx + 1,
      Tanggal: t.tanggal,
      Waktu: t.waktu,
      'No Transaksi': t.no_transaksi,
      Jenis: t.jenis,
      Kategori: t.kategori_transaksi,
      Divisi: t.divisi,
      'Lokasi / Penerima / Suplayer': t.lokasi_penerima,
      'Kode Barang': t.kode_barang,
      'Nama Barang': t.nama_barang,
      Qty: t.jumlah,
      Satuan: t.satuan,
      'Harga Satuan': t.harga_satuan,
      'Total Nilai (Rp)': t.total_harga,
      Keterangan: t.keterangan
    }));
    exportToCSV(`Laporan_Keluar_Masuk_Barang_${Date.now()}.csv`, rows);
  };

  const handlePrint = () => {
    window.print();
  };

  // Open manual transaction modal
  const handleOpenModal = (jenis = 'MASUK') => {
    setModalData({
      jenis,
      kategori_transaksi: jenis === 'MASUK' ? 'Pembelian Supplier' : 'Barang Rusak / Afkir',
      divisi: 'GUDANG',
      lokasi_penerima: '',
      kode_barang: items[0]?.kode_barang || '',
      jumlah: 1,
      tanggal: todayLocal(),
      keterangan: '',
      tujuan_id: '',
      serial_number: ''
    });
    setScanInput('');
    setModalError('');
    setIsModalOpen(true);
    setTimeout(() => scanInputRef.current?.focus(), 120);
  };

  const handleSaveModal = async (e) => {
    e.preventDefault();
    if (!modalData.kode_barang || !modalData.jumlah) {
      setModalError('Kode barang dan jumlah wajib diisi');
      return;
    }
    if (isLinkedMode && !modalData.tujuan_id) {
      setModalError(`Pilih ${DIVISI_LINK_LABEL[modalData.divisi]} tujuan terlebih dahulu`);
      return;
    }
    if (!isLinkedMode && !modalData.lokasi_penerima) {
      setModalError('Lokasi / penerima / suplayer wajib diisi');
      return;
    }
    if (modalData.jenis === 'KELUAR' && selectedItem && Number(modalData.jumlah) > Number(selectedItem.stok)) {
      setModalError(`Stok gudang hanya ${selectedItem.stok} ${selectedItem.satuan} — kurangi jumlah terlebih dahulu`);
      return;
    }

    setIsSubmitting(true);
    setModalError('');

    try {
      const payload = {
        jenis: modalData.jenis,
        kategori_transaksi: modalData.kategori_transaksi,
        divisi: modalData.divisi,
        kode_barang: modalData.kode_barang,
        jumlah: modalData.jumlah,
        tanggal: modalData.tanggal,
        keterangan: modalData.keterangan,
        serial_number: modalData.serial_number || ''
      };
      if (isLinkedMode) {
        payload.tujuan_id = Number(modalData.tujuan_id);
        const tujuan = tujuanList.find((t) => Number(t.id) === Number(modalData.tujuan_id));
        payload.lokasi_penerima = labelTujuan(tujuan);
      } else {
        payload.lokasi_penerima = modalData.lokasi_penerima;
      }

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan transaksi');
      }

      setIsModalOpen(false);
      notify(data.message || 'Transaksi berhasil dicatat', 'success');
      fetchTransactions();
      if (onRefreshMaster) onRefreshMaster();
    } catch (err) {
      setModalError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Cards: Keluar Masuk Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Transaksi */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Mutasi Transaksi</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {formatNumber(summary?.total_transaksi || 0)} <span className="text-xs font-normal text-slate-500">Record</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Sesuai filter terpilih</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <ArrowLeftRight className="w-6 h-6" />
          </div>
        </div>

        {/* Barang Masuk */}
        <div className="bg-emerald-50/70 p-5 rounded-2xl border border-emerald-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-emerald-800 uppercase tracking-wider block">Total Barang Masuk</span>
            <div className="text-xl font-bold text-emerald-950 mt-1">
              {formatNumber(summary?.total_masuk_qty || 0)} <span className="text-xs font-normal text-emerald-700">Unit/Qty</span>
            </div>
            <span className="text-[11px] font-bold text-emerald-700 mt-0.5 block">
              Nilai: {formatRupiah(summary?.total_masuk_nilai || 0)}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
        </div>

        {/* Barang Keluar */}
        <div className="bg-rose-50/70 p-5 rounded-2xl border border-rose-200 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-rose-800 uppercase tracking-wider block">Total Barang Keluar</span>
            <div className="text-xl font-bold text-rose-950 mt-1">
              {formatNumber(summary?.total_keluar_qty || 0)} <span className="text-xs font-normal text-rose-700">Unit/Qty</span>
            </div>
            <span className="text-[11px] font-bold text-rose-700 mt-0.5 block">
              Nilai: {formatRupiah(summary?.total_keluar_nilai || 0)}
            </span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-700">
            <ArrowUpRight className="w-6 h-6" />
          </div>
        </div>

        {/* Action Fast Input */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Input Cepat Mutasi</span>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => handleOpenModal('MASUK')}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition"
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>+ Masuk</span>
              </button>
              <button
                onClick={() => handleOpenModal('KELUAR')}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm transition"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>- Keluar</span>
              </button>
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Package className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Table & Filter Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Advanced Filter Toolbar */}
        <div className="p-5 border-b border-slate-200 space-y-4">
          {/* Top row: search + mode toggle + export */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Cari kode, nama barang, no transaksi, penerima/suplayer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 focus:bg-white focus:border-indigo-500 rounded-xl text-sm transition"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="bg-slate-100 p-1 rounded-xl flex items-center text-xs">
                <button
                  onClick={() => setFilterMode('period')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                    filterMode === 'period' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Per Minggu / Bulan / Tahun
                </button>
                <button
                  onClick={() => setFilterMode('custom_range')}
                  className={`px-3 py-1.5 rounded-lg font-semibold transition ${
                    filterMode === 'custom_range' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Rentang Tanggal Kustom
                </button>
              </div>

              <button
                onClick={handleExportCSV}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 border border-slate-300 transition"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={handlePrint}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 border border-slate-300 transition"
              >
                <Printer className="w-4 h-4" />
                <span>Cetak Laporan</span>
              </button>
            </div>
          </div>

          {/* Bottom row: specific dropdown filters */}
          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 text-xs">
            {/* Divisi Filter */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-600">Divisi:</span>
              <select
                value={selectedDivisi}
                onChange={(e) => setSelectedDivisi(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 font-medium focus:bg-white"
              >
                {DIVISI_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d === 'SEMUA' ? 'Semua Divisi' : d}
                  </option>
                ))}
              </select>
            </div>

            {/* Jenis Filter */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-600">Jenis:</span>
              <select
                value={selectedJenis}
                onChange={(e) => setSelectedJenis(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 font-medium focus:bg-white"
              >
                <option value="">Semua (Masuk & Keluar)</option>
                <option value="MASUK">Hanya Barang MASUK</option>
                <option value="KELUAR">Hanya Barang KELUAR</option>
              </select>
            </div>

            {/* Filter by Period Mode */}
            {filterMode === 'period' ? (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-600">Tahun:</span>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 font-medium focus:bg-white"
                  >
                    <option value="">Semua Tahun</option>
                    {YEARS.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-600">Bulan:</span>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 font-medium focus:bg-white"
                  >
                    {MONTHS.map((m) => (
                      <option key={m.val} value={m.val}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-slate-600">Minggu:</span>
                  <select
                    value={selectedWeek}
                    disabled={!selectedMonth}
                    onChange={(e) => setSelectedWeek(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 font-medium focus:bg-white disabled:opacity-50"
                  >
                    <option value="">Semua Minggu</option>
                    <option value="1">Minggu ke-1 (Tgl 1 - 7)</option>
                    <option value="2">Minggu ke-2 (Tgl 8 - 14)</option>
                    <option value="3">Minggu ke-3 (Tgl 15 - 21)</option>
                    <option value="4">Minggu ke-4 (Tgl 22 - 28)</option>
                    <option value="5">Minggu ke-5 (Tgl 29 - Akhir)</option>
                  </select>
                </div>
              </>
            ) : (
              /* Custom Date Range */
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-600">Dari:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                />
                <span className="font-semibold text-slate-600">Sampai:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            )}

            <button
              onClick={() => {
                setSearch('');
                setSelectedDivisi('SEMUA');
                setSelectedJenis('');
                setSelectedYear('2026');
                setSelectedMonth('');
                setSelectedWeek('');
                setStartDate('');
                setEndDate('');
              }}
              className="text-indigo-600 hover:text-indigo-800 font-semibold underline ml-auto"
            >
              Reset Filter
            </button>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Tanggal & Waktu</th>
                <th className="py-3 px-4">No Transaksi</th>
                <th className="py-3 px-4">Jenis</th>
                <th className="py-3 px-4">Kategori Mutasi</th>
                <th className="py-3 px-4">Divisi & Lokasi / Penerima</th>
                <th className="py-3 px-4">Kode & Nama Barang</th>
                <th className="py-3 px-4 text-right">Jumlah (Qty)</th>
                <th className="py-3 px-4 text-right">Harga Satuan</th>
                <th className="py-3 px-4 text-right">Total Nilai (Rp)</th>
                <th className="py-3 px-4">Keterangan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="10" className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Memuat data mutasi barang...</span>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan="10" className="py-12 text-center text-slate-400">
                    <ArrowLeftRight className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-700">Tidak ada transaksi ditemukan</p>
                    <p className="text-[11px] text-slate-400">Silakan sesuaikan filter tanggal, minggu, atau divisi di atas.</p>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition">
                    {/* Tanggal & Waktu */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="font-semibold text-slate-800">{formatDate(tx.tanggal)}</div>
                      <div className="text-[10px] text-slate-400">{tx.waktu || ''}</div>
                    </td>

                    {/* No Transaksi */}
                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-slate-700">
                      {tx.no_transaksi}
                    </td>

                    {/* Jenis (Masuk / Keluar Badge) */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider ${
                        tx.jenis === 'MASUK'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          : 'bg-rose-100 text-rose-800 border border-rose-200'
                      }`}>
                        {tx.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {tx.jenis}
                      </span>
                    </td>

                    {/* Kategori Transaksi */}
                    <td className="py-3 px-4 whitespace-nowrap">
                      <span className="font-medium text-slate-800">{tx.kategori_transaksi}</span>
                    </td>

                    {/* Divisi & Lokasi / Penerima */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                          {tx.divisi}
                        </span>
                        <span className="font-semibold text-slate-900 truncate max-w-xs">{tx.lokasi_penerima}</span>
                      </div>
                    </td>

                    {/* Kode & Nama Barang */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 truncate max-w-xs">{tx.nama_barang}</div>
                      <div className="text-[10px] font-mono text-indigo-700">{tx.kode_barang}</div>
                    </td>

                    {/* Jumlah */}
                    <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-slate-800">
                      {formatNumber(tx.jumlah)} {tx.satuan}
                    </td>

                    {/* Harga Satuan */}
                    <td className="py-3 px-4 text-right whitespace-nowrap text-slate-600">
                      {formatRupiah(tx.harga_satuan)}
                    </td>

                    {/* Total Nilai Rp */}
                    <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-indigo-700">
                      {formatRupiah(tx.total_harga)}
                    </td>

                    {/* Keterangan */}
                    <td className="py-3 px-4 text-slate-500 max-w-xs truncate">
                      {tx.keterangan || '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Menampilkan {transactions.length} baris transaksi mutasi</span>
          <div className="flex items-center gap-4 font-semibold">
            <span className="text-emerald-700">Total Masuk: {formatRupiah(summary?.total_masuk_nilai || 0)}</span>
            <span className="text-slate-300">|</span>
            <span className="text-rose-700">Total Keluar: {formatRupiah(summary?.total_keluar_nilai || 0)}</span>
          </div>
        </div>
      </div>

      {/* Manual Transaction Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden sm:my-8 pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[92vh] flex flex-col">
            <div className={`px-4 sm:px-6 py-3.5 sm:py-4 text-white flex items-center justify-between ${
              modalData.jenis === 'MASUK' ? 'bg-emerald-700' : 'bg-rose-700'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                  {modalData.jenis === 'MASUK' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    {modalData.jenis === 'MASUK' ? 'Catat Barang Masuk' : 'Catat Barang Keluar'}
                  </h3>
                  <p className="text-[11px] text-white/80">Scan stiker barcode → barang terisi otomatis → pilih divisi & tujuan</p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-white/80 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              {modalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              {/* Kotak Scan Barcode — stiker kode barang yang tertempel di barang fisik */}
              <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-3 space-y-2">
                <label className="block text-xs font-bold text-indigo-800 uppercase tracking-wider flex items-center gap-1.5">
                  <ScanLine className="w-4 h-4" />
                  Scan Barcode Stiker Barang
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={scanInputRef}
                    type="text"
                    value={scanInput}
                    onChange={(e) => setScanInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        applyScannedCode(scanInput);
                        setScanInput('');
                      }
                    }}
                    placeholder="Arahkan scanner USB ke sini, atau ketik kode lalu Enter..."
                    className="flex-1 px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-indigo-400"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => (isCameraOn ? stopTxCamera() : startTxCamera())}
                    className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shrink-0 ${
                      isCameraOn ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    <Camera className="w-4 h-4" />
                    <span>{isCameraOn ? 'Matikan' : 'Kamera'}</span>
                  </button>
                </div>
                <div
                  id="scan-area-transaksi"
                  className={`rounded-lg overflow-hidden bg-slate-900 border border-slate-300 ${isCameraOn ? '' : 'hidden'}`}
                  style={{ minHeight: isCameraOn ? 200 : 0 }}
                />
                <p className="text-[11px] text-indigo-700">
                  Setiap scan langsung mengisi kolom Barang di bawah — tinggal ketik jumlah. Scanner USB (yang mengetik otomatis) dan kamera sama-sama didukung.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jenis Mutasi *
                  </label>
                  <select
                    value={modalData.jenis}
                    onChange={(e) => {
                      const j = e.target.value;
                      const linked = modalData.divisi !== 'GUDANG';
                      setModalData({
                        ...modalData,
                        jenis: j,
                        kategori_transaksi: j === 'MASUK'
                          ? (linked ? 'Pengembalian / Dismantle' : 'Pembelian Supplier')
                          : (linked ? `Pemasangan ${DIVISI_LINK_LABEL[modalData.divisi]}` : 'Barang Rusak / Afkir')
                      });
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold focus:bg-white"
                  >
                    <option value="MASUK">MASUK (+)</option>
                    <option value="KELUAR">KELUAR (-)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kategori Mutasi *
                  </label>
                  <select
                    value={modalData.kategori_transaksi}
                    onChange={(e) => setModalData({ ...modalData, kategori_transaksi: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white"
                  >
                    {modalData.jenis === 'MASUK' ? (
                      isLinkedMode ? (
                        <>
                          <option value="Pengembalian / Dismantle">Pengembalian / Dismantle</option>
                          <option value="Retur">Retur</option>
                        </>
                      ) : (
                        <>
                          <option value="Pembelian Supplier">Pembelian Supplier</option>
                          <option value="Pengembalian / Dismantle">Pengembalian / Dismantle</option>
                          <option value="Retur">Retur</option>
                          <option value="Koreksi Stok">Koreksi Stok / Opname</option>
                        </>
                      )
                    ) : (
                      isLinkedMode ? (
                        <>
                          <option value={`Pemasangan ${DIVISI_LINK_LABEL[modalData.divisi]}`}>
                            {`Pemasangan ${DIVISI_LINK_LABEL[modalData.divisi]}`}
                          </option>
                          <option value="Maintenance / Penggantian">Maintenance / Penggantian</option>
                          <option value="Mutasi">Mutasi / Pemindahan</option>
                        </>
                      ) : (
                        <>
                          <option value="Pemasangan Pelanggan">Pemasangan Pelanggan</option>
                          <option value="Pemasangan Divisi FO">Pemasangan Divisi FO</option>
                          <option value="Pemasangan Divisi Tower">Pemasangan Divisi Tower</option>
                          <option value="Barang Rusak / Afkir">Barang Rusak / Afkir</option>
                          <option value="Maintenance / Penggantian">Maintenance / Penggantian</option>
                          <option value="Mutasi">Mutasi / Pemindahan</option>
                        </>
                      )
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Divisi Terkait *
                  </label>
                  <select
                    value={modalData.divisi}
                    onChange={(e) => {
                      const d = e.target.value;
                      if (d === 'GUDANG') {
                        setModalData({ ...modalData, divisi: d, tujuan_id: '' });
                      } else {
                        setModalData({
                          ...modalData,
                          divisi: d,
                          tujuan_id: '',
                          kategori_transaksi: modalData.jenis === 'MASUK'
                            ? 'Pengembalian / Dismantle'
                            : `Pemasangan ${DIVISI_LINK_LABEL[d]}`
                        });
                      }
                    }}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white font-semibold"
                  >
                    <option value="GUDANG">GUDANG / PUSAT</option>
                    <option value="PELANGGAN">DIVISI PELANGGAN</option>
                    <option value="DIVISI FO">DIVISI FO</option>
                    <option value="DIVISI TOWER">DIVISI TOWER</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tanggal Transaksi
                  </label>
                  <input
                    type="date"
                    value={modalData.tanggal}
                    onChange={(e) => setModalData({ ...modalData, tanggal: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Barang * <span className="font-normal text-indigo-600">(terisi otomatis saat stiker di-scan)</span>
                </label>
                <select
                  value={modalData.kode_barang}
                  onChange={(e) => setModalData({ ...modalData, kode_barang: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold focus:bg-white"
                >
                  {items.map((it) => (
                    <option key={it.id} value={it.kode_barang}>
                      {it.kode_barang} - {it.nama_barang} (Stok: {it.stok} {it.satuan})
                    </option>
                  ))}
                </select>
                {selectedItem && (
                  <p className="text-[11px] mt-1 text-slate-500">
                    Stok gudang tersedia:{' '}
                    <strong
                      className={
                        modalData.jenis === 'KELUAR' && Number(modalData.jumlah) > Number(selectedItem.stok)
                          ? 'text-rose-600'
                          : 'text-slate-800'
                      }
                    >
                      {formatNumber(selectedItem.stok)} {selectedItem.satuan}
                    </strong>
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Jumlah (Qty) *
                  </label>
                  <input
                    ref={qtyInputRef}
                    type="number"
                    step="any"
                    min="0.01"
                    required
                    value={modalData.jumlah}
                    onChange={(e) => setModalData({ ...modalData, jumlah: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-bold focus:bg-white"
                  />
                </div>

                {isLinkedMode ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {modalData.divisi === 'PELANGGAN' && 'Pelanggan Tujuan *'}
                      {modalData.divisi === 'DIVISI FO' && 'Site FO Tujuan *'}
                      {modalData.divisi === 'DIVISI TOWER' && 'Site Tower Tujuan *'}
                    </label>
                    <select
                      value={modalData.tujuan_id}
                      onChange={(e) => setModalData({ ...modalData, tujuan_id: e.target.value })}
                      disabled={tujuanLoading}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:bg-white"
                    >
                      <option value="">
                        {tujuanLoading
                          ? 'Memuat data...'
                          : tujuanList.length === 0
                            ? 'Belum ada data — tambah dulu di halaman divisi'
                            : `-- Pilih ${DIVISI_LINK_LABEL[modalData.divisi]} tujuan --`}
                      </option>
                      {tujuanList.map((row) => (
                        <option key={row.id} value={row.id}>
                          {labelTujuan(row)}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {modalData.jenis === 'MASUK' ? 'Suplayer / Asal Barang *' : 'Lokasi / Penerima *'}
                    </label>
                    <input
                      type="text"
                      required
                      value={modalData.lokasi_penerima}
                      onChange={(e) => setModalData({ ...modalData, lokasi_penerima: e.target.value })}
                      placeholder="Nama suplayer, site, atau teknisi"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white"
                    />
                  </div>
                )}
              </div>

              {/* Penjelasan akibat mode tertaut */}
              {isLinkedMode && (
                <div className={`p-3 rounded-xl text-[11px] leading-relaxed border ${
                  modalData.jenis === 'KELUAR'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                  {modalData.jenis === 'KELUAR' ? (
                    <>
                      <strong>Mode pemasangan:</strong> barang akan otomatis tercatat <strong>TERPASANG</strong> pada data{' '}
                      {DIVISI_LINK_LABEL[modalData.divisi]} tujuan — sama hasilnya seperti input dari halaman divisi
                      (muncul di laporan "Terpasang Dimananya", bisa dilacak scan). Stok gudang berkurang.
                    </>
                  ) : (
                    <>
                      <strong>Mode pengembalian:</strong> jumlah barang akan <strong>dikurangi dari daftar terpasang</strong>{' '}
                      tujuan dan kembali menambah stok gudang.
                    </>
                  )}
                </div>
              )}

              {/* Nomor Seri opsional — hanya saat pemasangan tertaut */}
              {isLinkedMode && modalData.jenis === 'KELUAR' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Serial Number / SN (opsional)
                  </label>
                  <input
                    type="text"
                    value={modalData.serial_number}
                    onChange={(e) => setModalData({ ...modalData, serial_number: e.target.value })}
                    placeholder="SN unit untuk pelacakan — kosongkan bila tidak ada"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:bg-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Keterangan / No. Surat Jalan
                </label>
                <textarea
                  rows="2"
                  value={modalData.keterangan}
                  onChange={(e) => setModalData({ ...modalData, keterangan: e.target.value })}
                  placeholder="Catatan nomor PO, nota, atau alasan transaksi..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition disabled:opacity-50 ${
                    modalData.jenis === 'MASUK' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isSubmitting ? 'Memproses...' : 'Simpan Transaksi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
