// Data Teknisi — master nama petugas lapangan per divisi (Pelanggan / Divisi FO / Divisi Tower).
// Dipakai sebagai pilihan "divisi → nama teknisi" di Bon Teknisi, sehingga nama tidak perlu diketik
// ulang (dan tidak terpecah oleh salah ketik) setiap membuat bon / mencatat realisasi.
//   - DataTeknisiPanel   : tab "Data Teknisi" (daftar + tambah / ubah / nonaktifkan / hapus)
//   - TeknisiFormModal   : formulir tambah / ubah teknisi (juga dipakai tombol "+ Tambah Teknisi" di form bon)
import React, { useState, useMemo } from 'react';
import { X, Plus, Pencil, Trash2, Save, Loader2, Search, UserCheck, UserX, HardHat, AlertTriangle } from 'lucide-react';
import { notify } from '../utils/notify';

export const TEKNISI_DIVISI = [
  { value: 'PELANGGAN', label: 'Pelanggan' },
  { value: 'DIVISI FO', label: 'Divisi FO' },
  { value: 'DIVISI TOWER', label: 'Divisi Tower' }
];
export const TEKNISI_DIVISI_LABEL = Object.fromEntries(TEKNISI_DIVISI.map((d) => [d.value, d.label]));
export const TEKNISI_DIVISI_STYLE = {
  PELANGGAN: 'bg-blue-50 text-blue-700 border-blue-200',
  'DIVISI FO': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'DIVISI TOWER': 'bg-purple-50 text-purple-700 border-purple-200'
};

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none';
const labelCls = 'block text-xs font-semibold text-slate-700 mb-1';

async function sendJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch { /* respons bukan JSON */ }
  if (!json || !json.success) throw new Error(json?.error || `Permintaan gagal (HTTP ${res.status})`);
  return json;
}

export function DivisiBadge({ divisi }) {
  if (!divisi) return null;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap ${TEKNISI_DIVISI_STYLE[divisi] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {TEKNISI_DIVISI_LABEL[divisi] || divisi}
    </span>
  );
}

