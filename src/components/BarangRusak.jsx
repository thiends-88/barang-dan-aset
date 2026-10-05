import React, { useState, useEffect, useCallback } from 'react';
import { PackageX, Wrench, Trash2, Search, Filter, Plus, Download, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatRupiah, formatNumber, formatDate, exportToCSV, todayLocal } from '../utils/formatters';
import { notify } from '../utils/notify';

const STATUS_OPTS = ['SEMUA', 'DITAMPUNG', 'DIPERBAIKI', 'DIMUSNAHKAN'];
const KONDISI_OPTS = ['SEMUA', 'Rusak Ringan', 'Rusak Berat', 'Afkir'];

export default function BarangRusak({ items }) {
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('SEMUA');
  const [kondisi, setKondisi] = useState('SEMUA');

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ kode_barang: '', jumlah: 1, kondisi: 'Rusak Ringan', keterangan: '', sumber: 'MANUAL', sumber_nama: '' });
  const [submitting, setSubmitting] = useState(false);
  const [actionRow, setActionRow] = useState(null);
  const [actionType, setActionType] = useState(null); // 'repair' | 'destroy' | 'edit'
  const [actionForm, setActionForm] = useState({ jumlah: '', keterangan: '', tanggal: todayLocal() });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (status && status !== 'SEMUA') params.append('status', status);
      if (kondisi && kondisi !== 'SEMUA') params.append('kondisi', kondisi);
      params.append('limit', '100');
      const res = await fetch(`/api/damaged-items?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data || []);
        setPagination(json.pagination || null);
        setSummary(json.summary || []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [search, status, kondisi]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addForm.kode_barang) return notify('Pilih barang terlebih dahulu', 'error');
    setSubmitting(true);
    try {
      const res = await fetch('/api/damaged-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(addForm) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Gagal menambah barang rusak');
      notify(json.message || 'Barang rusak berhasil ditampung', 'success');
      setIsAddOpen(false);
      setAddForm({ kode_barang: '', jumlah: 1, kondisi: 'Rusak Ringan', keterangan: '', sumber: 'MANUAL', sumber_nama: '' });
      fetchData();
    } catch (err) { notify(err.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const openAction = (row, type) => {
    setActionRow(row);
    setActionType(type);
    setActionForm({ jumlah: String(row.jumlah), keterangan: '', tanggal: todayLocal() });
  };

  const handleAction = async (e) => {
    e.preventDefault();
    if (!actionRow) return;
    setSubmitting(true);
    try {
      let url = '';
      let payload = { ...actionForm, jumlah: Number(actionForm.jumlah) };
      if (actionType === 'repair') url = `/api/damaged-items/${actionRow.id}/repair`;
      else if (actionType === 'destroy') url = `/api/damaged-items/${actionRow.id}/destroy`;
      else if (actionType === 'edit') {
        const res = await fetch(`/api/damaged-items/${actionRow.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jumlah: payload.jumlah, kondisi: actionRow.kondisi, keterangan: payload.keterangan }) });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Gagal memperbarui');
        notify('Catatan barang rusak diperbarui', 'success');
        setActionRow(null); setActionType(null); fetchData(); return;
      }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Gagal');
      notify(json.message, 'success');
      setActionRow(null); setActionType(null); fetchData();
    } catch (err) { notify(err.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleExport = () => {
    if (!data.length) return notify('Tidak ada data untuk diekspor', 'error');
    const rows = data.map((d, i) => ({
      No: i + 1, Kode: d.kode_barang, Nama: d.nama_barang, Jenis: d.jenis_barang, Jumlah: d.jumlah, Satuan: d.satuan, Harga: d.harga_barang, Nilai: d.jumlah * d.harga_barang, Kondisi: d.kondisi, Status: d.status, Sumber: d.sumber, SumberNama: d.sumber_nama, NoTransaksi: d.no_transaksi, Tanggal: d.tanggal, Keterangan: d.keterangan
    }));
    exportToCSV(`Gudang_Rusak_${Date.now()}.csv`, rows);
  };

  const totalNilaiTampung = data.filter(d => d.status === 'DITAMPUNG').reduce((a, d) => a + d.jumlah * d.harga_barang, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2"><PackageX className="w-5 h-5 text-rose-600" /> Gudang Barang Rusak / Afkir</h2>
          <p className="text-xs text-slate-500">Ledger terpisah — barang tidak masuk stok siap pakai. Alur: DITAMPUNG → DIPERBAIKI (kembali ke stok) atau DIMUSNAHKAN.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={handleExport} className="px-3 py-2 bg-slate-100 border border-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5"><Download className="w-4 h-4" />Export CSV</button>
          <button onClick={() => setIsAddOpen(true)} className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"><Plus className="w-4 h-4" />Tampung Barang Rusak</button>
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {summary.length ? summary.map(s => (
          <div key={s.status} className={`p-4 rounded-xl border shadow-sm ${s.status === 'DITAMPUNG' ? 'bg-amber-50 border-amber-200' : s.status === 'DIPERBAIKI' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{s.status}</div>
            <div className="text-xl font-black text-slate-900 mt-1">{formatNumber(s.total_qty)} unit</div>
            <div className="text-xs text-slate-600">{s.jumlah_entri} entri • {formatRupiah(s.total_nilai)}</div>
          </div>
        )) : (
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 col-span-2 lg:col-span-4 text-xs text-slate-500 text-center">Belum ada data — gunakan tombol Tampung atau barang rusak otomatis masuk saat pengembalian dengan kondisi rusak.</div>
        )}
      </div>

      {/* Filter */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari kode, nama, kondisi, sumber, no transaksi..." className="w-full pl-10 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <select value={status} onChange={e => setStatus(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl">
            {STATUS_OPTS.map(o => <option key={o} value={o}>{o === 'SEMUA' ? 'Semua Status' : o}</option>)}
          </select>
          <select value={kondisi} onChange={e => setKondisi(e.target.value)} className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl">
            {KONDISI_OPTS.map(o => <option key={o} value={o}>{o === 'SEMUA' ? 'Semua Kondisi' : o}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b font-semibold uppercase">
              <tr>
                <th className="py-3 px-3">Tanggal</th>
                <th className="py-3 px-3">Barang</th>
                <th className="py-3 px-3 text-right">Jumlah</th>
                <th className="py-3 px-3">Kondisi</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Sumber</th>
                <th className="py-3 px-3">Nilai</th>
                <th className="py-3 px-3">Keterangan</th>
                <th className="py-3 px-3 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan="9" className="py-10 text-center text-slate-400">Memuat...</td></tr> : data.length === 0 ? <tr><td colSpan="9" className="py-10 text-center text-slate-400">Tidak ada data sesuai filter.</td></tr> : data.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 whitespace-nowrap">{formatDate(r.tanggal)}<div className="text-[10px] text-slate-400">{r.waktu || ''}</div><div className="text-[10px] font-mono text-indigo-600">{r.no_transaksi || ''}</div></td>
                  <td className="py-2.5 px-3"><div className="font-bold text-slate-900 truncate max-w-[180px]">{r.nama_barang}</div><div className="text-[10px] font-mono text-indigo-700">{r.kode_barang}</div><div className="text-[10px] text-slate-400">{r.jenis_barang}</div></td>
                  <td className="py-2.5 px-3 text-right font-bold whitespace-nowrap">{formatNumber(r.jumlah)} {r.satuan}<div className="text-[10px] text-slate-500">{formatRupiah(r.harga_barang)}/unit</div></td>
                  <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.kondisi === 'Afkir' ? 'bg-slate-800 text-white' : r.kondisi === 'Rusak Berat' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{r.kondisi}</span></td>
                  <td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${r.status === 'DITAMPUNG' ? 'bg-amber-100 text-amber-800 border border-amber-200' : r.status === 'DIPERBAIKI' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-800 text-white'}`}>{r.status}</span></td>
                  <td className="py-2.5 px-3"><div className="font-semibold text-slate-800 truncate max-w-[150px]">{r.sumber}</div><div className="text-[10px] text-slate-500 truncate max-w-[150px]">{r.sumber_nama || '-'}</div></td>
                  <td className="py-2.5 px-3 text-right font-bold text-indigo-700 whitespace-nowrap">{formatRupiah(r.jumlah * r.harga_barang)}</td>
                  <td className="py-2.5 px-3 max-w-[200px] truncate text-slate-500">{r.keterangan || '-'}</td>
                  <td className="py-2.5 px-3 text-center">
                    {r.status === 'DITAMPUNG' ? (
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openAction(r, 'repair')} className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1"><Wrench className="w-3 h-3" />Perbaiki</button>
                        <button onClick={() => openAction(r, 'destroy')} className="px-2 py-1 bg-slate-800 hover:bg-black text-white rounded-lg text-[11px] font-bold flex items-center gap-1"><Trash2 className="w-3 h-3" />Musnahkan</button>
                      </div>
                    ) : <span className="text-[10px] text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination && <div className="p-3 bg-slate-50 border-t text-xs text-slate-600 flex justify-between"><span>Menampilkan {data.length} dari {pagination.total} entri</span><span>Nilai tertampung (ditampilkan): {formatRupiah(totalNilaiTampung)}</span></div>}
      </div>

      {/* Add Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 bg-rose-700 text-white flex justify-between items-center"><h3 className="font-bold text-sm">Tampung Barang Rusak</h3><button onClick={() => setIsAddOpen(false)}>✕</button></div>
            <form onSubmit={handleAdd} className="p-5 space-y-3">
              <div><label className="block text-xs font-semibold mb-1">Barang *</label>
                <select value={addForm.kode_barang} onChange={e => setAddForm({ ...addForm, kode_barang: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" required>
                  <option value="">-- Pilih barang --</option>
                  {(items || []).map(it => <option key={it.id} value={it.kode_barang}>{it.kode_barang} — {it.nama_barang} (Stok: {it.stok})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-semibold mb-1">Jumlah *</label><input type="number" min="0.01" step="any" value={addForm.jumlah} onChange={e => setAddForm({ ...addForm, jumlah: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" required /></div>
                <div><label className="block text-xs font-semibold mb-1">Kondisi *</label><select value={addForm.kondisi} onChange={e => setAddForm({ ...addForm, kondisi: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"><option>Rusak Ringan</option><option>Rusak Berat</option><option>Afkir</option></select></div>
              </div>
              <div><label className="block text-xs font-semibold mb-1">Sumber</label><input value={addForm.sumber} onChange={e => setAddForm({ ...addForm, sumber: e.target.value })} placeholder="MANUAL / Dismantle / Bon" className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" /></div>
              <div><label className="block text-xs font-semibold mb-1">Keterangan</label><textarea rows="2" value={addForm.keterangan} onChange={e => setAddForm({ ...addForm, keterangan: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" /></div>
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setIsAddOpen(false)} className="px-4 py-2 text-xs">Batal</button><button type="submit" disabled={submitting} className="px-5 py-2 bg-rose-600 text-white rounded-xl text-xs font-bold disabled:opacity-50">{submitting ? 'Menyimpan...' : 'Simpan'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {actionRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className={`px-5 py-4 text-white flex justify-between items-center ${actionType === 'repair' ? 'bg-emerald-700' : actionType === 'destroy' ? 'bg-slate-900' : 'bg-indigo-700'}`}>
              <h3 className="font-bold text-sm">{actionType === 'repair' ? 'Perbaiki — Kembali ke Stok' : actionType === 'destroy' ? 'Pemusnahan Barang Afkir' : 'Ubah Catatan'}</h3>
              <button onClick={() => { setActionRow(null); setActionType(null); }}>✕</button>
            </div>
            <div className="p-4 bg-amber-50 border-b text-xs text-amber-900">{actionRow.kode_barang} — {actionRow.nama_barang} • {formatNumber(actionRow.jumlah)} {actionRow.satuan} • Kondisi: {actionRow.kondisi}</div>
            <form onSubmit={handleAction} className="p-5 space-y-3">
              <div><label className="block text-xs font-semibold mb-1">Jumlah {actionType === 'destroy' ? 'dimusnahkan' : 'diperbaiki'} *</label><input type="number" min="0.01" max={actionRow.jumlah} step="any" value={actionForm.jumlah} onChange={e => setActionForm({ ...actionForm, jumlah: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" required /></div>
              <div><label className="block text-xs font-semibold mb-1">Tanggal</label><input type="date" value={actionForm.tanggal} onChange={e => setActionForm({ ...actionForm, tanggal: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" /></div>
              <div><label className="block text-xs font-semibold mb-1">{actionType === 'destroy' ? 'Berita Acara / Keterangan *' : 'Keterangan'}</label><textarea rows="2" value={actionForm.keterangan} onChange={e => setActionForm({ ...actionForm, keterangan: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs" required={actionType === 'destroy'} placeholder={actionType === 'destroy' ? 'Wajib isi: alasan / BA pemusnahan' : ''} /></div>
              {actionType === 'repair' && <p className="text-[11px] text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">Barang akan ditambahkan kembali ke stok siap pakai (stok gudang bertambah). Mutasi MASUK kategori “Perbaikan Barang Rusak” akan tercatat.</p>}
              {actionType === 'destroy' && <p className="text-[11px] text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200">Barang tidak kembali ke stok. Mutasi KELUAR kategori “Pemusnahan Barang Afkir” akan tercatat.</p>}
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => { setActionRow(null); setActionType(null); }} className="px-4 py-2 text-xs">Batal</button><button type="submit" disabled={submitting} className={`px-5 py-2 text-white rounded-xl text-xs font-bold ${actionType === 'repair' ? 'bg-emerald-600' : actionType === 'destroy' ? 'bg-slate-900' : 'bg-indigo-600'}`}>{submitting ? 'Memproses...' : actionType === 'repair' ? 'Perbaiki & Kembalikan ke Stok' : actionType === 'destroy' ? 'Catat Pemusnahan' : 'Simpan'}</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
