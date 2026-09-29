import React, { useState, useRef, useCallback } from 'react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileUp,
  Info
} from 'lucide-react';
import { notify } from '../utils/notify';

// ============================================================
// Konfigurasi kolom per jenis import
// ============================================================
const IMPORT_CONFIG = {
  items: {
    title: 'Import Master Barang',
    subtitle: 'Tambah atau perbarui banyak data barang sekaligus dari file CSV / Excel',
    endpoint: '/api/items/import',
    keyField: 'kode_barang',
    keyLabel: 'Kode Barang',
    columns: [
      { key: 'kode_barang', required: true, aliases: ['kode_barang', 'kodebarang', 'kode', 'kode barang', 'kd_barang', 'sku', 'item_code'] },
      { key: 'nama_barang', required: true, aliases: ['nama_barang', 'namabarang', 'nama', 'nama barang', 'item_name', 'deskripsi'] },
      { key: 'satuan', aliases: ['satuan', 'unit', 'uom'] },
      { key: 'jenis_barang', required: true, aliases: ['jenis_barang', 'jenisbarang', 'jenis', 'jenis barang', 'kategori', 'category'] },
      { key: 'stok', type: 'number', aliases: ['stok', 'stock', 'qty', 'jumlah', 'stok_awal', 'stok awal'] },
      { key: 'min_stok', type: 'number', aliases: ['min_stok', 'minstok', 'min stok', 'stok_minimum', 'stok minimum'] },
      { key: 'harga_barang', type: 'number', aliases: ['harga_barang', 'hargabarang', 'harga', 'harga barang', 'harga_satuan', 'harga satuan', 'price'] },
      { key: 'referensi_suplayer', aliases: ['referensi_suplayer', 'referensi suplayer', 'supplier', 'suplayer', 'referensi'] },
      { key: 'catatan', aliases: ['catatan', 'note', 'notes', 'keterangan'] }
    ]
  },
  customers: {
    title: 'Import Data Pelanggan',
    subtitle: 'Tambah atau perbarui banyak data pelanggan sekaligus dari file CSV / Excel',
    endpoint: '/api/customers/import',
    keyField: 'id_pelanggan',
    keyLabel: 'ID Pelanggan',
    columns: [
      { key: 'id_pelanggan', required: true, aliases: ['id_pelanggan', 'idpelanggan', 'id', 'id pelanggan', 'idpel', 'customer_id'] },
      { key: 'nama_pelanggan', required: true, aliases: ['nama_pelanggan', 'namapelanggan', 'nama', 'nama pelanggan', 'customer_name'] },
      { key: 'infrastruktur', aliases: ['infrastruktur', 'infra', 'tipe_jaringan', 'jaringan'], help: 'optic / wireless' },
      { key: 'paket', aliases: ['paket', 'package', 'paket_layanan'], help: 'home, soho, dedicated, dll' },
      { key: 'keterangan_paket', aliases: ['keterangan_paket', 'keterangan paket', 'ket_paket', 'bandwidth', 'kecepatan'] },
      { key: 'kategori', aliases: ['kategori', 'kategori_layanan'], help: 'bandwidth / rent / service / lainnya' },
      { key: 'status', aliases: ['status', 'status_pelanggan'], help: 'aktif / blokir / cuti / putus' },
      { key: 'alamat', aliases: ['alamat', 'address', 'alamat_pasang', 'lokasi'] },
      { key: 'telepon', aliases: ['telepon', 'telp', 'phone', 'hp', 'no_hp', 'no hp', 'no_telepon'] },
      { key: 'tanggal_pasang', type: 'date', aliases: ['tanggal_pasang', 'tanggal pasang', 'tgl_pasang', 'tgl pasang', 'install_date'], help: 'YYYY-MM-DD / DD/MM/YYYY' },
      { key: 'catatan', aliases: ['catatan', 'note', 'notes', 'keterangan'] }
    ]
  }
};

// ============================================================
// Utilitas parsing
// ============================================================

/** Normalisasi header file: huruf kecil, spasi → underscore, buang karakter non-alfanumerik. */
function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/** Bangun peta alias → key kolom target. */
function buildAliasMap(columns) {
  const map = {};
  for (const col of columns) {
    map[normalizeHeader(col.key)] = col.key;
    for (const a of col.aliases || []) map[normalizeHeader(a)] = col.key;
  }
  return map;
}

