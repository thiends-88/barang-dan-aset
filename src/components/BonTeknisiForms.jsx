// Formulir Bon Teknisi — tiga tahap alur barang bawaan teknisi:
//   1. BonBaruModal         : catat barang yang dibawa teknisi dari gudang (+ scan barcode)
//   2. RealisasiModal       : realisasi pemasangan ke Pelanggan / Divisi FO / Divisi Tower (+ SN, lokasi)
//   3. PengembalianModal    : kembalikan sisa barang yang tidak terpakai ke gudang
// html5-qrcode sengaja TIDAK di-import statis: library kamera besar, jadi dimuat tepat sebelum
// kamera dinyalakan (pola yang sama dengan KeluarMasukBarang / BarcodeScannerModal).
import React, { useState, useEffect, useRef, useId, useMemo } from 'react';
import {
  X, Plus, Trash2, ScanLine, Camera, AlertTriangle, Save, Loader2,
  Wrench, Users, Network, Radio, Undo2, PackageCheck
} from 'lucide-react';
import { notify } from '../utils/notify';
import { todayLocal, formatNumber, formatRupiah } from '../utils/formatters';
import { TeknisiFormModal, TEKNISI_DIVISI } from './DataTeknisi';

// ------------------------------------------------------------------
// Utilitas kecil
// ------------------------------------------------------------------
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { /* respons bukan JSON */ }
  if (!json || !json.success) throw new Error(json?.error || `Permintaan gagal (HTTP ${res.status})`);
  return json;
}

