// Bon / Barang Bawaan Teknisi (Stok Transit Lapangan)
//
// Alur 3 tahap (lihat server/index.js bagian "5B. BON / BARANG BAWAAN TEKNISI"):
//   1. Bon Baru      — teknisi membawa barang dari gudang  → stok gudang BERKURANG (pindah ke stok dibawa teknisi)
//   2. Realisasi     — bon → Pelanggan / Divisi FO / Divisi Tower (+ SN, lokasi, teknisi pemasang)
//   3. Pengembalian  — sisa tidak terpakai kembali ke gudang → stok gudang BERTAMBAH
// Halaman ini juga memuat riwayat mutasi, laporan, dan cetak surat jalan / rekap bon.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Wrench, Plus, Search, RefreshCw, Eye, Printer, PackageCheck, Undo2, Ban, X, Download,
  ClipboardList, History, BarChart3, HardHat, AlertTriangle, Truck, Users
} from 'lucide-react';
import { notify } from '../utils/notify';
import { formatRupiah, formatNumber, formatDate, formatDateTime, todayLocal, exportToCSV } from '../utils/formatters';
import { BonBaruModal, RealisasiModal, PengembalianModal } from './BonTeknisiForms';
import DataTeknisiPanel, { DivisiBadge, TEKNISI_DIVISI } from './DataTeknisi';
import BonTeknisiPrintModal, { BonDocument, STATUS_LABEL, DIVISI_LABEL } from './BonTeknisiPrint';

const STATUS_STYLE = {
  AKTIF: 'bg-amber-100 text-amber-800 border-amber-200',
  SEBAGIAN: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  SELESAI: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  BATAL: 'bg-slate-200 text-slate-600 border-slate-300'
};
const JENIS_STYLE = {
  BAWA: ['Dibawa', 'bg-amber-100 text-amber-800 border-amber-200'],
  PASANG: ['Dipasang', 'bg-indigo-100 text-indigo-800 border-indigo-200'],
  KEMBALI: ['Dikembalikan', 'bg-emerald-100 text-emerald-800 border-emerald-200'],
  BATAL: ['Dibatalkan', 'bg-slate-200 text-slate-600 border-slate-300']
};
const DIVISI_STYLE = {
  PELANGGAN: 'bg-blue-50 text-blue-700 border-blue-200',
  'DIVISI FO': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'DIVISI TOWER': 'bg-purple-50 text-purple-700 border-purple-200'
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap ${STATUS_STYLE[status] || STATUS_STYLE.BATAL}`}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function JenisBadge({ jenis }) {
  const [label, cls] = JENIS_STYLE[jenis] || [jenis, STATUS_STYLE.BATAL];
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap ${cls}`}>{label}</span>;
}

async function getData(url) {
  const res = await fetch(url);
  let json = null;
  try { json = await res.json(); } catch { /* bukan JSON */ }
  if (!json || !json.success) throw new Error(json?.error || `Gagal memuat data (HTTP ${res.status})`);
  return json.data;
}

function firstOfMonth() {
  const t = todayLocal();
  return `${t.slice(0, 8)}01`;
}