// ------------------------------------------------------------------
// Formulir tambah / ubah teknisi
// ------------------------------------------------------------------
export function TeknisiFormModal({ teknisi = null, defaultDivisi = 'DIVISI FO', onClose, onSaved }) {
  const edit = !!teknisi;
  const [nama, setNama] = useState(teknisi?.nama || '');
  const [divisi, setDivisi] = useState(teknisi?.divisi || defaultDivisi);
  const [noHp, setNoHp] = useState(teknisi?.no_hp || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    e.stopPropagation(); // form ini bisa tampil di atas form bon — jangan ikut mengirim form di bawahnya
    if (!nama.trim()) { setError('Nama teknisi wajib diisi'); return; }
    setSaving(true);
    setError('');
    try {
      const body = { nama: nama.trim(), divisi, no_hp: noHp.trim() };
      const json = edit
        ? await sendJson('PUT', `/api/teknisi/${teknisi.id}`, body)
        : await sendJson('POST', '/api/teknisi', body);
      notify(json.message, 'success');
      await onSaved(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="no-print fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="bg-slate-800 text-white px-4 sm:px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-2.5 min-w-0">
            <HardHat className="w-5 h-5 shrink-0" />
            <h3 className="font-bold text-sm truncate">{edit ? 'Ubah Data Teknisi' : 'Tambah Teknisi'}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="p-1.5 text-white/80 hover:text-white rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-4 sm:p-5 space-y-3">
          {error && (
            <div role="alert" className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span>{error}</span>
            </div>
          )}
          <div>
            <label className={labelCls}>Divisi *</label>
            <select value={divisi} onChange={(e) => setDivisi(e.target.value)} className={inputCls} aria-label="Divisi teknisi">
              {TEKNISI_DIVISI.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Nama Teknisi *</label>
            <input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. Budi Santoso" className={inputCls} maxLength={80} autoFocus aria-label="Nama teknisi" />
            {edit && <p className="text-[10px] text-slate-500 mt-1">Mengganti nama ikut memperbarui nama di bon dan riwayat mutasi yang sudah ada.</p>}
          </div>
          <div>
            <label className={labelCls}>No. HP (opsional)</label>
            <input value={noHp} onChange={(e) => setNoHp(e.target.value)} placeholder="08xx-xxxx-xxxx" className={inputCls} maxLength={30} aria-label="No. HP teknisi" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Batal</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1.5 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {edit ? 'Simpan Perubahan' : 'Simpan Teknisi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Tab "Data Teknisi"
// ------------------------------------------------------------------
export default function DataTeknisiPanel({ roster = [], canManage = false, onChanged = async () => {} }) {
  const [cari, setCari] = useState('');
  const [fDivisi, setFDivisi] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [form, setForm] = useState(null); // null | { teknisi?: obj }
  const [busyId, setBusyId] = useState(null);

  const rows = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return roster.filter((t) => (
      (!fDivisi || t.divisi === fDivisi) &&
      (!fStatus || t.status === fStatus) &&
      (!q || t.nama.toLowerCase().includes(q) || (t.no_hp || '').toLowerCase().includes(q))
    ));
  }, [roster, cari, fDivisi, fStatus]);

  const perDivisi = useMemo(() => TEKNISI_DIVISI.map((d) => ({
    ...d,
    aktif: roster.filter((t) => t.divisi === d.value && t.status === 'aktif').length,
    total: roster.filter((t) => t.divisi === d.value).length
  })), [roster]);

  const toggleStatus = async (t) => {
    setBusyId(t.id);
    try {
      const next = t.status === 'aktif' ? 'nonaktif' : 'aktif';
      await sendJson('PUT', `/api/teknisi/${t.id}`, { status: next });
      notify(`${t.nama} sekarang ${next}`, 'success');
      await onChanged();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const hapus = async (t) => {
    if (!window.confirm(`Hapus teknisi "${t.nama}" dari Data Teknisi?`)) return;
    setBusyId(t.id);
    try {
      const json = await sendJson('DELETE', `/api/teknisi/${t.id}`);
      notify(json.message, 'success');
      await onChanged();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {perDivisi.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() => setFDivisi(fDivisi === d.value ? '' : d.value)}
            className={`text-left p-3 rounded-xl border transition ${fDivisi === d.value ? 'ring-2 ring-indigo-400' : ''} ${TEKNISI_DIVISI_STYLE[d.value]}`}
          >
            <span className="block text-[10px] uppercase font-bold tracking-wider opacity-80">{d.label}</span>
            <span className="text-xl font-extrabold">{d.aktif}</span>
            <span className="text-[11px] ml-1.5 opacity-80">teknisi aktif{d.total > d.aktif ? ` (+${d.total - d.aktif} nonaktif)` : ''}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 border-b border-slate-100">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama / No. HP teknisi…" className={`${inputCls} pl-9`} aria-label="Cari teknisi" />
          </div>
          <select value={fDivisi} onChange={(e) => setFDivisi(e.target.value)} className={`${inputCls} sm:w-40`} aria-label="Filter divisi">
            <option value="">Semua divisi</option>
            {TEKNISI_DIVISI.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={`${inputCls} sm:w-36`} aria-label="Filter status teknisi">
            <option value="">Semua status</option>
            <option value="aktif">Aktif</option>
            <option value="nonaktif">Nonaktif</option>
          </select>
          {canManage && (
            <button type="button" onClick={() => setForm({})} className="px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center gap-1.5 whitespace-nowrap">
              <Plus className="w-4 h-4" /> Tambah Teknisi
            </button>
          )}
        </div>

        {roster.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-sm">
            <HardHat className="w-10 h-10 mx-auto text-slate-300 mb-2" />
            <p className="font-semibold text-slate-700">Belum ada data teknisi</p>
            <p className="text-xs mt-1">Tambahkan nama teknisi per divisi agar bisa langsung dipilih saat membuat bon.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Tidak ada teknisi yang cocok dengan filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Nama Teknisi</th>
                  <th className="text-left px-4 py-3">Divisi</th>
                  <th className="text-left px-4 py-3">No. HP</th>
                  <th className="text-right px-4 py-3">Bon</th>
                  <th className="text-right px-4 py-3">Bon Berjalan</th>
                  <th className="text-left px-4 py-3">Status</th>
                  {canManage && <th className="text-right px-4 py-3">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((t) => (
                  <tr key={t.id} className={t.status === 'aktif' ? '' : 'bg-slate-50/70 text-slate-500'}>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{t.nama}</td>
                    <td className="px-4 py-2.5"><DivisiBadge divisi={t.divisi} /></td>
                    <td className="px-4 py-2.5">{t.no_hp || '-'}</td>
                    <td className="px-4 py-2.5 text-right">{t.jumlah_bon}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{t.bon_berjalan}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold ${t.status === 'aktif' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>
                        {t.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" onClick={() => setForm({ teknisi: t })} title="Ubah" aria-label={`Ubah ${t.nama}`} className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"><Pencil className="w-4 h-4" /></button>
                          <button type="button" onClick={() => toggleStatus(t)} disabled={busyId === t.id} title={t.status === 'aktif' ? 'Nonaktifkan' : 'Aktifkan'} aria-label={t.status === 'aktif' ? `Nonaktifkan ${t.nama}` : `Aktifkan ${t.nama}`} className="p-1.5 rounded-lg text-slate-500 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50">
                            {t.status === 'aktif' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                          <button type="button" onClick={() => hapus(t)} disabled={busyId === t.id} title="Hapus" aria-label={`Hapus ${t.nama}`} className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Teknisi yang sudah tercatat di bon tidak bisa dihapus — ubah statusnya menjadi <b>nonaktif</b> agar tidak muncul lagi di pilihan bon baru, tanpa mengubah riwayat lama.
      </p>

      {form && (
        <TeknisiFormModal
          teknisi={form.teknisi || null}
          onClose={() => setForm(null)}
          onSaved={async () => { setForm(null); await onChanged(); }}
        />
      )}
    </div>
  );
}