/** Pembungkus modal: bottom sheet di layar kecil, kartu di tengah di layar lebar. */
function ModalShell({ title, subtitle, icon: Icon, accent = 'bg-indigo-600', onClose, children, footer, maxWidth = 'max-w-3xl' }) {
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className={`relative w-full ${maxWidth} bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 sm:my-6 max-h-[92vh] flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0`}>
        <div className={`${accent} text-white px-4 sm:px-6 py-3.5 flex items-center justify-between rounded-t-2xl shrink-0`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-white/80 truncate">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4">{children}</div>
        {footer && <div className="px-4 sm:px-6 py-3 bg-slate-50 border-t border-slate-200 rounded-b-2xl flex items-center justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none';
const labelCls = 'block text-xs font-semibold text-slate-700 mb-1';

// ------------------------------------------------------------------
// Kotak scan barcode (scanner USB = ketik + Enter, atau kamera)
// ------------------------------------------------------------------
function ScanBox({ onScan, hint, title = 'Scan Barcode Stiker Barang' }) {
  const uid = useId().replace(/:/g, '');
  const areaId = `scan-bon-${uid}`;
  const [value, setValue] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [camError, setCamError] = useState('');
  const qrRef = useRef(null);
  const inputRef = useRef(null);

  const stopCamera = () => {
    const inst = qrRef.current;
    qrRef.current = null;
    setCameraOn(false);
    if (inst) inst.stop().then(() => inst.clear().catch(() => {})).catch(() => {});
  };

  const startCamera = async () => {
    try {
      setCamError('');
      setCameraOn(true);
      const { Html5Qrcode } = await import('html5-qrcode');
      const html5 = new Html5Qrcode(areaId);
      qrRef.current = html5;
      await html5.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 280, height: 160 }, aspectRatio: 1.777778 },
        (decoded) => { stopCamera(); onScan(decoded); },
        () => {}
      );
    } catch (err) {
      console.error('Camera start error:', err);
      setCameraOn(false);
      setCamError('Gagal menyalakan kamera. Beri izin kamera di browser, atau gunakan scanner USB / ketik manual.');
    }
  };

  // Kamera wajib mati saat komponen dilepas (modal ditutup)
  useEffect(() => () => stopCamera(), []);

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    onScan(v);
    setValue('');
    inputRef.current?.focus();
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-3 space-y-2">
      <label className="text-xs font-bold text-indigo-800 uppercase tracking-wider flex items-center gap-1.5">
        <ScanLine className="w-4 h-4" />
        {title}
      </label>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
          placeholder="Arahkan scanner USB ke sini, atau ketik kode lalu Enter..."
          className="flex-1 min-w-0 px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-indigo-400 outline-none"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => (cameraOn ? stopCamera() : startCamera())}
          className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition shrink-0 ${cameraOn ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
        >
          <Camera className="w-4 h-4" />
          <span>{cameraOn ? 'Matikan' : 'Kamera'}</span>
        </button>
      </div>
      <div
        id={areaId}
        className={`rounded-lg overflow-hidden bg-slate-900 border border-slate-300 ${cameraOn ? '' : 'hidden'}`}
        style={{ minHeight: cameraOn ? 200 : 0 }}
      />
      {camError && <p className="text-[11px] text-rose-600 font-medium">{camError}</p>}
      {hint && <p className="text-[11px] text-indigo-700">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------------
// TAHAP 1 — Bon baru: teknisi membawa barang dari gudang
// ------------------------------------------------------------------
export function BonBaruModal({ onClose, items, roster = [], onRosterChange = async () => {}, onSaved }) {
  const [noBon, setNoBon] = useState('');
  const [tanggal, setTanggal] = useState(todayLocal());
  const [divisi, setDivisi] = useState('');
  const [teknisiId, setTeknisiId] = useState('');
  const [showAddTeknisi, setShowAddTeknisi] = useState(false);
  const [keperluan, setKeperluan] = useState('');
  const [catatan, setCatatan] = useState('');
  const [rows, setRows] = useState([{ kode_barang: '', jumlah: 1 }]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Hanya barang yang punya stok gudang yang bisa dibawa
  const available = useMemo(
    () => (items || []).filter((it) => Number(it.stok) > 0).sort((a, b) => a.nama_barang.localeCompare(b.nama_barang)),
    [items]
  );
  const byCode = useMemo(() => new Map((items || []).map((it) => [it.kode_barang.toUpperCase(), it])), [items]);

  // Pilihan teknisi mengikuti divisi yang dipilih (hanya yang berstatus aktif)
  const teknisiOptions = useMemo(
    () => roster.filter((t) => t.status === 'aktif' && t.divisi === divisi).sort((a, b) => a.nama.localeCompare(b.nama)),
    [roster, divisi]
  );

  const pilihDivisi = (value) => {
    setDivisi(value);
    setTeknisiId(''); // teknisi harus dipilih ulang dari divisi yang baru
  };

  const totalPerKode = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => {
      if (!r.kode_barang) return;
      m.set(r.kode_barang, (m.get(r.kode_barang) || 0) + (Number(r.jumlah) || 0));
    });
    return m;
  }, [rows]);

  const totalNilai = rows.reduce((a, r) => a + (byCode.get(String(r.kode_barang).toUpperCase())?.harga_barang || 0) * (Number(r.jumlah) || 0), 0);

  const setRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleScan = (raw) => {
    const kode = String(raw || '').trim().toUpperCase();
    if (!kode) return;
    const found = byCode.get(kode);
    if (!found) { setError(`Kode "${kode}" tidak terdaftar di Master Barang`); return; }
    if (Number(found.stok) <= 0) { setError(`Stok gudang untuk ${found.nama_barang} (${found.kode_barang}) kosong`); return; }
    setError('');
    setRows((rs) => {
      const idx = rs.findIndex((r) => r.kode_barang === found.kode_barang);
      if (idx >= 0) return rs.map((r, i) => (i === idx ? { ...r, jumlah: (Number(r.jumlah) || 0) + 1 } : r));
      const kosong = rs.findIndex((r) => !r.kode_barang);
      if (kosong >= 0) return rs.map((r, i) => (i === kosong ? { kode_barang: found.kode_barang, jumlah: 1 } : r));
      return [...rs, { kode_barang: found.kode_barang, jumlah: 1 }];
    });
    notify(`Ditambahkan ke bon: ${found.kode_barang} — ${found.nama_barang}`, 'success');
  };

  const validate = () => {
    if (!divisi) return 'Pilih divisi terlebih dahulu';
    if (!teknisiId) return 'Pilih teknisi yang membawa barang (atau tambahkan teknisi baru)';
    const terisi = rows.filter((r) => r.kode_barang && Number(r.jumlah) > 0);
    if (terisi.length === 0) return 'Tambahkan minimal satu barang dengan jumlah lebih dari 0';
    for (const [kode, qty] of totalPerKode) {
      const it = byCode.get(kode.toUpperCase());
      if (it && qty > Number(it.stok)) {
        return `Stok gudang ${it.nama_barang} (${kode}) tidak mencukupi. Tersedia: ${formatNumber(it.stok)} ${it.satuan}, diminta: ${formatNumber(qty)} ${it.satuan}.`;
      }
    }
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError('');
    try {
      const json = await postJson('/api/technician-loans', {
        no_bon: noBon.trim() || undefined,
        tanggal,
        divisi,
        teknisi_ref_id: Number(teknisiId),
        keperluan: keperluan.trim(),
        catatan: catatan.trim(),
        items: rows.filter((r) => r.kode_barang && Number(r.jumlah) > 0).map((r) => ({ kode_barang: r.kode_barang, jumlah: Number(r.jumlah) }))
      });
      notify(json.message, 'success');
      onSaved(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <ModalShell
      title="Bon Baru — Teknisi Membawa Barang dari Gudang"
      subtitle="Tahap 1 dari 3: stok gudang berkurang dan pindah ke stok dibawa teknisi"
      icon={Wrench}
      accent="bg-amber-600"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 transition">Batal</button>
          <button type="submit" form="form-bon-baru" disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan Bon
          </button>
        </>
      )}
    >
      <form id="form-bon-baru" onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>No. Bon</label>
            <input value={noBon} onChange={(e) => setNoBon(e.target.value)} placeholder="Kosongkan = otomatis (BON-YYYYMM-NNNN)" className={`${inputCls} font-mono`} maxLength={40} />
          </div>
          <div>
            <label className={labelCls}>Tanggal *</label>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Divisi *</label>
            <select value={divisi} onChange={(e) => pilihDivisi(e.target.value)} className={inputCls} aria-label="Divisi" required>
              <option value="">Pilih divisi…</option>
              {TEKNISI_DIVISI.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <label className={labelCls}>Teknisi yang Membawa *</label>
              <button
                type="button"
                onClick={() => setShowAddTeknisi(true)}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-1"
              >
                <Plus className="w-3.5 h-3.5" /> Tambah Teknisi
              </button>
            </div>
            <select
              value={teknisiId}
              onChange={(e) => setTeknisiId(e.target.value)}
              disabled={!divisi}
              className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`}
              aria-label="Teknisi yang membawa"
              required
            >
              <option value="">{divisi ? (teknisiOptions.length ? 'Pilih nama teknisi…' : 'Belum ada teknisi di divisi ini') : 'Pilih divisi dulu…'}</option>
              {teknisiOptions.map((t) => <option key={t.id} value={t.id}>{t.nama}{t.no_hp ? ` — ${t.no_hp}` : ''}</option>)}
            </select>
            {divisi && teknisiOptions.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">Belum ada teknisi aktif di divisi ini — klik <b>Tambah Teknisi</b> untuk menambahkannya.</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Catatan</label>
            <input value={catatan} onChange={(e) => setCatatan(e.target.value)} className={inputCls} />
          </div>
          <div className="sm:col-span-3">
            <label className={labelCls}>Keperluan / Tujuan Pekerjaan</label>
            <input value={keperluan} onChange={(e) => setKeperluan(e.target.value)} placeholder="mis. Instalasi pelanggan baru area Tanah Garam" className={inputCls} />
          </div>
        </div>

        <ScanBox onScan={handleScan} hint="Setiap scan menambah 1 unit barang ke daftar bon (scan lagi = jumlah bertambah). Scanner USB dan kamera sama-sama didukung." />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Daftar Barang yang Dibawa</h4>
            <button type="button" onClick={() => setRows((rs) => [...rs, { kode_barang: '', jumlah: 1 }])} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Tambah Baris
            </button>
          </div>
          <div className="space-y-2">
            {rows.map((r, idx) => {
              const it = byCode.get(String(r.kode_barang).toUpperCase());
              const lebih = it && (totalPerKode.get(r.kode_barang) || 0) > Number(it.stok);
              return (
                <div key={idx} className={`grid grid-cols-12 gap-2 items-center p-2 rounded-xl border ${lebih ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="col-span-12 sm:col-span-7">
                    <select value={r.kode_barang} onChange={(e) => setRow(idx, { kode_barang: e.target.value })} className={inputCls} aria-label="Barang">
                      <option value="">— Pilih barang —</option>
                      {available.map((a) => (
                        <option key={a.id} value={a.kode_barang}>{a.kode_barang} — {a.nama_barang} (stok {formatNumber(a.stok)} {a.satuan})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-7 sm:col-span-3 flex items-center gap-1.5">
                    <input type="number" min="0" step="any" value={r.jumlah} onChange={(e) => setRow(idx, { jumlah: e.target.value })} className={`${inputCls} text-right font-bold`} aria-label="Jumlah" />
                    <span className="text-[11px] text-slate-500 w-10 shrink-0">{it?.satuan || ''}</span>
                  </div>
                  <div className="col-span-5 sm:col-span-2 flex items-center justify-end gap-2">
                    <span className="text-[10px] text-slate-500 text-right leading-tight">{it ? formatRupiah((Number(r.jumlah) || 0) * it.harga_barang) : ''}</span>
                    <button type="button" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, i) => i !== idx) : [{ kode_barang: '', jumlah: 1 }]))} aria-label="Hapus baris" className="p-1.5 text-rose-500 hover:bg-rose-100 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {lebih && <p className="col-span-12 text-[11px] font-semibold text-rose-600">Melebihi stok gudang ({formatNumber(it.stok)} {it.satuan}).</p>}
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-right text-xs text-slate-600">Perkiraan nilai bon: <span className="font-bold text-slate-900">{formatRupiah(totalNilai)}</span></div>
        </div>
      </form>
    </ModalShell>
    {showAddTeknisi && (
      <TeknisiFormModal
        defaultDivisi={divisi || 'DIVISI FO'}
        onClose={() => setShowAddTeknisi(false)}
        onSaved={async (t) => {
          await onRosterChange(); // muat ulang Data Teknisi, lalu langsung pilih teknisi yang baru
          setDivisi(t.divisi);
          setTeknisiId(String(t.id));
          setShowAddTeknisi(false);
        }}
      />
    )}
    </>
  );
}

