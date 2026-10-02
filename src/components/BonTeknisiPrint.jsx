// Cetak Surat Jalan / Bon Barang Teknisi.
// Dokumen (<BonDocument/>) dirender DUA kali oleh halaman Bon Teknisi:
//   1. di dalam modal pratinjau (layar), dan
//   2. di blok `.print-doc` (tersembunyi di layar, tampil saat cetak) — modal `fixed` tidak bisa
//      dipecah ke beberapa halaman oleh browser, sedangkan blok biasa bisa.
import React from 'react';
import { X, Printer, FileText } from 'lucide-react';
import { formatRupiah, formatNumber, formatDate, formatDateTime } from '../utils/formatters';
import BarcodeRenderer from './BarcodeRenderer';

export const STATUS_LABEL = { AKTIF: 'Dibawa Teknisi', SEBAGIAN: 'Sebagian Terealisasi', SELESAI: 'Selesai', BATAL: 'Dibatalkan' };
export const DIVISI_LABEL = { PELANGGAN: 'Pelanggan', 'DIVISI FO': 'Divisi FO', 'DIVISI TOWER': 'Divisi Tower' };

function Sign({ title, name }) {
  return (
    <div className="text-center text-xs" style={{ breakInside: 'avoid' }}>
      <div className="font-semibold text-slate-800">{title}</div>
      <div className="h-16" />
      <div className="border-t border-slate-700 pt-1 mx-3 font-bold text-slate-900 min-h-[1.25rem]">{name || ' '}</div>
      <div className="text-[10px] text-slate-500">Nama jelas & tanda tangan</div>
    </div>
  );
}

/**
 * variant:
 *  - 'surat_jalan' : barang yang dibawa saja (diserahkan saat teknisi berangkat dari gudang)
 *  - 'rekap'       : lengkap dengan realisasi pemasangan, pengembalian, dan sisa
 */
