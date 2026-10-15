import React, { useEffect, useState } from 'react';
import { formatDate, formatNumber, todayLocal, exportToCSV } from '../utils/formatters';
import { notify } from '../utils/notify';

const field = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-xs bg-white';
const button = 'px-3 py-2 rounded-lg text-xs font-bold border border-indigo-200 text-indigo-700 bg-indigo-50 disabled:opacity-50';
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || 'Gagal memuat data servis');
  return json;
}

export function ServiceDocument({ shipment }) {
  if (!shipment) return null;
  return <div className="bg-white p-6 text-slate-900">
    <h1 className="font-black text-lg border-b-2 border-slate-800 pb-3">PT. CINOXMEDIA NETWORK INDONESIA</h1>
    <h2 className="font-bold text-center my-4">SURAT PENGIRIMAN BARANG UNTUK SERVIS</h2>
    <p className="text-xs">No: <b>{shipment.no_surat}</b> • Tanggal: {formatDate(shipment.tanggal)}</p>
    <div className="text-xs my-4 space-y-1">
      <p>Tempat servis: <b>{shipment.tujuan}</b></p><p>Alamat: {shipment.alamat || '-'}</p>
      <p>Kontak: {shipment.kontak || '-'}</p><p>Dibuat oleh: {shipment.dibuat_oleh}</p><p>Catatan: {shipment.catatan || '-'}</p>
    </div>
    <table className="w-full border-collapse text-xs">
      <thead><tr>{['No', 'Kode / Nama Barang', 'Kondisi', 'Jumlah', 'Hasil / Tanggal Kembali'].map(h => <th key={h} className="border border-slate-400 p-2 text-left">{h}</th>)}</tr></thead>
      <tbody>{shipment.items.map((i, n) => <tr key={i.id} style={{ breakInside: 'avoid' }}>
        <td className="border border-slate-300 p-2">{n + 1}</td><td className="border border-slate-300 p-2">{i.kode_barang}<br />{i.nama_barang}</td>
        <td className="border border-slate-300 p-2">{i.kondisi}</td><td className="border border-slate-300 p-2">{formatNumber(i.jumlah)} {i.satuan}</td>
        <td className="border border-slate-300 p-2">{i.hasil}{i.tanggal_kembali && <><br />{formatDate(i.tanggal_kembali)}<br />{i.catatan_hasil}</>}{i.kode_baru && <><br />Kode baru: <b>{i.kode_baru}</b><br />{i.nama_baru}</>}</td>
      </tr>)}</tbody>
    </table>
    <p className="text-xs mt-5">Note: Pengiriman dan hasil servis hanya menjadi histori, tidak menambah stok kode lama. Barang hasil servis diinput terpisah ke Master Barang dengan kode dan harga baru serta referensi surat servis ini.</p>
  </div>;
}

