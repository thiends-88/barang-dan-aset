import React from 'react';
import { X, Printer, FileText, CheckCircle2 } from 'lucide-react';
import { formatRupiah, formatNumber, formatDate } from '../utils/formatters';
import BarcodeRenderer from './BarcodeRenderer';

export default function WorkOrderPrintModal({ isOpen, onClose, data, type }) {
  if (!isOpen || !data) return null;

  const handlePrint = () => {
    window.print();
  };

  const isCustomer = type === 'pelanggan';
  const isFO = type === 'fo';
  const isTower = type === 'tower';

  const docNumber = `BA-${isCustomer ? 'CUST' : isFO ? 'FO' : 'TWR'}-${data.id || '001'}-${new Date().getFullYear()}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden sm:my-8 pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[94vh] flex flex-col">
        {/* Header toolbar (no-print) */}
        <div className="no-print bg-slate-900 text-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/40 border border-indigo-400/30 flex items-center justify-center">
              <FileText className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="font-bold text-sm">
                {isCustomer && 'Cetak Berita Acara Instalasi Pelanggan (BASTP)'}
                {isFO && 'Cetak Berita Acara Pemasangan Titik FO'}
                {isTower && 'Cetak Berita Acara Pemasangan Site Tower'}
              </h3>
              <p className="text-xs text-slate-300">Format cetak surat tugas & serah terima perangkat</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Document Body */}
        <div className="p-8 overflow-y-auto flex-1 bg-white text-slate-900">
          {/* Official Letterhead */}
          <div className="border-b-2 border-slate-900 pb-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-black tracking-tight text-slate-900 uppercase">
                  PT. TELEKOMUNIKASI DATA NUSANTARA (ISP NETWORK)
                </h1>
                <p className="text-xs text-slate-600">
                  Divisi Operasional & Jaringan • Divisi FO • Divisi Tower • Logistik Aset
                </p>
                <p className="text-[11px] text-slate-500">
                  Jl. Telekomunikasi Utama No. 88 | Helpdesk: 0811-0000-8888 | www.isp-network.id
                </p>
              </div>
              <div className="text-right">
                <BarcodeRenderer value={docNumber} width={1.2} height={30} fontSize={9} />
                <span className="text-[10px] font-mono font-bold text-slate-600 block mt-0.5">{docNumber}</span>
              </div>
            </div>
          </div>

          {/* Document Title */}
          <div className="text-center mb-6">
            <h2 className="text-sm font-extrabold uppercase tracking-wider underline text-slate-900">
              {isCustomer && 'BERITA ACARA SERAH TERIMA PERANGKAT (BASTP)'}
              {isFO && 'BERITA ACARA PEMASANGAN & INSTALASI TITIK FIBER OPTIC'}
              {isTower && 'BERITA ACARA INSTALASI PERANGKAT SITE MENARA TOWER BTS'}
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              Nomor: <span className="font-mono font-bold">{docNumber}</span> • Tanggal: <span className="font-semibold">{formatDate(data.tanggal_pasang)}</span>
            </p>
          </div>

          {/* Entity Info Box */}
          <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-300 text-xs space-y-2">
            {isCustomer && (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                <div>
                  <span className="text-slate-500 block">ID Pelanggan:</span>
                  <span className="font-mono font-bold text-indigo-800 text-sm">{data.id_pelanggan}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Nama Pelanggan:</span>
                  <span className="font-bold text-slate-900">{data.nama_pelanggan}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Paket Layanan:</span>
                  <span className="font-semibold capitalize text-slate-800">
                    {data.paket} ({data.infrastruktur}) - {data.keterangan_paket || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status Langganan:</span>
                  <span className="font-bold uppercase text-slate-800">{data.status}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Alamat Pemasangan:</span>
                  <span className="font-medium text-slate-800">{data.alamat || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">No. Telepon / Kontak:</span>
                  <span className="font-medium text-slate-800">{data.telepon || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tanggal Pasang:</span>
                  <span className="font-medium text-slate-800">{formatDate(data.tanggal_pasang)}</span>
                </div>
              </div>
            )}

            {isFO && (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                <div className={data.tipe_lokasi ? '' : 'col-span-2'}>
                  <span className="text-slate-500 block">Titik / Daerah Lokasi:</span>
                  <span className="font-bold text-slate-900 text-sm">{data.daerah_lokasi}</span>
                </div>
                {data.tipe_lokasi && (
                  <div>
                    <span className="text-slate-500 block">Tipe Node FO:</span>
                    <span className="font-bold text-emerald-800">{data.tipe_lokasi}</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block">PIC / Teknisi Penanggung Jawab:</span>
                  <span className="font-bold text-slate-800">{data.pic_teknisi || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tanggal Selesai Pemasangan:</span>
                  <span className="font-medium text-slate-800">{formatDate(data.tanggal_pasang)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Catatan Titik:</span>
                  <span className="font-medium text-slate-800">{data.catatan || '-'}</span>
                </div>
              </div>
            )}

            {isTower && (
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                <div>
                  <span className="text-slate-500 block">Daerah / Lokasi Site Tower:</span>
                  <span className="font-bold text-slate-900 text-sm">{data.daerah_lokasi}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Struktur Menara:</span>
                  <span className="font-bold text-purple-900 uppercase">
                    {data.jenis} - {data.type} ({data.ketinggian})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Kepemilikan Menara:</span>
                  <span className="font-bold text-slate-800">{data.kepemilikan}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">PIC / Tim Teknisi Riggers:</span>
                  <span className="font-bold text-slate-800">{data.pic_teknisi || '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Catatan Site:</span>
                  <span className="font-medium text-slate-800">{data.catatan || '-'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Installed Equipment Table */}
          <div className="mb-6">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-2">
              Daftar Barang & Perangkat Terpasang:
            </h4>
            <table className="w-full text-left text-xs border border-slate-300">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-300">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-300 text-center w-8">No</th>
                  <th className="py-2 px-3 border-r border-slate-300">Kode Barang</th>
                  <th className="py-2 px-3 border-r border-slate-300">Nama Perangkat / Spesifikasi</th>
                  <th className="py-2 px-3 border-r border-slate-300">Nomor Seri / SN / MAC</th>
                  <th className="py-2 px-3 text-right border-r border-slate-300">Qty</th>
                  <th className="py-2 px-3 text-right border-r border-slate-300">Harga Satuan</th>
                  <th className="py-2 px-3 text-right">Total Nilai</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.items && data.items.length > 0 ? (
                  data.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-2.5 text-center border-r border-slate-300 text-slate-500">{idx + 1}</td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-800 border-r border-slate-300">{it.kode_barang}</td>
                      <td className="py-2 px-3 font-medium text-slate-900 border-r border-slate-300">
                        {it.nama_barang}
                        <span className="text-[10px] text-slate-500 block">Kategori: {it.jenis_barang}</span>
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700 border-r border-slate-300">
                        {it.serial_number || '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900 border-r border-slate-300">
                        {formatNumber(it.jumlah)} {it.satuan}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 border-r border-slate-300">
                        {formatRupiah(it.harga_barang)}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-slate-900">
                        {formatRupiah(it.subtotal)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className="py-4 text-center text-slate-400">
                      Tidak ada rincian barang.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-400">
                <tr>
                  <td colSpan="6" className="py-2 px-3 text-right text-slate-800 uppercase">
                    Total Nilai Aset Terpasang:
                  </td>
                  <td className="py-2 px-3 text-right text-indigo-900 text-sm">
                    {formatRupiah(data.total_harga)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Terms & Notes */}
          <div className="mb-8 text-[11px] text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <p className="font-bold text-slate-700 mb-0.5">Catatan & Ketentuan Serah Terima Aset:</p>
            <p>1. Seluruh perangkat yang tertera di atas telah diuji coba dan berfungsi dengan baik saat penyerahan.</p>
            <p>2. Perangkat berstatus aset perusahaan dan dipinjam-pakaikan selama masa berlangganan aktif.</p>
            <p>3. Apabila terjadi pemutusan layanan, seluruh perangkat wajib dikembalikan dalam kondisi baik.</p>
          </div>

          {/* Signature Block */}
          <div className="grid grid-cols-3 text-center text-xs text-slate-800 pt-4">
            <div>
              <p className="font-semibold text-slate-600">
                {isCustomer ? 'Yang Menyerahkan (Teknisi),' : 'Teknisi Pelaksana,'}
              </p>
              <div className="h-16" />
              <p className="font-bold underline text-slate-900">
                ( {isCustomer ? 'Tim Teknisi Instalasi' : (data.pic_teknisi || 'Teknisi Lapangan')} )
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-600">Mengetahui / Supervisor,</p>
              <div className="h-16" />
              <p className="font-bold underline text-slate-900">( Spv. Operasional Jaringan )</p>
            </div>
            <div>
              <p className="font-semibold text-slate-600">
                {isCustomer ? 'Penerima (Pelanggan),' : 'Pemeriksa / Pengawas,'}
              </p>
              <div className="h-16" />
              <p className="font-bold underline text-slate-900">
                ( {isCustomer ? data.nama_pelanggan : 'Manager Lapangan'} )
              </p>
            </div>
          </div>
        </div>

        {/* Footer toolbar (no-print) */}
        <div className="no-print p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-xl transition"
          >
            Tutup
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak Berita Acara (Print)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