/** Parsing angka fleksibel: dukung format Indonesia ("1.500.000" / "12,5"), simbol Rp, dsb. */
function parseFlexibleNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  let s = String(v ?? '').trim();
  if (!s) return '';
  s = s.replace(/[^0-9.,()-]/g, '').replace(/[()]/g, '');
  if (!s) return '';
  // anggap titik/koma sebagai pemisah ribuan bila diikuti tepat 3 digit
  s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : String(v).trim(); // gagal → teruskan apa adanya, server yang menolak
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** Normalisasi tanggal ke YYYY-MM-DD dari Date, serial Excel, atau string umum. */
function normalizeDateValue(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  return s;
}

/** Validasi sisi klien per baris, mengembalikan pesan error atau null. */
function validateRowClient(row, cfg, seenKeys) {
  for (const col of cfg.columns) {
    if (col.required && !String(row[col.key] ?? '').trim()) {
      return `Kolom wajib "${col.key}" kosong`;
    }
  }
  const keyVal = String(row[cfg.keyField] ?? '').trim().toUpperCase();
  if (keyVal) {
    if (seenKeys.has(keyVal)) return `${cfg.keyLabel} "${keyVal}" duplikat di file`;
    seenKeys.add(keyVal);
  }
  for (const col of cfg.columns) {
    if (col.type === 'number') {
      const v = row[col.key];
      if (v !== '' && v !== undefined && v !== null) {
        const n = Number(v);
        if (!Number.isFinite(n)) return `"${col.key}" bukan angka: "${v}"`;
        if (n < 0) return `"${col.key}" tidak boleh negatif`;
      }
    }
    if (col.type === 'date') {
      const v = String(row[col.key] ?? '').trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `"${col.key}" tidak dikenal: "${v}"`;
    }
  }
  return null;
}