// Input terpisah dan disengaja: kode/harga baru tidak diisi otomatis dari kode/harga asal.
export function ServiceNewItemForm({ item, busy, error, onSave, onCancel }) {
  const [form, setForm] = useState({ kode_barang: '', nama_barang: item.nama_barang,
    jenis_barang: item.jenis_asal || '', satuan: item.satuan, harga_barang: '', min_stok: 5,
    tanggal: item.tanggal_kembali > todayLocal() ? item.tanggal_kembali : todayLocal(), catatan: '' });
  const inputs = [
    ['kode_barang', 'Kode Barang Baru *', 'text', 60], ['nama_barang', 'Nama Barang *', 'text', 200],
    ['jenis_barang', 'Kategori / Jenis *', 'text', 100], ['satuan', 'Satuan *', 'text', 30],
    ['harga_barang', 'Harga Baru per Satuan (Rp) *', 'number'], ['min_stok', 'Batas Minimum Stok *', 'number'],
    ['tanggal', 'Tanggal Input *', 'date'],
  ];
  return <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl space-y-3">
    <h4 className="font-bold text-sm">Input Barang Hasil Servis — Kode & Harga Baru</h4>
    <p className="text-xs">Kode asal: <b>{item.kode_barang}</b>. Jumlah yang masuk: <b>{formatNumber(item.jumlah)} {item.satuan}</b> (seluruh jumlah baris hasil servis). Nama boleh sama; kode harus baru dan belum digunakan.</p>
    {error && <p role="alert" className="text-rose-700 text-xs">{error}</p>}
    <div className="grid sm:grid-cols-2 gap-3">{inputs.map(([key, label, type, maxLength]) => <label key={key} className="text-xs font-semibold">{label}<input required className={field} type={type} maxLength={maxLength} min={type === 'number' ? 0 : type === 'date' ? item.tanggal_kembali : undefined} step={type === 'number' ? 'any' : undefined} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}</div>
    <label className="block text-xs">Catatan Tambahan<textarea className={field} maxLength={2000} value={form.catatan} onChange={e => setForm({ ...form, catatan: e.target.value })} /></label>
    <p className="text-xs text-emerald-800">Tindakan ini membuat Master Barang baru dan mutasi MASUK “Hasil Servis / Rekondisi”. Kode asal tidak berubah. Referensi surat dan kode asal tersimpan otomatis.</p>
    <div className="flex gap-2"><button disabled={busy} className={button}>{busy ? 'Menyimpan...' : 'Simpan sebagai Barang Baru'}</button><button type="button" disabled={busy} className={button} onClick={onCancel}>Batal</button></div>
  </form>;
}

export default function ServiceShipments({ canEdit, onChanged }) {
  const [history, setHistory] = useState([]);
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState({});
  const [form, setForm] = useState({ tujuan: '', alamat: '', kontak: '', catatan: '', tanggal: todayLocal() });
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receive, setReceive] = useState(null);
  const [newItem, setNewItem] = useState(null);
  const [result, setResult] = useState({ hasil: 'BERHASIL', tanggal: todayLocal(), catatan: '' });
  const loadHistory = async () => {
    try { setHistory((await api('/api/service-shipments')).data); }
    catch (e) { notify(e.message, 'error'); }
  };
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setCandidates([]);
    api(`/api/damaged-items?status=DITAMPUNG&limit=100&page=${page}&search=${encodeURIComponent(search)}`)
      .then(j => { if (active) { setCandidates(j.data.filter(i => i.jumlah > 0)); setPages(j.pagination.total_pages || 1); } })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open, page, search]);
  const showDetail = async id => {
    try { setDetail((await api(`/api/service-shipments/${id}`)).data); }
    catch (e) { notify(e.message, 'error'); }
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const j = await api('/api/service-shipments', { ...form, items: Object.values(selected).map(i => ({ damaged_id: i.id, jumlah: Number(i.qty) })) });
      setOpen(false); setSelected({}); setDetail(j.data); loadHistory(); onChanged();
      notify('Pengiriman servis tersimpan', 'success');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const receiveItem = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const j = await api(`/api/service-shipments/${detail.id}/items/${receive.id}/receive`, result);
      setDetail(j.data); setReceive(null); loadHistory(); onChanged();
      notify('Hasil servis tersimpan sebagai histori; stok tidak berubah', 'success');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const saveNewItem = async form => {
    setBusy(true); setError('');
    try {
      const j = await api(`/api/service-shipments/${detail.id}/items/${newItem.id}/new-item`, form);
      setDetail(j.data.shipment); setNewItem(null); loadHistory(); onChanged();
      notify('Barang hasil servis tersimpan dengan kode dan harga baru', 'success');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const exportDetail = () => exportToCSV(`Servis_${detail.no_surat}.csv`, detail.items.map(i => ({
    'No Surat': detail.no_surat, Tanggal: detail.tanggal, Tujuan: detail.tujuan, Alamat: detail.alamat,
    Kontak: detail.kontak, Catatan: detail.catatan, 'Dibuat Oleh': detail.dibuat_oleh,
    Kode: i.kode_barang, Barang: i.nama_barang, Kondisi: i.kondisi, Jumlah: i.jumlah, Satuan: i.satuan,
    Hasil: i.hasil, 'Tanggal Kembali': i.tanggal_kembali || '', 'Catatan Hasil': i.catatan_hasil, 'Kode Baru': i.kode_baru || '', 'Nama Baru': i.nama_baru || '',
    'Tanggal Input Barang Baru': i.tanggal_input_baru || '', 'Diinput Oleh': i.diinput_oleh || '', 'No Mutasi': i.no_transaksi || '',
  })));
  return <>
    <section className="no-print bg-white border border-indigo-200 rounded-2xl p-4 space-y-3 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-sm text-indigo-900">Pengiriman Servis & Histori</h3><p className="text-xs text-slate-500">Pilih beberapa barang rusak, tujuan servis, lalu cetak surat pengiriman.</p><p className="text-xs font-bold text-indigo-700 mt-1">Masih dalam servis: {formatNumber(history.reduce((sum, h) => sum + Number(h.qty_diservis || 0), 0))} qty</p></div>
        <div className="flex gap-2"><button className={button} onClick={loadHistory}>Muat ulang histori</button>{canEdit && <button className={button} onClick={() => { setOpen(true); setError(''); setSelected({}); setPage(1); setSearch(''); setForm({ tujuan: '', alamat: '', kontak: '', catatan: '', tanggal: todayLocal() }); }}>+ Kirim untuk Servis</button>}</div>
      </div>
      <div className="max-h-72 overflow-auto"><table className="w-full text-xs text-left"><thead><tr className="bg-slate-50">{['No Surat / Tanggal', 'Tujuan', 'Barang', 'Status', ''].map((h, i) => <th key={i} className="p-2">{h}</th>)}</tr></thead>
        <tbody>{history.map(h => <tr key={h.id} className="border-t"><td className="p-2 font-mono">{h.no_surat}<br />{formatDate(h.tanggal)}</td><td className="p-2">{h.tujuan}</td><td className="p-2">{h.jumlah_baris} jenis / {formatNumber(h.total_qty)} qty</td><td className="p-2">{h.qty_diservis > 0 ? 'DISERVIS' : 'SELESAI'}</td><td className="p-2"><button className={button} onClick={() => showDetail(h.id)}>Detail / Cetak</button></td></tr>)}
          {!history.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">Belum ada histori pengiriman servis.</td></tr>}</tbody></table></div>
    </section>
    {open && <div className="no-print fixed inset-0 z-50 bg-slate-900/60 p-3 flex items-center justify-center"><form onSubmit={save} className="bg-white rounded-2xl p-5 max-w-3xl w-full max-h-[92vh] overflow-y-auto space-y-3">
      <h3 className="font-bold">Kirim Barang Rusak untuk Servis</h3><p className="text-xs text-slate-500">Hanya barang DITAMPUNG yang dapat dipilih. Stok siap pakai tidak dikurangi lagi.</p>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="grid sm:grid-cols-2 gap-3">{[['tujuan', 'Tempat Servis *'], ['alamat', 'Alamat Tujuan'], ['kontak', 'Kontak / Telepon'], ['tanggal', 'Tanggal Kirim *']].map(([key, label]) => <label key={key} className="text-xs font-semibold">{label}<input className={field} type={key === 'tanggal' ? 'date' : 'text'} required={['tujuan', 'tanggal'].includes(key)} maxLength={2000} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}</div>
      <label className="block text-xs">Catatan<textarea className={field} maxLength={2000} value={form.catatan} onChange={e => setForm({ ...form, catatan: e.target.value })} /></label>
      <input aria-label="Cari barang servis" className={field} placeholder="Cari barang rusak..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <div className="max-h-48 overflow-auto border rounded-lg">{candidates.map(i => <label key={i.id} className="flex gap-3 items-center p-2 text-xs border-b"><input type="checkbox" checked={!!selected[i.id]} onChange={e => setSelected(old => { const next = { ...old }; if (e.target.checked) next[i.id] = { ...i, qty: i.jumlah }; else delete next[i.id]; return next; })} /><span>{i.kode_barang} — {i.nama_barang} • {i.kondisi} • tersedia {formatNumber(i.jumlah)} {i.satuan}</span></label>)}{!candidates.length && <p className="p-3 text-xs">Tidak ada barang tersedia pada halaman ini.</p>}</div>
      <div className="flex gap-3 items-center text-xs"><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>{page} / {pages}<button type="button" className={button} disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</button></div>
      <h4 className="font-bold text-xs">Dipilih: {Object.keys(selected).length} barang — atur jumlah kirim</h4>
      {Object.values(selected).map(i => <div key={i.id} className="flex gap-2 items-center text-xs"><span className="flex-1">{i.nama_barang} ({i.kode_barang})</span><input aria-label={`Jumlah kirim ${i.kode_barang}`} type="number" required min="0.001" step="0.001" max={i.jumlah} value={i.qty} className={`${field} max-w-28`} onChange={e => setSelected({ ...selected, [i.id]: { ...i, qty: e.target.value } })} /><button type="button" className="text-rose-700" onClick={() => setSelected(old => { const next = { ...old }; delete next[i.id]; return next; })}>Hapus</button></div>)}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} className={button} onClick={() => setOpen(false)}>Batal</button><button disabled={busy || !Object.keys(selected).length} className={button}>{busy ? 'Menyimpan...' : 'Simpan Pengiriman'}</button></div>
    </form></div>}
    {detail && <>
      <div className="print-doc"><ServiceDocument shipment={detail} /></div>
      <div className="no-print fixed inset-0 z-50 bg-slate-900/60 p-3 flex items-center justify-center"><div className="bg-white rounded-2xl max-w-4xl w-full max-h-[94vh] overflow-y-auto p-4 space-y-3">
        <div className="flex flex-wrap justify-end gap-2"><button className={button} onClick={exportDetail}>Export CSV</button><button className={button} onClick={() => window.print()}>Cetak / Simpan PDF</button><button className={button} onClick={() => { setDetail(null); setReceive(null); setNewItem(null); }}>Tutup</button></div>
        <ServiceDocument shipment={detail} />
        {canEdit && <div className="border-t pt-3 space-y-2"><h4 className="font-bold text-sm">Catat Hasil Servis — Histori Saja (per baris)</h4>{detail.items.filter(i => i.hasil === 'DISERVIS').map(i => <div key={i.id} className="text-xs flex justify-between gap-2"><span>{i.nama_barang} — {formatNumber(i.jumlah)} {i.satuan}</span><button className={button} onClick={() => { setReceive(i); setNewItem(null); setError(''); setResult({ hasil: 'BERHASIL', tanggal: todayLocal(), catatan: '' }); }}>Catat Hasil</button></div>)}</div>}
        <div className="border-t pt-3 space-y-2 text-xs">
          <h4 className="font-bold text-sm">Barang Hasil Servis — Input Terpisah</h4>
          <p className="text-slate-600">Hasil servis tidak otomatis masuk stok. Gunakan kode baru dan harga baru saat siap didaftarkan ke Master Barang.</p>
          {detail.items.filter(i => i.hasil === 'BERHASIL').map(i => <div key={i.id} className="flex flex-wrap justify-between items-center gap-2 border rounded-lg p-2">
            <span>{i.nama_barang} • Asal: {i.kode_barang} • {formatNumber(i.jumlah)} {i.satuan}</span>
            {i.kode_baru ? <span className="font-bold text-emerald-700">Sudah diinput: {i.kode_baru} • {i.tanggal_input_baru && formatDate(i.tanggal_input_baru)}</span>
              : i.no_transaksi ? <span className="text-amber-800">Histori versi lama: stok pernah masuk otomatis ({i.no_transaksi}). Tidak diinput ulang.</span>
              : <><span className="text-amber-700">Belum diinput ke Master Barang</span>{canEdit && <button className={button} onClick={() => { setNewItem(i); setReceive(null); setError(''); }}>Input sebagai Barang Baru</button>}</>}
          </div>)}
        </div>
        {newItem && <ServiceNewItemForm key={newItem.id} item={newItem} busy={busy} error={error} onSave={saveNewItem} onCancel={() => setNewItem(null)} />}
        {receive && <form onSubmit={receiveItem} className="bg-indigo-50 p-3 rounded-xl space-y-2"><h4 className="font-bold text-xs">Hasil: {receive.nama_barang}</h4><p className="text-xs">Menyimpan hasil tidak menambah stok kode lama. Jika berhasil, input barang baru dilakukan terpisah setelah ini.</p>{error && <p role="alert" className="text-rose-700 text-xs">{error}</p>}<select className={field} value={result.hasil} onChange={e => setResult({ ...result, hasil: e.target.value })}><option value="BERHASIL">Berhasil — histori saja, belum menambah stok</option><option value="GAGAL">Gagal — histori saja, tidak menambah stok</option></select><input aria-label="Tanggal kembali" className={field} type="date" required min={detail.tanggal} value={result.tanggal} onChange={e => setResult({ ...result, tanggal: e.target.value })} /><textarea aria-label="Catatan hasil servis" className={field} placeholder="Catatan hasil servis" value={result.catatan} onChange={e => setResult({ ...result, catatan: e.target.value })} /><button disabled={busy} className={button}>Konfirmasi Penerimaan</button><button type="button" disabled={busy} className={button} onClick={() => setReceive(null)}>Batal</button></form>}
      </div></div>
    </>}
  </>;
}