// ------------------------------------------------------------------
// TAHAP 2 — Realisasi pemasangan dari bon ke divisi
// ------------------------------------------------------------------
const DIVISI_CFG = {
  PELANGGAN: { label: 'Pelanggan', icon: Users, on: 'bg-blue-600 text-white border-blue-600', off: 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50' },
  'DIVISI FO': { label: 'Divisi FO', icon: Network, on: 'bg-emerald-600 text-white border-emerald-600', off: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50' },
  'DIVISI TOWER': { label: 'Divisi Tower', icon: Radio, on: 'bg-purple-600 text-white border-purple-600', off: 'bg-white text-purple-700 border-purple-200 hover:bg-purple-50' }
};

export function RealisasiModal({ onClose, loan, customers, foSites, towerSites, roster = [], canManageRoster = false, onRosterChange = async () => {}, onSaved }) {
  const available = useMemo(() => (loan?.items || []).filter((li) => Number(li.jumlah_sisa) > 0), [loan]);
  const [divisi, setDivisi] = useState('PELANGGAN');
  const [tujuanId, setTujuanId] = useState('');
  const [cari, setCari] = useState('');
  const [lokasi, setLokasi] = useState('');
  const [lokasiManual, setLokasiManual] = useState(false);
  const [pemasang, setPemasang] = useState(loan?.teknisi_nama || '');
  const [tanggal, setTanggal] = useState(todayLocal());
  const [keterangan, setKeterangan] = useState('');
  const [lines, setLines] = useState(() => (available[0] ? [{ loan_item_id: available[0].id, jumlah: 1, serial_number: '' }] : []));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const snRefs = useRef({});

  const [showAddTeknisi, setShowAddTeknisi] = useState(false);

  // Pilihan teknisi pemasang dikelompokkan per divisi; pembawa bon selalu tersedia (juga untuk bon lama
  // yang namanya belum ada di Data Teknisi).
  const pemasangGroups = useMemo(() => {
    const aktif = roster.filter((t) => t.status === 'aktif' || t.nama === loan?.teknisi_nama);
    const groups = TEKNISI_DIVISI
      .map((d) => ({ ...d, list: aktif.filter((t) => t.divisi === d.value).sort((a, b) => a.nama.localeCompare(b.nama)) }))
      .filter((g) => g.list.length > 0);
    const dikenal = new Set(aktif.map((t) => t.nama));
    const lain = loan?.teknisi_nama && !dikenal.has(loan.teknisi_nama) ? [{ id: `bon-${loan.id}`, nama: loan.teknisi_nama }] : [];
    return { groups, lain };
  }, [roster, loan]);

  const tujuanList = useMemo(() => {
    const src = divisi === 'PELANGGAN' ? customers : divisi === 'DIVISI FO' ? foSites : towerSites;
    const label = (r) => (divisi === 'PELANGGAN'
      ? `${r.nama_pelanggan}${r.id_pelanggan ? ` (${r.id_pelanggan})` : ''}`
      : divisi === 'DIVISI FO'
        ? `${r.daerah_lokasi}${r.tipe_lokasi ? ` — ${r.tipe_lokasi}` : ''}`
        : `${r.daerah_lokasi}${r.type ? ` — ${r.type}` : ''}`);
    const q = cari.trim().toLowerCase();
    return (src || []).map((r) => ({ row: r, label: label(r) })).filter((o) => !q || o.label.toLowerCase().includes(q));
  }, [divisi, customers, foSites, towerSites, cari]);

  const selected = tujuanList.find((o) => String(o.row.id) === String(tujuanId))?.row
    || ((divisi === 'PELANGGAN' ? customers : divisi === 'DIVISI FO' ? foSites : towerSites) || []).find((r) => String(r.id) === String(tujuanId));

  // Lokasi tujuan diisi otomatis dari data tujuan, kecuali sudah diubah manual
  useEffect(() => {
    if (lokasiManual) return;
    if (!selected) { setLokasi(''); return; }
    if (divisi === 'PELANGGAN') setLokasi([selected.nama_pelanggan, selected.alamat].filter(Boolean).join(' — '));
    else setLokasi(selected.daerah_lokasi || '');
  }, [selected, divisi, lokasiManual]);

  const pakaiPerItem = useMemo(() => {
    const m = new Map();
    lines.forEach((l) => m.set(l.loan_item_id, (m.get(l.loan_item_id) || 0) + (Number(l.jumlah) || 0)));
    return m;
  }, [lines]);

  const setLine = (idx, patch) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const addLine = (loanItemId) => {
    const next = [...lines, { loan_item_id: loanItemId, jumlah: 1, serial_number: '' }];
    setLines(next);
    return next.length - 1;
  };

  const handleScan = (raw) => {
    const code = String(raw || '').trim();
    if (!code) return;
    const li = available.find((x) => x.kode_barang.toUpperCase() === code.toUpperCase());
    if (li) {
      setError('');
      const sisaBebas = Number(li.jumlah_sisa) - (pakaiPerItem.get(li.id) || 0);
      if (sisaBebas <= 0) { setError(`Sisa ${li.nama_barang} pada bon ini sudah terpakai semua di daftar`); return; }
      // Barang dengan SN: satu baris per unit → fokus ke kolom SN agar SN bisa langsung discan
      const idx = addLine(li.id);
      notify(`Ditambahkan: ${li.kode_barang} — ${li.nama_barang}`, 'success');
      setTimeout(() => snRefs.current[idx]?.focus(), 80);
      return;
    }
    // Bukan kode barang di bon ini → anggap SN untuk baris terakhir yang SN-nya masih kosong
    const idxKosong = [...lines.keys()].reverse().find((i) => !lines[i].serial_number);
    if (idxKosong !== undefined) {
      setError('');
      setLine(idxKosong, { serial_number: code, jumlah: 1 });
      notify(`SN ${code} dicatat untuk baris ${idxKosong + 1}`, 'success');
    } else {
      setError(`"${code}" bukan kode barang pada bon ${loan.no_bon}, dan tidak ada baris tanpa SN untuk diisi`);
    }
  };

  const validate = () => {
    if (!tujuanId) return `Pilih data tujuan ${DIVISI_CFG[divisi].label} tempat barang dipasang`;
    if (!pemasang.trim()) return 'Nama teknisi yang memasang wajib diisi';
    const valid = lines.filter((l) => Number(l.jumlah) > 0);
    if (valid.length === 0) return 'Isi minimal satu barang dengan jumlah lebih dari 0';
    for (const [id, qty] of pakaiPerItem) {
      const li = available.find((x) => x.id === id);
      if (li && qty > Number(li.jumlah_sisa)) return `Jumlah ${li.nama_barang} (${formatNumber(qty)}) melebihi sisa yang dibawa teknisi (${formatNumber(li.jumlah_sisa)} ${li.satuan})`;
    }
    const sns = new Set();
    for (const l of valid) {
      const sn = l.serial_number.trim();
      if (!sn) continue;
      if (Number(l.jumlah) !== 1) return `Barang bernomor seri (SN ${sn}) harus 1 unit per baris`;
      const key = `${l.loan_item_id}|${sn.toUpperCase()}`;
      if (sns.has(key)) return `SN ${sn} diisi lebih dari satu kali`;
      sns.add(key);
    }
    return '';
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) { setError(v); return; }
    setSaving(true);
    setError('');
    try {
      const json = await postJson(`/api/technician-loans/${loan.id}/install`, {
        divisi,
        tujuan_id: Number(tujuanId),
        lokasi_tujuan: lokasi.trim(),
        teknisi_pemasang: pemasang.trim(),
        tanggal,
        keterangan: keterangan.trim(),
        items: lines.filter((l) => Number(l.jumlah) > 0).map((l) => ({ loan_item_id: l.loan_item_id, jumlah: Number(l.jumlah), serial_number: l.serial_number.trim() }))
      });
      notify(json.message, 'success');
      onSaved(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <ModalShell
      title={`Realisasi Pemasangan — ${loan.no_bon}`}
      subtitle={`Tahap 2 dari 3: barang bawaan ${loan.teknisi_nama} dipasang ke divisi (stok gudang tidak berubah)`}
      icon={PackageCheck}
      accent="bg-indigo-600"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 transition">Batal</button>
          <button type="submit" form="form-realisasi" disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan Realisasi
          </button>
        </>
      )}
    >
      <form id="form-realisasi" onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />

        <div>
          <label className={labelCls}>Dipasang ke Divisi *</label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(DIVISI_CFG).map(([key, cfg]) => {
              const Icon = cfg.icon;
              return (
                <button
                  type="button"
                  key={key}
                  onClick={() => { setDivisi(key); setTujuanId(''); setCari(''); setLokasiManual(false); }}
                  className={`px-2 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition ${divisi === key ? cfg.on : cfg.off}`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>
              {divisi === 'PELANGGAN' ? 'Pelanggan Tujuan' : divisi === 'DIVISI FO' ? 'Titik FO Tujuan' : 'Site Tower Tujuan'} *
            </label>
            <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama / ID / lokasi..." className={`${inputCls} mb-1.5`} />
            <select value={tujuanId} onChange={(e) => { setTujuanId(e.target.value); setLokasiManual(false); }} className={inputCls} required>
              <option value="">— Pilih tujuan ({tujuanList.length} data) —</option>
              {tujuanList.map((o) => <option key={o.row.id} value={o.row.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Lokasi Tujuan</label>
            <input value={lokasi} onChange={(e) => { setLokasi(e.target.value); setLokasiManual(true); }} placeholder="Terisi otomatis dari data tujuan — boleh dilengkapi (mis. patokan alamat / nama tiang)" className={inputCls} />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className={labelCls}>Teknisi yang Memasang *</label>
              {canManageRoster && (
                <button type="button" onClick={() => setShowAddTeknisi(true)} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mb-1">
                  <Plus className="w-3.5 h-3.5" /> Tambah Teknisi
                </button>
              )}
            </div>
            <select value={pemasang} onChange={(e) => setPemasang(e.target.value)} className={inputCls} aria-label="Teknisi yang memasang" required>
              {pemasangGroups.lain.map((t) => <option key={t.id} value={t.nama}>{t.nama}</option>)}
              {pemasangGroups.groups.map((g) => (
                <optgroup key={g.value} label={g.label}>
                  {g.list.map((t) => <option key={t.id} value={t.nama}>{t.nama}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Tanggal Pasang *</label>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={inputCls} required />
          </div>
        </div>

        <ScanBox
          title="Scan Barcode Barang / Serial Number"
          onScan={handleScan}
          hint="Scan stiker kode barang → baris baru; lalu scan barcode SN perangkat → SN terisi di baris tersebut."
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Barang yang Dipasang</h4>
            <button type="button" onClick={() => available[0] && addLine(available[0].id)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Tambah Baris
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, idx) => {
              const li = available.find((x) => x.id === l.loan_item_id);
              const lebih = li && (pakaiPerItem.get(li.id) || 0) > Number(li.jumlah_sisa);
              return (
                <div key={idx} className={`grid grid-cols-12 gap-2 items-center p-2 rounded-xl border ${lebih ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50/60'}`}>
                  <div className="col-span-12 sm:col-span-5">
                    <select value={l.loan_item_id} onChange={(e) => setLine(idx, { loan_item_id: Number(e.target.value) })} className={inputCls} aria-label="Barang">
                      {available.map((a) => (
                        <option key={a.id} value={a.id}>{a.kode_barang} — {a.nama_barang} (sisa {formatNumber(a.jumlah_sisa)} {a.satuan})</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-5 sm:col-span-2 flex items-center gap-1">
                    <input type="number" min="0" step="any" value={l.jumlah} onChange={(e) => setLine(idx, { jumlah: e.target.value })} className={`${inputCls} text-right font-bold`} aria-label="Jumlah" />
                    <span className="text-[11px] text-slate-500 shrink-0">{li?.satuan}</span>
                  </div>
                  <div className="col-span-6 sm:col-span-4">
                    <input
                      ref={(el) => { snRefs.current[idx] = el; }}
                      value={l.serial_number}
                      onChange={(e) => setLine(idx, { serial_number: e.target.value })}
                      placeholder="Serial Number (opsional)"
                      className={`${inputCls} font-mono`}
                      aria-label="Serial Number"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button type="button" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} aria-label="Hapus baris" className="p-1.5 text-rose-500 hover:bg-rose-100 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  {lebih && <p className="col-span-12 text-[11px] font-semibold text-rose-600">Melebihi sisa bon ({formatNumber(li.jumlah_sisa)} {li.satuan}).</p>}
                </div>
              );
            })}
            {lines.length === 0 && <p className="text-xs text-slate-500 italic">Belum ada baris. Klik "Tambah Baris" atau scan barcode barang.</p>}
          </div>
        </div>

        <div>
          <label className={labelCls}>Keterangan</label>
          <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={inputCls} placeholder="Opsional" />
        </div>
      </form>
    </ModalShell>
    {showAddTeknisi && (
      <TeknisiFormModal
        defaultDivisi={TEKNISI_DIVISI.some((d) => d.value === loan?.divisi) ? loan.divisi : 'DIVISI FO'}
        onClose={() => setShowAddTeknisi(false)}
        onSaved={async (t) => {
          await onRosterChange();
          setPemasang(t.nama);
          setShowAddTeknisi(false);
        }}
      />
    )}
    </>
  );
}

// ------------------------------------------------------------------
// TAHAP 3 — Pengembalian sisa barang ke gudang
// ------------------------------------------------------------------
export function PengembalianModal({ onClose, loan, onSaved }) {
  const available = useMemo(() => (loan?.items || []).filter((li) => Number(li.jumlah_sisa) > 0), [loan]);
  const [qty, setQty] = useState(() => Object.fromEntries(available.map((li) => [li.id, ''])));
  const [kondisi, setKondisi] = useState(() => Object.fromEntries(available.map((li) => [li.id, 'Baik'])));
  const [kondisiGlobal, setKondisiGlobal] = useState('Baik');
  const [tanggal, setTanggal] = useState(todayLocal());
  const [pengembali, setPengembali] = useState(loan?.teknisi_nama || '');
  const [keterangan, setKeterangan] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const isiSemua = () => setQty(Object.fromEntries(available.map((li) => [li.id, String(li.jumlah_sisa)])));
  const samakanKondisi = (k) => {
    setKondisiGlobal(k);
    setKondisi(Object.fromEntries(available.map((li) => [li.id, k])));
  };

  const submit = async (e) => {
    e.preventDefault();
    const rows = available.filter((li) => Number(qty[li.id]) > 0).map((li) => ({ loan_item_id: li.id, jumlah: Number(qty[li.id]), kondisi: kondisi[li.id] || kondisiGlobal || 'Baik' }));
    if (rows.length === 0) { setError('Isi jumlah yang dikembalikan minimal pada satu barang'); return; }
    for (const li of available) {
      if (Number(qty[li.id]) > Number(li.jumlah_sisa)) { setError(`Jumlah ${li.nama_barang} melebihi sisa yang dibawa teknisi (${formatNumber(li.jumlah_sisa)} ${li.satuan})`); return; }
    }
    setSaving(true);
    setError('');
    try {
      const json = await postJson(`/api/technician-loans/${loan.id}/return`, {
        tanggal, dikembalikan_oleh: pengembali.trim(), keterangan: keterangan.trim(), items: rows, kondisi: kondisiGlobal
      });
      notify(json.message, 'success');
      onSaved(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Kembalikan Sisa Barang — ${loan.no_bon}`}
      subtitle={`Tahap 3 dari 3: sisa yang tidak terpakai oleh ${loan.teknisi_nama} kembali ke stok gudang`}
      icon={Undo2}
      accent="bg-emerald-600"
      maxWidth="max-w-2xl"
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 transition">Batal</button>
          <button type="submit" form="form-pengembalian" disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Simpan Pengembalian
          </button>
        </>
      )}
    >
      <form id="form-pengembalian" onSubmit={submit} className="space-y-4">
        <ErrorBox message={error} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Tanggal Pengembalian *</label>
            <input type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>Dikembalikan Oleh</label>
            <input value={pengembali} onChange={(e) => setPengembali(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Keterangan</label>
            <input value={keterangan} onChange={(e) => setKeterangan(e.target.value)} className={inputCls} placeholder="Opsional" />
          </div>
        </div>

        <div className="p-3 rounded-xl border border-amber-200 bg-amber-50">
          <label className={labelCls}>Kondisi Barang Saat Dikembalikan</label>
          <div className="flex flex-wrap items-center gap-2">
            <select value={kondisiGlobal} onChange={(e) => samakanKondisi(e.target.value)} className={inputCls + ' max-w-[220px] font-semibold'}>
              <option value="Baik">Baik — kembali ke stok siap pakai</option>
              <option value="Rusak Ringan">Rusak Ringan — masuk gudang rusak</option>
              <option value="Rusak Berat">Rusak Berat — masuk gudang rusak</option>
              <option value="Afkir">Afkir — masuk gudang rusak</option>
            </select>
            <span className="text-[11px] text-amber-800">Pilih kondisi, atau ubah per baris di tabel.</span>
          </div>
          {kondisiGlobal !== 'Baik' && (
            <p className="text-[11px] text-amber-800 mt-2">Barang rusak tidak menambah stok siap pakai — tercatat di Gudang Barang Rusak / Afkir. Mutasi tetap tercatat.</p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Sisa yang Dibawa Teknisi</h4>
          <button type="button" onClick={isiSemua} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200">
            Kembalikan Semua Sisa
          </button>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Barang</th>
                <th className="text-right px-3 py-2">Dibawa</th>
                <th className="text-right px-3 py-2">Terpasang</th>
                <th className="text-right px-3 py-2">Sisa</th>
                <th className="text-left px-3 py-2">Kondisi</th>
                <th className="text-right px-3 py-2 w-32">Dikembalikan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {available.map((li) => (
                <tr key={li.id}>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-slate-800">{li.nama_barang}</div>
                    <div className="font-mono text-[10px] text-slate-500">{li.kode_barang}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{formatNumber(li.jumlah_dibawa)}</td>
                  <td className="px-3 py-2 text-right">{formatNumber(li.jumlah_terpasang)}</td>
                  <td className="px-3 py-2 text-right font-bold text-amber-700">{formatNumber(li.jumlah_sisa)} {li.satuan}</td>
                  <td className="px-3 py-2">
                    <select value={kondisi[li.id] || 'Baik'} onChange={(e) => setKondisi((c) => ({ ...c, [li.id]: e.target.value }))} className={`${inputCls} text-xs font-semibold`}>
                      <option value="Baik">Baik</option>
                      <option value="Rusak Ringan">Rusak Ringan</option>
                      <option value="Rusak Berat">Rusak Berat</option>
                      <option value="Afkir">Afkir</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min="0" max={li.jumlah_sisa} step="any" value={qty[li.id] ?? ''} onChange={(e) => setQty((q) => ({ ...q, [li.id]: e.target.value }))} placeholder="0" className={`${inputCls} text-right font-bold`} aria-label={`Jumlah kembali ${li.nama_barang}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500">Barang yang sudah terpasang tidak ikut dikembalikan. Sisa yang tidak dikembalikan tetap tercatat sebagai stok dibawa teknisi.</p>
      </form>
    </ModalShell>
  );
}