function Kpi({ label, value, sub, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 text-slate-900',
    amber: 'border-amber-200 text-amber-900',
    indigo: 'border-indigo-200 text-indigo-900',
    emerald: 'border-emerald-200 text-emerald-900'
  };
  return (
    <div className={`bg-white p-4 rounded-2xl border shadow-sm ${tones[tone]}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-xl font-black mt-1 break-words">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const inputCls = 'px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-400 outline-none';

// ------------------------------------------------------------------
// Detail bon (barang, sisa, riwayat mutasi) + aksi tahap 2 & 3
// ------------------------------------------------------------------
function BonDetailModal({ loan, onClose, canManage, canInstall, onInstall, onReturn, onCancel, onPrint }) {
  const terbuka = loan.status === 'AKTIF' || loan.status === 'SEBAGIAN';
  const sudahPasang = loan.movements.some((m) => m.jenis === 'PASANG');
  const s = loan.summary;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 sm:my-6 max-h-[94vh] flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="bg-amber-600 text-white px-4 sm:px-6 py-3.5 flex items-center justify-between rounded-t-2xl shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center shrink-0"><Wrench className="w-5 h-5" /></div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm font-mono truncate">{loan.no_bon}</h3>
              <p className="text-[11px] text-white/80 truncate">Bon dibawa {loan.teknisi_nama} • {formatDateTime(loan.tanggal, loan.waktu)}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-slate-500 block text-[10px] uppercase font-bold">Status</span><StatusBadge status={loan.status} /></div>
            <div><span className="text-slate-500 block text-[10px] uppercase font-bold">Teknisi Pembawa</span><span className="font-semibold">{loan.teknisi_nama}</span>{loan.divisi && <span className="ml-1.5"><DivisiBadge divisi={loan.divisi} /></span>}</div>
            <div><span className="text-slate-500 block text-[10px] uppercase font-bold">Keperluan</span><span className="font-medium">{loan.keperluan || '-'}</span></div>
            <div><span className="text-slate-500 block text-[10px] uppercase font-bold">Dicatat Oleh</span><span className="font-medium">{loan.dibuat_oleh || '-'}</span></div>
            {loan.catatan && <div className="col-span-2 sm:col-span-4"><span className="text-slate-500 block text-[10px] uppercase font-bold">Catatan</span><span>{loan.catatan}</span></div>}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Nilai Dibawa" value={formatRupiah(s.nilai_dibawa)} tone="amber" />
            <Kpi label="Nilai Terpasang" value={formatRupiah(s.nilai_terpasang)} tone="indigo" />
            <Kpi label="Nilai Dikembalikan" value={formatRupiah(s.nilai_kembali)} tone="emerald" />
            <Kpi label="Nilai Masih Dibawa" value={formatRupiah(terbuka ? s.nilai_sisa : 0)} sub={terbuka ? 'sisa di teknisi' : 'tidak ada sisa'} />
          </div>

          <div className="flex flex-wrap gap-2 no-print">
            {terbuka && canInstall && (
              <button type="button" onClick={onInstall} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5">
                <PackageCheck className="w-4 h-4" /> Realisasi Pemasangan
              </button>
            )}
            {terbuka && canManage && (
              <button type="button" onClick={onReturn} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5">
                <Undo2 className="w-4 h-4" /> Kembalikan Sisa ke Gudang
              </button>
            )}
            <button type="button" onClick={onPrint} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-1.5">
              <Printer className="w-4 h-4" /> Cetak Surat Jalan / Bon
            </button>
            {terbuka && canManage && !sudahPasang && (
              <button type="button" onClick={onCancel} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 flex items-center gap-1.5 sm:ml-auto">
                <Ban className="w-4 h-4" /> Batalkan Bon
              </button>
            )}
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Barang pada Bon</h4>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Barang</th>
                    <th className="text-right px-3 py-2">Dibawa</th>
                    <th className="text-right px-3 py-2">Terpasang</th>
                    <th className="text-right px-3 py-2">Dikembalikan</th>
                    <th className="text-right px-3 py-2">Sisa di Teknisi</th>
                    <th className="text-right px-3 py-2">Nilai Dibawa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loan.items.map((li) => (
                    <tr key={li.id}>
                      <td className="px-3 py-2"><div className="font-semibold text-slate-800">{li.nama_barang}</div><div className="font-mono text-[10px] text-slate-500">{li.kode_barang}</div></td>
                      <td className="px-3 py-2 text-right">{formatNumber(li.jumlah_dibawa)} {li.satuan}</td>
                      <td className="px-3 py-2 text-right text-indigo-700">{formatNumber(li.jumlah_terpasang)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{formatNumber(li.jumlah_kembali)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${li.jumlah_sisa > 0 ? 'text-amber-700' : 'text-slate-400'}`}>{formatNumber(li.jumlah_sisa)}</td>
                      <td className="px-3 py-2 text-right">{formatRupiah(li.jumlah_dibawa * li.harga_barang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">Riwayat Mutasi Bon</h4>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-xs min-w-[760px]">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="text-left px-3 py-2">Waktu</th>
                    <th className="text-left px-3 py-2">Jenis</th>
                    <th className="text-left px-3 py-2">Barang</th>
                    <th className="text-right px-3 py-2">Jumlah</th>
                    <th className="text-left px-3 py-2">SN</th>
                    <th className="text-left px-3 py-2">Tujuan / Lokasi</th>
                    <th className="text-left px-3 py-2">Teknisi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loan.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(m.tanggal, m.waktu)}</td>
                      <td className="px-3 py-2"><JenisBadge jenis={m.jenis} /></td>
                      <td className="px-3 py-2"><div className="font-medium text-slate-800">{m.nama_barang}</div><div className="font-mono text-[10px] text-slate-500">{m.kode_barang}</div></td>
                      <td className="px-3 py-2 text-right font-bold">{formatNumber(m.jumlah)} {m.satuan}</td>
                      <td className="px-3 py-2 font-mono">{m.serial_number || '-'}</td>
                      <td className="px-3 py-2">
                        {m.jenis === 'PASANG' ? (
                          <>
                            <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${DIVISI_STYLE[m.divisi] || ''}`}>{DIVISI_LABEL[m.divisi] || m.divisi}</span>
                            <div className="font-medium">{m.tujuan_nama}</div>
                            {m.lokasi_tujuan && m.lokasi_tujuan !== m.tujuan_nama && <div className="text-[10px] text-slate-500">{m.lokasi_tujuan}</div>}
                          </>
                        ) : (
                          <span className="text-slate-500">{m.jenis === 'BAWA' ? 'Gudang → teknisi' : 'Teknisi → gudang'}{m.no_transaksi ? ` (${m.no_transaksi})` : ''}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{m.teknisi_nama || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Halaman utama
// ------------------------------------------------------------------
export default function BonTeknisi({
  items = [],
  customers = [],
  foSites = [],
  towerSites = [],
  onRefresh = () => {},
  canManage = false,
  canInstall = false
}) {
  const [tab, setTab] = useState('daftar'); // daftar | riwayat | laporan | teknisi
  const [loans, setLoans] = useState([]);
  const [stock, setStock] = useState(null);
  const [technicians, setTechnicians] = useState(null);
  const [roster, setRoster] = useState([]); // Data Teknisi (master nama per divisi)
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Filter daftar bon
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [teknisi, setTeknisi] = useState('');
  const [fDivisi, setFDivisi] = useState('');

  // Riwayat mutasi
  const [movements, setMovements] = useState([]);
  const [mvLoading, setMvLoading] = useState(false);
  const [mvSearch, setMvSearch] = useState('');
  const [mvJenis, setMvJenis] = useState('');
  const [mvTeknisi, setMvTeknisi] = useState('');
  const [mvStart, setMvStart] = useState('');
  const [mvEnd, setMvEnd] = useState('');

  // Laporan
  const [report, setReport] = useState(null);
  const [rpLoading, setRpLoading] = useState(false);
  const [rpStart, setRpStart] = useState(firstOfMonth());
  const [rpEnd, setRpEnd] = useState(todayLocal());
  const [rpStatus, setRpStatus] = useState('');
  const [rpTeknisi, setRpTeknisi] = useState('');
  const [rpDivisi, setRpDivisi] = useState('');

  // Modal
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState(null);
  const [mode, setMode] = useState(null); // 'install' | 'return'
  const [printLoan, setPrintLoan] = useState(null);
  const [printVariant, setPrintVariant] = useState('surat_jalan');

  const reqSeq = useRef(0);

  const teknisiNames = useMemo(() => {
    const set = new Set();
    roster.forEach((t) => set.add(t.nama));
    (technicians?.nama_pernah_tercatat || []).forEach((n) => set.add(n));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [technicians, roster]);

  const loadLoans = useCallback(async () => {
    const seq = ++reqSeq.current;
    try {
      const p = new URLSearchParams();
      if (search.trim()) p.set('search', search.trim());
      if (status) p.set('status', status);
      if (teknisi) p.set('teknisi', teknisi);
      if (fDivisi) p.set('divisi', fDivisi);
      const data = await getData(`/api/technician-loans?${p.toString()}`);
      if (seq === reqSeq.current) { setLoans(data); setLoadError(''); }
    } catch (err) {
      if (seq === reqSeq.current) setLoadError(err.message);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [search, status, teknisi, fDivisi]);

  const loadStock = useCallback(async () => {
    try { setStock(await getData('/api/technician-loans/stock')); } catch { /* KPI saja — abaikan */ }
  }, []);

  const loadTechnicians = useCallback(async () => {
    try { setTechnicians(await getData('/api/technician-loans/technicians')); } catch { /* opsional */ }
  }, []);

  // Data Teknisi: dikembalikan sebagai promise supaya form bon bisa menunggu daftar terbaru
  const loadRoster = useCallback(async () => {
    try { setRoster(await getData('/api/teknisi')); } catch { /* opsional — pilihan teknisi saja */ }
  }, []);

  useEffect(() => { loadStock(); loadTechnicians(); loadRoster(); }, [loadStock, loadTechnicians, loadRoster]);

  // Pencarian diberi jeda singkat agar tidak menembak API tiap ketukan
  useEffect(() => {
    const t = setTimeout(loadLoans, 250);
    return () => clearTimeout(t);
  }, [loadLoans]);

  const loadMovements = useCallback(async () => {
    setMvLoading(true);
    try {
      const p = new URLSearchParams();
      if (mvSearch.trim()) p.set('search', mvSearch.trim());
      if (mvJenis) p.set('jenis', mvJenis);
      if (mvTeknisi) p.set('teknisi', mvTeknisi);
      if (mvStart) p.set('start_date', mvStart);
      if (mvEnd) p.set('end_date', mvEnd);
      setMovements(await getData(`/api/technician-loans/movements?${p.toString()}`));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setMvLoading(false);
    }
  }, [mvSearch, mvJenis, mvTeknisi, mvStart, mvEnd]);

  useEffect(() => {
    if (tab !== 'riwayat') return undefined;
    const t = setTimeout(loadMovements, 250);
    return () => clearTimeout(t);
  }, [tab, loadMovements]);

  const loadReport = useCallback(async () => {
    setRpLoading(true);
    try {
      const p = new URLSearchParams();
      if (rpStart) p.set('start_date', rpStart);
      if (rpEnd) p.set('end_date', rpEnd);
      if (rpStatus) p.set('status', rpStatus);
      if (rpTeknisi) p.set('teknisi', rpTeknisi);
      if (rpDivisi) p.set('divisi', rpDivisi);
      setReport(await getData(`/api/technician-loans/report?${p.toString()}`));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setRpLoading(false);
    }
  }, [rpStart, rpEnd, rpStatus, rpTeknisi, rpDivisi]);

  useEffect(() => {
    if (tab === 'laporan') loadReport();
  }, [tab, loadReport]);

  const refreshAll = useCallback(() => {
    loadLoans();
    loadStock();
    loadTechnicians();
    loadRoster();
    if (tab === 'riwayat') loadMovements();
    if (tab === 'laporan') loadReport();
    onRefresh();
  }, [loadLoans, loadStock, loadTechnicians, loadRoster, loadMovements, loadReport, tab, onRefresh]);

  const openDetail = async (id) => {
    try { setDetail(await getData(`/api/technician-loans/${id}`)); } catch (err) { notify(err.message, 'error'); }
  };

  const openPrint = async (id, preferred) => {
    try {
      const d = await getData(`/api/technician-loans/${id}`);
      setPrintVariant(preferred || (d.status === 'AKTIF' ? 'surat_jalan' : 'rekap'));
      setPrintLoan(d);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const afterAction = (updated) => {
    setMode(null);
    setDetail(updated);
    refreshAll();
  };

  const handleCancel = async () => {
    if (!detail) return;
    if (!window.confirm(`Batalkan bon ${detail.no_bon}? Seluruh sisa barang akan dikembalikan ke stok gudang.`)) return;
    try {
      const res = await fetch(`/api/technician-loans/${detail.id}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal membatalkan bon');
      notify(json.message, 'success');
      setDetail(json.data);
      refreshAll();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // ---------- KPI ----------
  const transitRows = stock?.rows || [];
  const bonBerjalan = new Set(transitRows.map((r) => r.loan_id)).size;
  const jenisTransit = new Set(transitRows.map((r) => r.kode_barang)).size;

  // ---------- Export ----------
  const exportRiwayat = () => {
    if (!movements.length) return;
    exportToCSV(`Riwayat_Mutasi_Bon_Teknisi_${Date.now()}.csv`, movements.map((m, i) => ({
      No: i + 1, Tanggal: m.tanggal, Waktu: m.waktu, 'No. Bon': m.no_bon, Jenis: (JENIS_STYLE[m.jenis] || [m.jenis])[0],
      'Kode Barang': m.kode_barang, 'Nama Barang': m.nama_barang, Jumlah: m.jumlah, Satuan: m.satuan,
      'Serial Number': m.serial_number, Divisi: DIVISI_LABEL[m.divisi] || m.divisi, Tujuan: m.tujuan_nama,
      'Lokasi Tujuan': m.lokasi_tujuan, Teknisi: m.teknisi_nama, 'No. Mutasi Gudang': m.no_transaksi, Keterangan: m.keterangan
    })));
  };

  const exportLaporan = () => {
    if (!report?.loans?.length) return;
    exportToCSV(`Laporan_Bon_Teknisi_${Date.now()}.csv`, report.loans.map((l, i) => ({
      No: i + 1, 'No. Bon': l.no_bon, Tanggal: l.tanggal, Divisi: DIVISI_LABEL[l.divisi] || l.divisi || '', Teknisi: l.teknisi_nama, Keperluan: l.keperluan,
      Status: STATUS_LABEL[l.status] || l.status, 'Nilai Dibawa (Rp)': l.nilai_dibawa, 'Nilai Terpasang (Rp)': l.nilai_terpasang,
      'Nilai Dikembalikan (Rp)': l.nilai_kembali, 'Nilai Sisa di Teknisi (Rp)': ['AKTIF', 'SEBAGIAN'].includes(l.status) ? l.nilai_sisa : 0
    })));
  };

  const tabBtn = (id, label, Icon) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition ${tab === id ? 'bg-amber-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'}`}
    >
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <>
      <div className={`space-y-5 ${printLoan ? 'no-print' : ''} ${tab === 'laporan' ? 'print-page-laporan' : ''}`}>
        {/* Judul */}
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0"><Truck className="w-6 h-6" /></div>
            <div>
              <h1 className="text-lg sm:text-xl font-black text-slate-900">Bon / Barang Bawaan Teknisi</h1>
              <p className="text-xs text-slate-500">Stok transit lapangan: gudang → teknisi → pasang ke divisi / kembali ke gudang</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={refreshAll} className="p-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="Muat ulang" title="Muat ulang">
              <RefreshCw className="w-4 h-4" />
            </button>
            {canManage && (
              <button type="button" onClick={() => setShowNew(true)} className="px-4 py-2.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 shadow-sm">
                <Plus className="w-4 h-4" /> Bon Baru
              </button>
            )}
          </div>
        </div>

        {/* KPI stok transit */}
        <div className="no-print grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Bon Berjalan" value={formatNumber(bonBerjalan)} sub="masih ada sisa di teknisi" tone="amber" />
          <Kpi label="Teknisi Membawa Barang" value={formatNumber(stock?.per_teknisi?.length || 0)} sub="teknisi dengan stok transit" />
          <Kpi label="Jenis Barang di Lapangan" value={formatNumber(jenisTransit)} sub="SKU sedang dibawa teknisi" />
          <Kpi label="Nilai Sedang Dibawa" value={formatRupiah(stock?.total_nilai_sisa || 0)} sub="di luar stok gudang" tone="indigo" />
        </div>

        {/* Alur 3 tahap — penuntun singkat */}
        <div className="no-print grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
          {[
            ['1', 'Bawa dari Gudang', 'Catat No. Bon, teknisi, barang & scan barcode. Stok gudang berkurang.', 'bg-amber-50 border-amber-200 text-amber-900'],
            ['2', 'Realisasi Pemasangan', 'Pasang ke Pelanggan / FO / Tower lengkap SN, lokasi & teknisi pemasang.', 'bg-indigo-50 border-indigo-200 text-indigo-900'],
            ['3', 'Kembalikan Sisa', 'Barang tidak terpakai kembali ke stok gudang + riwayat mutasi & cetak.', 'bg-emerald-50 border-emerald-200 text-emerald-900']
          ].map(([n, t, d, cls]) => (
            <div key={n} className={`flex items-start gap-2 p-3 rounded-xl border ${cls}`}>
              <span className="w-6 h-6 rounded-full bg-white/80 border border-current flex items-center justify-center font-black shrink-0">{n}</span>
              <div><div className="font-bold">{t}</div><div className="opacity-80">{d}</div></div>
            </div>
          ))}
        </div>

        {/* Tab */}
        <div className="no-print flex items-center gap-2 overflow-x-auto scrollbar-none">
          {tabBtn('daftar', 'Daftar Bon', ClipboardList)}
          {tabBtn('riwayat', 'Riwayat Mutasi', History)}
          {tabBtn('laporan', 'Laporan', BarChart3)}
          {tabBtn('teknisi', 'Data Teknisi', Users)}
        </div>

        {/* ===================== DAFTAR BON ===================== */}
        {tab === 'daftar' && (
          <div className="space-y-4">
            {stock?.per_teknisi?.length > 0 && (
              <div className="no-print bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-1.5"><HardHat className="w-4 h-4 text-amber-600" /> Sedang Dibawa Teknisi</h3>
                <div className="flex flex-wrap gap-2">
                  {stock.per_teknisi.map((t) => (
                    <button
                      key={t.teknisi_nama}
                      type="button"
                      onClick={() => { setTeknisi(t.teknisi_nama); setStatus('BERJALAN'); }}
                      className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 hover:bg-amber-100"
                      title="Filter bon berjalan milik teknisi ini"
                    >
                      <span className="font-bold">{t.teknisi_nama}</span>
                      <span className="text-amber-700">{t.divisi ? ` (${DIVISI_LABEL[t.divisi] || t.divisi})` : ''} • {t.jumlah_bon} bon • {formatRupiah(t.nilai_sisa)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="no-print flex flex-col lg:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari No. Bon, teknisi, divisi, keperluan, kode / nama barang..." className={`${inputCls} w-full pl-9`} />
              </div>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} aria-label="Filter status">
                <option value="">Semua Status</option>
                <option value="BERJALAN">Berjalan (masih ada sisa)</option>
                <option value="AKTIF">Dibawa Teknisi (belum ada realisasi)</option>
                <option value="SEBAGIAN">Sebagian Terealisasi</option>
                <option value="SELESAI">Selesai</option>
                <option value="BATAL">Dibatalkan</option>
              </select>
              <select value={fDivisi} onChange={(e) => setFDivisi(e.target.value)} className={inputCls} aria-label="Filter divisi">
                <option value="">Semua Divisi</option>
                {TEKNISI_DIVISI.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
              <select value={teknisi} onChange={(e) => setTeknisi(e.target.value)} className={inputCls} aria-label="Filter teknisi">
                <option value="">Semua Teknisi</option>
                {teknisiNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              {(search || status || teknisi || fDivisi) && (
                <button type="button" onClick={() => { setSearch(''); setStatus(''); setTeknisi(''); setFDivisi(''); }} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50">Reset</button>
              )}
            </div>

            {loadError && (
              <div role="alert" className="no-print flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{loadError}</span>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[920px]">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-3">No. Bon</th>
                      <th className="text-left px-4 py-3">Teknisi</th>
                      <th className="text-left px-4 py-3">Keperluan</th>
                      <th className="text-right px-4 py-3">Nilai Dibawa</th>
                      <th className="text-right px-4 py-3">Terpasang</th>
                      <th className="text-right px-4 py-3">Kembali</th>
                      <th className="text-right px-4 py-3">Sisa di Teknisi</th>
                      <th className="text-left px-4 py-3">Status</th>
                      <th className="text-right px-4 py-3">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading && (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Memuat bon...</td></tr>
                    )}
                    {!loading && loans.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                        {search || status || teknisi ? 'Tidak ada bon yang cocok dengan filter.' : 'Belum ada bon teknisi. Klik "Bon Baru" saat teknisi membawa barang dari gudang.'}
                      </td></tr>
                    )}
                    {!loading && loans.map((l) => {
                      const terbuka = l.status === 'AKTIF' || l.status === 'SEBAGIAN';
                      return (
                        <tr key={l.id} className="hover:bg-slate-50/70">
                          <td className="px-4 py-3 whitespace-nowrap">
                            <button type="button" onClick={() => openDetail(l.id)} className="font-mono font-bold text-indigo-700 hover:underline">{l.no_bon}</button>
                            <div className="text-[10px] text-slate-500">{formatDate(l.tanggal)} • {l.jumlah_jenis} jenis barang</div>
                          </td>
                          <td className="px-4 py-3 font-semibold text-slate-800">
                            {l.teknisi_nama}
                            {l.divisi && <div className="mt-0.5"><DivisiBadge divisi={l.divisi} /></div>}
                          </td>
                          <td className="px-4 py-3 text-slate-600 max-w-[220px]"><div className="truncate" title={l.keperluan}>{l.keperluan || '-'}</div></td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">{formatRupiah(l.nilai_dibawa)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap text-indigo-700">{formatRupiah(l.nilai_terpasang)}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap text-emerald-700">{formatRupiah(l.nilai_kembali)}</td>
                          <td className={`px-4 py-3 text-right whitespace-nowrap font-bold ${terbuka ? 'text-amber-700' : 'text-slate-400'}`}>{formatRupiah(terbuka ? l.nilai_sisa : 0)}</td>
                          <td className="px-4 py-3"><StatusBadge status={l.status} /></td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button type="button" onClick={() => openDetail(l.id)} className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100" title="Lihat detail & riwayat" aria-label="Detail"><Eye className="w-4 h-4" /></button>
                              <button type="button" onClick={() => openPrint(l.id)} className="p-1.5 rounded-lg text-slate-600 hover:bg-slate-100" title="Cetak surat jalan / bon" aria-label="Cetak"><Printer className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================== RIWAYAT MUTASI ===================== */}
        {tab === 'riwayat' && (
          <div className="space-y-4">
            <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={mvSearch} onChange={(e) => setMvSearch(e.target.value)} placeholder="Cari bon, barang, SN, tujuan..." className={`${inputCls} w-full pl-9`} />
              </div>
              <select value={mvJenis} onChange={(e) => setMvJenis(e.target.value)} className={inputCls} aria-label="Jenis mutasi">
                <option value="">Semua Jenis</option>
                <option value="BAWA">Dibawa (gudang → teknisi)</option>
                <option value="PASANG">Dipasang (→ divisi)</option>
                <option value="KEMBALI">Dikembalikan (→ gudang)</option>
                <option value="BATAL">Dibatalkan</option>
              </select>
              <select value={mvTeknisi} onChange={(e) => setMvTeknisi(e.target.value)} className={inputCls} aria-label="Teknisi">
                <option value="">Semua Teknisi</option>
                {teknisiNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input type="date" value={mvStart} onChange={(e) => setMvStart(e.target.value)} className={inputCls} aria-label="Dari tanggal" />
              <input type="date" value={mvEnd} onChange={(e) => setMvEnd(e.target.value)} className={inputCls} aria-label="Sampai tanggal" />
            </div>
            <div className="no-print flex justify-end">
              <button type="button" onClick={exportRiwayat} disabled={!movements.length} className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50">
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[980px]">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-3">Waktu</th>
                      <th className="text-left px-4 py-3">No. Bon</th>
                      <th className="text-left px-4 py-3">Jenis</th>
                      <th className="text-left px-4 py-3">Barang</th>
                      <th className="text-right px-4 py-3">Jumlah</th>
                      <th className="text-left px-4 py-3">SN</th>
                      <th className="text-left px-4 py-3">Tujuan / Lokasi</th>
                      <th className="text-left px-4 py-3">Teknisi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mvLoading && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Memuat riwayat...</td></tr>}
                    {!mvLoading && movements.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Belum ada riwayat mutasi bon yang cocok.</td></tr>}
                    {!mvLoading && movements.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 whitespace-nowrap">{formatDateTime(m.tanggal, m.waktu)}</td>
                        <td className="px-4 py-2.5"><button type="button" onClick={() => openDetail(m.loan_id)} className="font-mono font-bold text-indigo-700 hover:underline">{m.no_bon}</button></td>
                        <td className="px-4 py-2.5"><JenisBadge jenis={m.jenis} /></td>
                        <td className="px-4 py-2.5"><div className="font-medium text-slate-800">{m.nama_barang}</div><div className="font-mono text-[10px] text-slate-500">{m.kode_barang}</div></td>
                        <td className="px-4 py-2.5 text-right font-bold whitespace-nowrap">{formatNumber(m.jumlah)} {m.satuan}</td>
                        <td className="px-4 py-2.5 font-mono">{m.serial_number || '-'}</td>
                        <td className="px-4 py-2.5">
                          {m.jenis === 'PASANG' ? (
                            <>
                              <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${DIVISI_STYLE[m.divisi] || ''}`}>{DIVISI_LABEL[m.divisi] || m.divisi}</span>
                              <div className="font-medium">{m.tujuan_nama}</div>
                              {m.lokasi_tujuan && m.lokasi_tujuan !== m.tujuan_nama && <div className="text-[10px] text-slate-500">{m.lokasi_tujuan}</div>}
                            </>
                          ) : <span className="text-slate-500">{m.jenis === 'BAWA' ? 'Gudang → teknisi' : 'Teknisi → gudang'}</span>}
                        </td>
                        <td className="px-4 py-2.5">{m.teknisi_nama || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===================== DATA TEKNISI ===================== */}
        {tab === 'teknisi' && (
          <div className="no-print">
            <DataTeknisiPanel roster={roster} canManage={canManage} onChanged={async () => { await loadRoster(); loadTechnicians(); loadLoans(); }} />
          </div>
        )}

        {/* ===================== LAPORAN ===================== */}
        {tab === 'laporan' && (
          <div className="space-y-4">
            <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Dari tanggal</label>
                <input type="date" value={rpStart} onChange={(e) => setRpStart(e.target.value)} className={`${inputCls} w-full`} />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Sampai tanggal</label>
                <input type="date" value={rpEnd} onChange={(e) => setRpEnd(e.target.value)} className={`${inputCls} w-full`} />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Status</label>
                <select value={rpStatus} onChange={(e) => setRpStatus(e.target.value)} className={`${inputCls} w-full`}>
                  <option value="">Semua Status</option>
                  <option value="BERJALAN">Berjalan</option>
                  <option value="SELESAI">Selesai</option>
                  <option value="BATAL">Dibatalkan</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Divisi</label>
                <select value={rpDivisi} onChange={(e) => setRpDivisi(e.target.value)} className={`${inputCls} w-full`}>
                  <option value="">Semua Divisi</option>
                  {TEKNISI_DIVISI.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase text-slate-500 mb-0.5">Teknisi</label>
                <select value={rpTeknisi} onChange={(e) => setRpTeknisi(e.target.value)} className={`${inputCls} w-full`}>
                  <option value="">Semua Teknisi</option>
                  {teknisiNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-5 lg:justify-end">
                <button type="button" onClick={() => { setRpStart(''); setRpEnd(''); setRpStatus(''); setRpTeknisi(''); setRpDivisi(''); }} className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50">Semua Periode</button>
                <button type="button" onClick={exportLaporan} disabled={!report?.loans?.length} className="px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"><Download className="w-4 h-4" /> CSV</button>
                <button type="button" onClick={() => window.print()} disabled={!report} className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-900 text-white flex items-center gap-1.5 disabled:opacity-50"><Printer className="w-4 h-4" /> Cetak / PDF</button>
              </div>
            </div>

            {/* Kop cetak laporan */}
            <div className="print-only mb-4 text-center border-b-2 border-slate-800 pb-3">
              <h1 className="text-lg font-black uppercase">PT. CINOXMEDIA NETWORK INDONESIA</h1>
              <p className="text-[11px]">JL. Adityawarman No. 366, Kampung Jawa, Kota Solok</p>
              <h2 className="text-sm font-extrabold uppercase mt-2">Laporan Bon / Barang Bawaan Teknisi</h2>
              <p className="text-[11px]">
                Periode: {rpStart ? formatDate(rpStart) : 'awal'} s/d {rpEnd ? formatDate(rpEnd) : 'sekarang'}
                {rpDivisi ? ` • Divisi: ${DIVISI_LABEL[rpDivisi] || rpDivisi}` : ''}{rpTeknisi ? ` • Teknisi: ${rpTeknisi}` : ''}{rpStatus ? ` • Status: ${rpStatus}` : ''}
              </p>
            </div>

            {rpLoading && !report && <div className="py-12 text-center text-slate-400 text-xs"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Menyusun laporan...</div>}

            {report && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Kpi label="Total Bon" value={formatNumber(report.summary.total_bon)} sub={`${report.summary.bon_berjalan} berjalan • ${report.summary.bon_selesai} selesai • ${report.summary.bon_batal} batal`} />
                  <Kpi label="Nilai Dibawa" value={formatRupiah(report.summary.nilai_dibawa)} tone="amber" />
                  <Kpi label="Nilai Terpasang" value={formatRupiah(report.summary.nilai_terpasang)} tone="indigo" />
                  <Kpi label="Nilai Dikembalikan" value={formatRupiah(report.summary.nilai_kembali)} tone="emerald" sub={`Masih di teknisi: ${formatRupiah(report.summary.nilai_sisa)}`} />
                </div>

                {report.per_divisi_bon?.length > 0 && (
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <h3 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">Rekap per Divisi (Pembawa Bon)</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[560px]">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr>
                          <th className="text-left px-3 py-2">Divisi</th><th className="text-right px-3 py-2">Teknisi</th><th className="text-right px-3 py-2">Bon</th><th className="text-right px-3 py-2">Dibawa</th><th className="text-right px-3 py-2">Terpasang</th><th className="text-right px-3 py-2">Kembali</th><th className="text-right px-3 py-2">Sisa</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.per_divisi_bon.map((d) => (
                            <tr key={d.divisi || '-'}>
                              <td className="px-3 py-2">{d.divisi ? <DivisiBadge divisi={d.divisi} /> : <span className="text-slate-400">Tanpa divisi</span>}</td>
                              <td className="px-3 py-2 text-right">{d.jumlah_teknisi}</td>
                              <td className="px-3 py-2 text-right">{d.jumlah_bon}</td>
                              <td className="px-3 py-2 text-right">{formatRupiah(d.nilai_dibawa)}</td>
                              <td className="px-3 py-2 text-right text-indigo-700">{formatRupiah(d.nilai_terpasang)}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{formatRupiah(d.nilai_kembali)}</td>
                              <td className="px-3 py-2 text-right font-semibold">{formatRupiah(d.nilai_sisa)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <h3 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">Rekap per Teknisi (Pembawa)</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[520px]">
                        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr>
                          <th className="text-left px-3 py-2">Teknisi</th><th className="text-right px-3 py-2">Bon</th><th className="text-right px-3 py-2">Dibawa</th><th className="text-right px-3 py-2">Terpasang</th><th className="text-right px-3 py-2">Kembali</th><th className="text-right px-3 py-2">Sisa</th>
                        </tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.per_teknisi.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Tidak ada data.</td></tr>}
                          {report.per_teknisi.map((t) => (
                            <tr key={t.teknisi_nama}>
                              <td className="px-3 py-2 font-semibold">{t.teknisi_nama}{t.divisi && <span className="ml-1.5"><DivisiBadge divisi={t.divisi} /></span>}</td>
                              <td className="px-3 py-2 text-right">{t.jumlah_bon}{t.bon_berjalan ? <span className="text-amber-700"> ({t.bon_berjalan} jalan)</span> : null}</td>
                              <td className="px-3 py-2 text-right">{formatRupiah(t.nilai_dibawa)}</td>
                              <td className="px-3 py-2 text-right text-indigo-700">{formatRupiah(t.nilai_terpasang)}</td>
                              <td className="px-3 py-2 text-right text-emerald-700">{formatRupiah(t.nilai_kembali)}</td>
                              <td className="px-3 py-2 text-right font-bold text-amber-700">{formatRupiah(t.nilai_sisa)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <h3 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">Realisasi per Divisi Tujuan</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[380px]">
                          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr>
                            <th className="text-left px-3 py-2">Divisi</th><th className="text-right px-3 py-2">Realisasi</th><th className="text-right px-3 py-2">Tujuan</th><th className="text-right px-3 py-2">Nilai Terpasang</th>
                          </tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {report.per_divisi.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Belum ada realisasi pemasangan.</td></tr>}
                            {report.per_divisi.map((d) => (
                              <tr key={d.divisi}>
                                <td className="px-3 py-2"><span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${DIVISI_STYLE[d.divisi] || ''}`}>{DIVISI_LABEL[d.divisi] || d.divisi}</span></td>
                                <td className="px-3 py-2 text-right">{d.jumlah_realisasi}</td>
                                <td className="px-3 py-2 text-right">{d.jumlah_tujuan}</td>
                                <td className="px-3 py-2 text-right font-semibold">{formatRupiah(d.nilai)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                      <h3 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">Rekap per Teknisi Pemasang</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs min-w-[320px]">
                          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr>
                            <th className="text-left px-3 py-2">Teknisi Pemasang</th><th className="text-right px-3 py-2">Realisasi</th><th className="text-right px-3 py-2">Nilai Terpasang</th>
                          </tr></thead>
                          <tbody className="divide-y divide-slate-100">
                            {report.per_pemasang.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Belum ada realisasi pemasangan.</td></tr>}
                            {report.per_pemasang.map((p) => (
                              <tr key={p.teknisi_nama}><td className="px-3 py-2 font-semibold">{p.teknisi_nama}</td><td className="px-3 py-2 text-right">{p.jumlah_realisasi}</td><td className="px-3 py-2 text-right font-semibold">{formatRupiah(p.nilai)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <h3 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">Rekap per Barang</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr>
                        <th className="text-left px-3 py-2">Barang</th><th className="text-right px-3 py-2">Dibawa</th><th className="text-right px-3 py-2">Terpasang</th><th className="text-right px-3 py-2">Kembali</th><th className="text-right px-3 py-2">Masih di Teknisi</th><th className="text-right px-3 py-2">Nilai Dibawa</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.per_barang.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Tidak ada data.</td></tr>}
                        {report.per_barang.map((b) => (
                          <tr key={b.kode_barang}>
                            <td className="px-3 py-2"><div className="font-semibold text-slate-800">{b.nama_barang}</div><div className="font-mono text-[10px] text-slate-500">{b.kode_barang}</div></td>
                            <td className="px-3 py-2 text-right">{formatNumber(b.jumlah_dibawa)} {b.satuan}</td>
                            <td className="px-3 py-2 text-right text-indigo-700">{formatNumber(b.jumlah_terpasang)}</td>
                            <td className="px-3 py-2 text-right text-emerald-700">{formatNumber(b.jumlah_kembali)}</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-700">{formatNumber(b.jumlah_sisa)}</td>
                            <td className="px-3 py-2 text-right">{formatRupiah(b.nilai_dibawa)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <h3 className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100">Daftar Bon pada Periode</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[860px]">
                      <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]"><tr>
                        <th className="text-left px-3 py-2">No. Bon</th><th className="text-left px-3 py-2">Tanggal</th><th className="text-left px-3 py-2">Teknisi</th><th className="text-left px-3 py-2">Keperluan</th><th className="text-right px-3 py-2">Dibawa</th><th className="text-right px-3 py-2">Terpasang</th><th className="text-right px-3 py-2">Kembali</th><th className="text-right px-3 py-2">Sisa</th><th className="text-left px-3 py-2">Status</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.loans.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Tidak ada bon pada periode ini.</td></tr>}
                        {report.loans.map((l) => (
                          <tr key={l.id}>
                            <td className="px-3 py-2 font-mono font-bold">{l.no_bon}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{formatDate(l.tanggal)}</td>
                            <td className="px-3 py-2">{l.teknisi_nama}{l.divisi ? <span className="text-slate-500"> ({DIVISI_LABEL[l.divisi] || l.divisi})</span> : ''}</td>
                            <td className="px-3 py-2">{l.keperluan || '-'}</td>
                            <td className="px-3 py-2 text-right">{formatRupiah(l.nilai_dibawa)}</td>
                            <td className="px-3 py-2 text-right">{formatRupiah(l.nilai_terpasang)}</td>
                            <td className="px-3 py-2 text-right">{formatRupiah(l.nilai_kembali)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{formatRupiah(['AKTIF', 'SEBAGIAN'].includes(l.status) ? l.nilai_sisa : 0)}</td>
                            <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            <div className="print-only mt-10 pt-6 border-t border-slate-300">
              <div className="grid grid-cols-3 gap-6 text-center text-xs">
                {['Dibuat oleh (Staff Gudang)', 'Diperiksa', 'Mengetahui'].map((t) => (
                  <div key={t}><div className="font-semibold">{t}</div><div className="h-16" /><div className="border-t border-slate-700 mx-6 pt-1">(...........................)</div></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===================== MODAL ===================== */}
      {showNew && (
        <BonBaruModal
          items={items}
          roster={roster}
          onRosterChange={loadRoster}
          onClose={() => setShowNew(false)}
          onSaved={(bon) => {
            setShowNew(false);
            refreshAll();
            setDetail(bon);
            // Setelah bon tersimpan, langsung tawarkan cetak surat jalan untuk dibawa teknisi
            setPrintVariant('surat_jalan');
            setPrintLoan(bon);
          }}
        />
      )}

      {detail && !printLoan && !mode && (
        <BonDetailModal
          loan={detail}
          canManage={canManage}
          canInstall={canInstall}
          onClose={() => setDetail(null)}
          onInstall={() => setMode('install')}
          onReturn={() => setMode('return')}
          onCancel={handleCancel}
          onPrint={() => openPrint(detail.id)}
        />
      )}

      {detail && mode === 'install' && (
        <RealisasiModal
          loan={detail}
          customers={customers}
          foSites={foSites}
          towerSites={towerSites}
          roster={roster}
          canManageRoster={canManage}
          onRosterChange={loadRoster}
          onClose={() => setMode(null)}
          onSaved={afterAction}
        />
      )}

      {detail && mode === 'return' && (
        <PengembalianModal loan={detail} onClose={() => setMode(null)} onSaved={afterAction} />
      )}

      {printLoan && (
        <>
          <div className="print-doc"><BonDocument loan={printLoan} variant={printVariant} /></div>
          <BonTeknisiPrintModal
            loan={printLoan}
            variant={printVariant}
            onChangeVariant={setPrintVariant}
            onClose={() => setPrintLoan(null)}
          />
        </>
      )}
    </>
  );
}