// ============================================================
// Komponen utama
// ============================================================
export default function ImportDataModal({ isOpen, onClose, type, onImported }) {
  const cfg = IMPORT_CONFIG[type] || IMPORT_CONFIG.items;
  const fileInputRef = useRef(null);

  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);     // baris siap kirim ke server
  const [rowErrors, setRowErrors] = useState({});        // { index: pesan }
  const [unmappedHeaders, setUnmappedHeaders] = useState([]);
  const [mode, setMode] = useState('skip');
  const [parseError, setParseError] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const resetState = useCallback(() => {
    setFileName('');
    setParsedRows([]);
    setRowErrors({});
    setUnmappedHeaders([]);
    setMode('skip');
    setParseError('');
    setIsParsing(false);
    setIsImporting(false);
    setResult(null);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleFile = async (file) => {
    if (!file) return;
    setParseError('');
    setResult(null);
    setIsParsing(true);
    setFileName(file.name);

    try {
      const XLSX = await import('xlsx');
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      let workbook;
      if (ext === 'csv' || ext === 'txt') {
        // CSV: baca sebagai teks murni agar data seperti "0812..." tidak dikonversi jadi angka
        const text = await file.text();
        workbook = XLSX.read(text, { type: 'string', raw: true });
      } else {
        const buffer = await file.arrayBuffer();
        workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      }
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('File tidak memiliki lembar data');
      const ws = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

      if (!json.length) throw new Error('File tidak berisi baris data (pastikan baris pertama adalah header kolom)');

      const aliasMap = buildAliasMap(cfg.columns);
      const knownKeys = new Set(cfg.columns.map((c) => c.key));

      // Petakan header file → kolom target
      const headers = Object.keys(json[0]);
      const headerMap = {};
      const unknown = [];
      for (const h of headers) {
        const target = aliasMap[normalizeHeader(h)];
        if (target && knownKeys.has(target)) headerMap[h] = target;
        else if (String(h).trim()) unknown.push(h);
      }
      setUnmappedHeaders(unknown);

      const keyHeaderFound = Object.values(headerMap).includes(cfg.keyField);
      if (!keyHeaderFound) {
        throw new Error(
          `Kolom utama "${cfg.keyField}" tidak ditemukan di file. Header terbaca: ${headers.join(', ')}`
        );
      }

      const rows = json.map((raw) => {
        const row = {};
        for (const [srcKey, targetKey] of Object.entries(headerMap)) {
          let val = raw[srcKey];
          const colDef = cfg.columns.find((c) => c.key === targetKey);
          if (colDef?.type === 'number') val = parseFlexibleNumber(val);
          else if (colDef?.type === 'date') val = normalizeDateValue(val);
          // kolom teks: angka polos diubah ke string agar telepon/ID numerik tetap utuh
          else val = typeof val === 'number' ? String(val) : String(val ?? '').trim();
          if (row[targetKey] === undefined || row[targetKey] === '') row[targetKey] = val;
        }
        return row;
      }).filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''));

      if (!rows.length) throw new Error('Semua baris data kosong');

      // Validasi klien
      const seen = new Set();
      const errs = {};
      rows.forEach((row, idx) => {
        const msg = validateRowClient(row, cfg, seen);
        if (msg) errs[idx] = msg;
      });

      setParsedRows(rows);
      setRowErrors(errs);
    } catch (err) {
      console.error('Import parse error:', err);
      setParseError(err.message || 'Gagal membaca file. Pastikan format CSV atau Excel (.xlsx) valid.');
      setParsedRows([]);
      setRowErrors({});
    } finally {
      setIsParsing(false);
    }
  };

  const handleInputChange = (e) => handleFile(e.target.files?.[0]);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const validCount = parsedRows.length - Object.keys(rowErrors).length;

  const handleImport = async () => {
    const rowsToSend = parsedRows.filter((_, idx) => !rowErrors[idx]);
    if (!rowsToSend.length) {
      notify('Tidak ada baris valid untuk diimport', 'error');
      return;
    }
    setIsImporting(true);
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rowsToSend, mode })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'Import gagal', 'error');
        return;
      }
      setResult(data.data);
      const { inserted, updated, skipped, failed } = data.data;
      const parts = [];
      if (inserted) parts.push(`${inserted} ditambahkan`);
      if (updated) parts.push(`${updated} diperbarui`);
      if (skipped) parts.push(`${skipped} dilewati`);
      if (failed) parts.push(`${failed} gagal`);
      if (inserted > 0 || updated > 0) {
        notify(`Import selesai: ${parts.join(', ')}`, 'success');
        onImported && onImported();
      } else {
        notify(`Import selesai tanpa perubahan: ${parts.join(', ')}`, 'error');
      }
    } catch (err) {
      notify('Gagal terhubung ke server saat import', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  const previewRows = parsedRows.slice(0, 10);
  const previewCols = cfg.columns.slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 sm:my-8 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-4 sm:px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/50 flex items-center justify-center border border-indigo-400/30">
              <FileUp className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="text-lg font-bold">{cfg.title}</h3>
              <p className="text-xs text-indigo-200">{cfg.subtitle}</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-white/10 transition" title="Tutup">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {/* Hasil import */}
          {result ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-700">{result.inserted}</div>
                  <div className="text-xs text-emerald-600 font-medium">Ditambahkan</div>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-blue-700">{result.updated}</div>
                  <div className="text-xs text-blue-600 font-medium">Diperbarui</div>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-amber-700">{result.skipped}</div>
                  <div className="text-xs text-amber-600 font-medium">Dilewati</div>
                </div>
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center">
                  <div className="text-2xl font-bold text-rose-700">{result.failed}</div>
                  <div className="text-xs text-rose-600 font-medium">Gagal</div>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="border border-rose-200 bg-rose-50 rounded-xl p-3 max-h-48 overflow-y-auto">
                  <div className="text-xs font-bold text-rose-700 mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Detail baris yang gagal:
                  </div>
                  <ul className="space-y-1 text-xs text-rose-700">
                    {result.errors.map((e, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="font-mono font-semibold whitespace-nowrap">Baris {e.baris}</span>
                        <span>{e.error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={resetState}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-300 transition"
                >
                  Import File Lain
                </button>
                <button
                  onClick={handleClose}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition"
                >
                  Selesai
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition ${
                  isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-slate-50 hover:border-indigo-300'
                }`}
              >
                <FileSpreadsheet className="w-10 h-10 mx-auto text-indigo-400 mb-2" />
                <p className="text-sm font-semibold text-slate-700">
                  {isParsing ? 'Membaca file...' : 'Seret & letakkan file di sini'}
                </p>
                <p className="text-xs text-slate-500 mt-1">Mendukung .xlsx, .xls, .csv (pemisah koma atau titik koma)</p>
                <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isParsing}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition"
                  >
                    {isParsing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span>{isParsing ? 'Memproses...' : 'Pilih File'}</span>
                  </button>
                  {/* Template diunduh langsung dari server agar tidak diblokir browser/iframe */}
                  <a
                    href={`/api/import/template/${type}?format=xlsx`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-2 transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>Template Excel</span>
                  </a>
                  <a
                    href={`/api/import/template/${type}?format=csv`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl flex items-center gap-2 border border-slate-300 transition"
                  >
                    <Download className="w-4 h-4" />
                    <span>Template CSV</span>
                  </a>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleInputChange}
                  className="hidden"
                />
              </div>

              {/* Info kolom */}
              <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                <Info className="w-3.5 h-3.5 mt-0.5 text-indigo-400 shrink-0" />
                <div>
                  <span className="font-semibold text-slate-600">Kolom wajib:</span>{' '}
                  {cfg.columns.filter((c) => c.required).map((c) => c.key).join(', ')}.{' '}
                  <span className="font-semibold text-slate-600">Opsional:</span>{' '}
                  {cfg.columns.filter((c) => !c.required).map((c) => c.key).join(', ')}.
                  Baris pertama file harus berisi nama kolom (header).
                </div>
              </div>

              {parseError && (
                <div className="mt-3 flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{parseError}</span>
                </div>
              )}

              {/* Ringkasan & Preview */}
              {parsedRows.length > 0 && !parseError && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5">
                      📄 {fileName}
                    </span>
                    <span className="text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5">
                      {parsedRows.length} baris
                    </span>
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> {validCount} valid
                    </span>
                    {Object.keys(rowErrors).length > 0 && (
                      <span className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> {Object.keys(rowErrors).length} bermasalah (otomatis dilewati)
                      </span>
                    )}
                  </div>

                  {unmappedHeaders.length > 0 && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Kolom tidak dikenal & diabaikan: <span className="font-mono">{unmappedHeaders.join(', ')}</span>
                    </p>
                  )}

                  {/* Mode duplikat */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 bg-slate-50 border border-slate-200 rounded-xl p-3">
                    <span className="text-xs font-semibold text-slate-600">Jika {cfg.keyLabel} sudah ada di database:</span>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input type="radio" name="import-mode" checked={mode === 'skip'} onChange={() => setMode('skip')} className="accent-indigo-600" />
                      Lewati (data lama dipertahankan)
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                      <input type="radio" name="import-mode" checked={mode === 'update'} onChange={() => setMode('update')} className="accent-indigo-600" />
                      Perbarui dengan data file
                    </label>
                  </div>

                  {/* Tabel preview */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto max-h-64 overflow-y-auto">
                      <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="bg-slate-100 text-slate-600 uppercase tracking-wider font-semibold sticky top-0">
                          <tr>
                            <th className="py-2 px-3 w-10">#</th>
                            {previewCols.map((c) => (
                              <th key={c.key} className="py-2 px-3">{c.key}{c.required && <span className="text-rose-500">*</span>}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {previewRows.map((row, idx) => (
                            <tr key={idx} className={rowErrors[idx] ? 'bg-rose-50' : idx % 2 ? 'bg-slate-50/50' : ''}>
                              <td className="py-1.5 px-3 text-slate-400 font-mono">{idx + 2}</td>
                              {previewCols.map((c) => (
                                <td key={c.key} className="py-1.5 px-3 text-slate-700 max-w-[180px] truncate">
                                  {String(row[c.key] ?? '') || <span className="text-slate-300">—</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {parsedRows.length > previewRows.length && (
                      <div className="text-[11px] text-slate-400 text-center py-1.5 bg-slate-50 border-t border-slate-200">
                        Menampilkan {previewRows.length} dari {parsedRows.length} baris
                      </div>
                    )}
                  </div>

                  {/* Daftar error klien (maks 5 pertama) */}
                  {Object.keys(rowErrors).length > 0 && (
                    <div className="border border-rose-200 bg-rose-50 rounded-xl p-3 max-h-32 overflow-y-auto">
                      <ul className="space-y-1 text-xs text-rose-700">
                        {Object.entries(rowErrors).slice(0, 20).map(([idx, msg]) => (
                          <li key={idx} className="flex gap-2">
                            <span className="font-mono font-semibold whitespace-nowrap">Baris {Number(idx) + 2}</span>
                            <span>{msg}</span>
                          </li>
                        ))}
                        {Object.keys(rowErrors).length > 20 && (
                          <li className="text-rose-500">…dan {Object.keys(rowErrors).length - 20} lainnya</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="px-4 sm:px-6 py-3.5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-600 text-xs font-semibold rounded-xl border border-slate-300 transition"
            >
              Batal
            </button>
            <button
              onClick={handleImport}
              disabled={!parsedRows.length || validCount === 0 || isImporting || isParsing}
              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-sm transition"
            >
              {isImporting ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /><span>Mengimport...</span></>
              ) : (
                <><Upload className="w-4 h-4" /><span>Import {validCount > 0 ? `${validCount} Baris` : ''}</span></>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
