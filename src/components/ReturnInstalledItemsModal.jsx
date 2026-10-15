import React, { useState } from 'react';
import { formatNumber } from '../utils/formatters';

export default function ReturnInstalledItemsModal({ items, busy, error, onConfirm, onCancel }) {
  const [rows, setRows] = useState(() => items.map(i => ({ ...i, kondisi: '', keterangan: '' })));
  const update = (index, key, value) => setRows(old => old.map((r, n) => n === index ? { ...r, [key]: value } : r));
  return <div className="fixed inset-0 z-[60] bg-slate-900/70 p-3 flex items-center justify-center">
    <form onSubmit={e => { e.preventDefault(); onConfirm(rows.map(r => ({ kode_barang: r.kode_barang, serial_number: r.serial_number || '', jumlah: r.jumlah, kondisi: r.kondisi, keterangan: r.keterangan.trim() }))); }}
      className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-5 space-y-4" aria-label="Konfirmasi pengembalian barang pelanggan">
      <h3 className="font-bold text-slate-900">Konfirmasi Barang Dikurangi / Dihapus</h3>
      <p className="text-xs text-slate-600">Perubahan belum disimpan. Tentukan kondisi dan keterangan setiap barang yang ditarik dari pelanggan sebelum menyimpan perubahan.</p>
      {error && <p role="alert" className="bg-rose-50 text-rose-700 rounded-lg p-3 text-xs">{error}</p>}
      {rows.map((r, n) => <div key={n} className="rounded-xl border border-slate-200 p-3 space-y-2">
        <div className="text-xs font-bold">{r.nama_barang} <span className="font-mono">({r.kode_barang})</span></div>
        <p className="text-xs">Dikembalikan: <b>{formatNumber(r.jumlah)} {r.satuan}</b>{r.serial_number && <> • SN / MAC: <b>{r.serial_number}</b></>}</p>
        <label className="block text-xs font-semibold">Kondisi Pengembalian *
          <select required disabled={busy} value={r.kondisi} onChange={e => update(n, 'kondisi', e.target.value)} className="mt-1 w-full border border-slate-300 rounded-lg p-2 bg-white">
            <option value="">— Pilih kondisi barang —</option>
            <option value="Baik">Baik — kembali ke stok siap pakai</option>
            <option value="Rusak Ringan">Rusak Ringan — masuk gudang rusak</option>
            <option value="Rusak Berat">Rusak Berat — masuk gudang rusak</option>
            <option value="Afkir">Afkir — masuk gudang rusak (afkir)</option>
          </select>
        </label>
        <label className="block text-xs font-semibold">Keterangan / Alasan Pengembalian *
          <textarea required disabled={busy} maxLength={2000} rows={2} value={r.keterangan} onChange={e => update(n, 'keterangan', e.target.value)} placeholder="Contoh: perangkat diganti karena rusak / pengurangan perangkat pelanggan" className="mt-1 w-full border border-slate-300 rounded-lg p-2" />
        </label>
        <p className="text-[11px] text-slate-500">{r.kondisi === 'Baik' ? 'Stok gudang siap pakai akan bertambah sesuai jumlah ini.' : r.kondisi ? 'Barang masuk Gudang Barang Rusak / Afkir; stok siap pakai tidak bertambah.' : 'Kondisi dan keterangan wajib dipilih, tidak otomatis dianggap Baik.'}</p>
      </div>)}
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onCancel} className="px-4 py-2 text-xs font-semibold border rounded-xl">Kembali ke Edit</button><button disabled={busy} className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl disabled:opacity-50">{busy ? 'Menyimpan...' : 'Konfirmasi & Simpan Perubahan'}</button></div>
    </form>
  </div>;
}