export function BonDocument({ loan, variant = 'surat_jalan' }) {
  if (!loan) return null;
  const rekap = variant === 'rekap';
  const items = loan.items || [];
  const movements = loan.movements || [];
  const pasang = movements.filter((m) => m.jenis === 'PASANG');
  const kembali = movements.filter((m) => m.jenis === 'KEMBALI' || m.jenis === 'BATAL');
  const s = loan.summary || {};

  const th = 'border border-slate-400 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-800';
  const td = 'border border-slate-300 px-2 py-1.5 text-[11px] text-slate-900 align-top';

  return (
    <div className="bg-white text-slate-900 p-6 sm:p-8">
      {/* Kop surat */}
      <div className="border-b-2 border-slate-900 pb-3 mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-black tracking-tight uppercase">PT. CINOXMEDIA NETWORK INDONESIA</h1>
          <p className="text-xs text-slate-600">Divisi Operasional & Jaringan • Divisi FO • Divisi Tower • Logistik Aset</p>
          <p className="text-[11px] text-slate-500">JL. Adityawarman No. 366, Kampung Jawa, Kota Solok</p>
        </div>
        <div className="text-right shrink-0">
          <BarcodeRenderer value={loan.no_bon} width={1.2} height={30} fontSize={9} />
        </div>
      </div>

      <div className="text-center mb-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wider underline">
          {rekap ? 'Rekap Bon Barang Bawaan Teknisi' : 'Surat Jalan / Bon Barang Bawaan Teknisi'}
        </h2>
        <p className="text-xs text-slate-600 mt-1">
          No. Bon: <span className="font-mono font-bold">{loan.no_bon}</span> • Tanggal: <span className="font-semibold">{formatDate(loan.tanggal)}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg p-3 mb-4">
        <div><span className="text-slate-500 block text-[10px] uppercase">Teknisi yang Membawa</span><span className="font-bold">{loan.teknisi_nama}</span></div>
        <div><span className="text-slate-500 block text-[10px] uppercase">Status Bon</span><span className="font-bold">{STATUS_LABEL[loan.status] || loan.status}</span></div>
        <div><span className="text-slate-500 block text-[10px] uppercase">Keperluan / Tujuan Pekerjaan</span><span className="font-medium">{loan.keperluan || '-'}</span></div>
        <div><span className="text-slate-500 block text-[10px] uppercase">Dicatat Oleh (Gudang)</span><span className="font-medium">{loan.dibuat_oleh || '-'}</span></div>
        {loan.catatan ? <div className="col-span-2"><span className="text-slate-500 block text-[10px] uppercase">Catatan</span><span className="font-medium">{loan.catatan}</span></div> : null}
      </div>

      {/* Daftar barang */}
      <h3 className="text-xs font-bold uppercase tracking-wider mb-1.5">{rekap ? 'A. Daftar Barang Bon' : 'Daftar Barang yang Dibawa'}</h3>
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr>
            <th className={th} style={{ width: 28 }}>No</th>
            <th className={`${th} text-left`}>Kode</th>
            <th className={`${th} text-left`}>Nama Barang</th>
            <th className={th}>Satuan</th>
            <th className={`${th} text-right`}>Dibawa</th>
            {rekap && <th className={`${th} text-right`}>Terpasang</th>}
            {rekap && <th className={`${th} text-right`}>Kembali</th>}
            {rekap && <th className={`${th} text-right`}>Sisa</th>}
            <th className={`${th} text-right`}>Harga</th>
            <th className={`${th} text-right`}>Nilai Dibawa</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr key={li.id}>
              <td className={`${td} text-center`}>{i + 1}</td>
              <td className={`${td} font-mono`}>{li.kode_barang}</td>
              <td className={td}>{li.nama_barang}</td>
              <td className={`${td} text-center`}>{li.satuan}</td>
              <td className={`${td} text-right font-bold`}>{formatNumber(li.jumlah_dibawa)}</td>
              {rekap && <td className={`${td} text-right`}>{formatNumber(li.jumlah_terpasang)}</td>}
              {rekap && <td className={`${td} text-right`}>{formatNumber(li.jumlah_kembali)}</td>}
              {rekap && <td className={`${td} text-right font-bold`}>{formatNumber(li.jumlah_sisa)}</td>}
              <td className={`${td} text-right`}>{formatRupiah(li.harga_barang)}</td>
              <td className={`${td} text-right`}>{formatRupiah(li.jumlah_dibawa * li.harga_barang)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={rekap ? 9 : 6} className={`${td} text-right font-bold`}>Total Nilai Barang Dibawa</td>
            <td className={`${td} text-right font-bold`}>{formatRupiah(s.nilai_dibawa)}</td>
          </tr>
          {rekap && (
            <tr>
              <td colSpan={9} className={`${td} text-right font-bold`}>Nilai Masih Dibawa Teknisi (Sisa)</td>
              <td className={`${td} text-right font-bold`}>{formatRupiah(s.nilai_sisa)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      {rekap && (
        <>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-1.5">B. Realisasi Pemasangan</h3>
          {pasang.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic mb-4">Belum ada realisasi pemasangan dari bon ini.</p>
          ) : (
            <table className="w-full border-collapse mb-4">
              <thead>
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={`${th} text-left`}>Barang</th>
                  <th className={`${th} text-right`}>Jml</th>
                  <th className={`${th} text-left`}>Serial Number</th>
                  <th className={`${th} text-left`}>Divisi / Tujuan</th>
                  <th className={`${th} text-left`}>Lokasi Tujuan</th>
                  <th className={`${th} text-left`}>Teknisi Pemasang</th>
                </tr>
              </thead>
              <tbody>
                {pasang.map((m) => (
                  <tr key={m.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(m.tanggal)}</td>
                    <td className={td}>{m.nama_barang}<span className="block font-mono text-[9px] text-slate-500">{m.kode_barang}</span></td>
                    <td className={`${td} text-right`}>{formatNumber(m.jumlah)} {m.satuan}</td>
                    <td className={`${td} font-mono`}>{m.serial_number || '-'}</td>
                    <td className={td}><span className="font-semibold">{DIVISI_LABEL[m.divisi] || m.divisi}</span><span className="block">{m.tujuan_nama}</span></td>
                    <td className={td}>{m.lokasi_tujuan || '-'}</td>
                    <td className={td}>{m.teknisi_nama}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="text-xs font-bold uppercase tracking-wider mb-1.5">C. Pengembalian ke Gudang</h3>
          {kembali.length === 0 ? (
            <p className="text-[11px] text-slate-500 italic mb-4">Belum ada pengembalian sisa barang ke gudang.</p>
          ) : (
            <table className="w-full border-collapse mb-4">
              <thead>
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={`${th} text-left`}>Barang</th>
                  <th className={`${th} text-right`}>Jml</th>
                  <th className={`${th} text-left`}>Dikembalikan Oleh</th>
                  <th className={`${th} text-left`}>No. Mutasi Gudang</th>
                  <th className={`${th} text-left`}>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {kembali.map((m) => (
                  <tr key={m.id}>
                    <td className={`${td} whitespace-nowrap`}>{formatDate(m.tanggal)}</td>
                    <td className={td}>{m.nama_barang}<span className="block font-mono text-[9px] text-slate-500">{m.kode_barang}</span></td>
                    <td className={`${td} text-right`}>{formatNumber(m.jumlah)} {m.satuan}</td>
                    <td className={td}>{m.teknisi_nama}</td>
                    <td className={`${td} font-mono`}>{m.no_transaksi || '-'}</td>
                    <td className={td}>{m.jenis === 'BATAL' ? `Bon dibatalkan — ${m.keterangan}` : m.keterangan}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {!rekap && (
        <p className="text-[11px] text-slate-600 mb-4">
          Barang di atas telah dikeluarkan dari stok gudang dan menjadi tanggung jawab teknisi yang membawa sampai dipasang (dilaporkan
          lewat realisasi pemasangan) atau dikembalikan ke gudang bila tidak terpakai.
        </p>
      )}

      <div className="grid grid-cols-3 gap-4 mt-6">
        <Sign title="Dibuat oleh (Gudang)" name={loan.dibuat_oleh} />
        <Sign title={rekap ? 'Teknisi' : 'Dibawa oleh (Teknisi)'} name={loan.teknisi_nama} />
        <Sign title="Mengetahui" name="" />
      </div>
      <p className="text-[10px] text-slate-400 mt-5 text-right">Dicetak dari SIM-ASET ISP • Bon dicatat {formatDateTime(loan.tanggal, loan.waktu)}</p>
    </div>
  );
}

/** Modal pratinjau + tombol cetak. Dokumen cetak sebenarnya dirender halaman induk di `.print-doc`. */
export default function BonTeknisiPrintModal({ loan, variant, onChangeVariant, onClose }) {
  if (!loan) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-4xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden sm:my-6 max-h-[94vh] flex flex-col pb-[env(safe-area-inset-bottom)] sm:pb-0">
        <div className="bg-slate-900 text-white px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/40 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm truncate">Cetak Bon Teknisi — {loan.no_bon}</h3>
              <p className="text-xs text-slate-300">Pratinjau surat jalan / rekap bon</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Jenis dokumen:</span>
          {[
            ['surat_jalan', 'Surat Jalan (barang dibawa)'],
            ['rekap', 'Rekap Lengkap (pasang & kembali)']
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChangeVariant(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${variant === key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto flex-1 bg-slate-100 p-2 sm:p-4">
          <div className="bg-white shadow border border-slate-200 mx-auto max-w-3xl overflow-x-auto">
            <div className="min-w-[640px]">
              <BonDocument loan={loan} variant={variant} />
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition">Tutup</button>
          <button type="button" onClick={() => window.print()} className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1.5 transition">
            <Printer className="w-4 h-4" /> Cetak / Simpan PDF
          </button>
        </div>
      </div>
    </div>
  );
}
