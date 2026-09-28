import React, { useState, useMemo } from 'react';
import { 
  Network, 
  Plus, 
  Search, 
  Trash2, 
  Edit3, 
  Package, 
  Eye, 
  AlertCircle, 
  PlusCircle, 
  DollarSign, 
  MapPin, 
  UserCheck, 
  Calendar,
  Layers,
  Printer
} from 'lucide-react';
import { formatRupiah, formatNumber, formatDate } from '../utils/formatters';
import WorkOrderPrintModal from './WorkOrderPrintModal';

const TIPE_FO_OPTIONS = ['ODP', 'ODC', 'Closure', 'Tiang Distribusi', 'Sentral Hub / ODF', 'Jalur Feeder Backbone'];
const DEFAULT_UNITS = ['unit', 'roll', 'meter', 'bks', 'pcs'];

export default function DivisiFO({ foSites, items, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedSiteDetail, setSelectedSiteDetail] = useState(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState(null);
  const [printSite, setPrintSite] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    daerah_lokasi: '',
    tipe_lokasi: 'ODP',
    pic_teknisi: '',
    tanggal_pasang: new Date().toISOString().split('T')[0],
    catatan: '',
    items: []
  });

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered sites
  const filteredSites = useMemo(() => {
    return foSites.filter(site => {
      const matchSearch = 
        site.daerah_lokasi.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (site.pic_teknisi && site.pic_teknisi.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (site.catatan && site.catatan.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchType = !typeFilter || site.tipe_lokasi === typeFilter;
      return matchSearch && matchType;
    });
  }, [foSites, searchTerm, typeFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalSites = foSites.length;
    const totalAssetVal = foSites.reduce((acc, s) => acc + (Number(s.total_harga) || 0), 0);
    const odpCount = foSites.filter(s => s.tipe_lokasi === 'ODP').length;
    const odcCount = foSites.filter(s => s.tipe_lokasi === 'ODC').length;
    return { totalSites, totalAssetVal, odpCount, odcCount };
  }, [foSites]);

  // Open Add modal
  const handleOpenAdd = () => {
    setEditingSite(null);
    setFormData({
      daerah_lokasi: '',
      tipe_lokasi: 'ODP',
      pic_teknisi: '',
      tanggal_pasang: new Date().toISOString().split('T')[0],
      catatan: '',
      items: [
        {
          kode_barang: '',
          nama_barang: '',
          jenis_barang: '',
          satuan: 'unit',
          jumlah: 1,
          harga_barang: 0,
          subtotal: 0,
          referensi_suplayer: ''
        }
      ]
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  // Open Edit modal
  const handleOpenEdit = (site) => {
    setEditingSite(site);
    setFormData({
      daerah_lokasi: site.daerah_lokasi,
      tipe_lokasi: site.tipe_lokasi || 'ODP',
      pic_teknisi: site.pic_teknisi || '',
      tanggal_pasang: site.tanggal_pasang || new Date().toISOString().split('T')[0],
      catatan: site.catatan || '',
      items: (site.items && site.items.length > 0)
        ? site.items.map(it => ({
            kode_barang: it.kode_barang,
            nama_barang: it.nama_barang,
            jenis_barang: it.jenis_barang,
            satuan: it.satuan,
            jumlah: it.jumlah,
            harga_barang: it.harga_barang,
            subtotal: it.subtotal,
            referensi_suplayer: it.referensi_suplayer || ''
          }))
        : []
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  // Dynamic row: change selected item
  const handleItemCodeChange = (index, selectedCode) => {
    const updated = [...formData.items];
    const targetItem = items.find(i => i.kode_barang === selectedCode);

    if (targetItem) {
      const qty = updated[index].jumlah || 1;
      const subtotal = qty * targetItem.harga_barang;
      updated[index] = {
        ...updated[index],
        kode_barang: targetItem.kode_barang,
        nama_barang: targetItem.nama_barang,
        jenis_barang: targetItem.jenis_barang,
        satuan: targetItem.satuan,
        harga_barang: targetItem.harga_barang,
        referensi_suplayer: targetItem.referensi_suplayer || '',
        subtotal: subtotal
      };
    } else {
      updated[index] = {
        ...updated[index],
        kode_barang: selectedCode,
        nama_barang: '',
        jenis_barang: '',
        harga_barang: 0,
        subtotal: 0
      };
    }
    setFormData({ ...formData, items: updated });
  };

  // Dynamic row: change quantity
  const handleItemQtyChange = (index, qtyVal) => {
    const updated = [...formData.items];
    const qty = parseFloat(qtyVal) || 0;
    const price = updated[index].harga_barang || 0;
    updated[index].jumlah = qty;
    updated[index].subtotal = qty * price;
    setFormData({ ...formData, items: updated });
  };

  // Dynamic row: add new empty item row
  const handleAddItemRow = () => {
    setFormData({
      ...formData,
      items: [
        ...formData.items,
        {
          kode_barang: '',
          nama_barang: '',
          jenis_barang: '',
          satuan: 'unit',
          jumlah: 1,
          harga_barang: 0,
          subtotal: 0,
          referensi_suplayer: ''
        }
      ]
    });
  };

  // Dynamic row: remove item row
  const handleRemoveItemRow = (index) => {
    const updated = formData.items.filter((_, i) => i !== index);
    setFormData({ ...formData, items: updated });
  };

  // Calculate current total price of installed items
  const formTotalPrice = useMemo(() => {
    return formData.items.reduce((acc, it) => acc + (Number(it.subtotal) || 0), 0);
  }, [formData.items]);

  // Save FO Site
  const handleSaveFOSite = async (e) => {
    e.preventDefault();
    if (!formData.daerah_lokasi) {
      setFormError('Daerah / Lokasi FO wajib diisi');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const url = editingSite ? `/api/fo/${editingSite.id}` : '/api/fo';
      const method = editingSite ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan titik FO');
      }

      setIsFormModalOpen(false);
      onRefresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete FO Site
  const handleDeleteFOSite = async (site) => {
    if (!window.confirm(`Yakin ingin menghapus titik FO "${site.daerah_lokasi}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/fo/${site.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus titik FO');
      }
      if (selectedSiteDetail && selectedSiteDetail.id === site.id) {
        setSelectedSiteDetail(null);
      }
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Titik / Node FO</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{formatNumber(stats.totalSites)} <span className="text-xs font-normal text-slate-500">Lokasi</span></div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 block">{stats.odpCount} ODP • {stats.odcCount} ODC Hub</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <Network className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Aset Fisik FO</span>
            <div className="text-xl font-bold text-emerald-700 mt-1">{formatRupiah(stats.totalAssetVal)}</div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Kabel, ODP, ODC, Closure</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Cakupan Distribusi</span>
            <div className="text-lg font-bold text-slate-800 mt-1 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>Multi Sektor</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Infrastruktur jalur kabel optik</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Layers className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Tambah Titik Baru</span>
            <button
              onClick={handleOpenAdd}
              className="mt-2 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Input Titik FO Baru</span>
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600">
            <Package className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Cari daerah / lokasi FO, PIC teknisi..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 focus:bg-white focus:border-emerald-500 rounded-xl text-sm transition"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:bg-white"
            >
              <option value="">Semua Tipe Titik FO</option>
              {TIPE_FO_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  Tipe: {t}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-xl flex items-center gap-2 shadow-sm shadow-emerald-200 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Lokasi & Perangkat FO</span>
          </button>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Tipe Node</th>
                <th className="py-3 px-4">Daerah / Lokasi Titik FO</th>
                <th className="py-3 px-4">PIC / Teknisi</th>
                <th className="py-3 px-4">Tanggal Pasang</th>
                <th className="py-3 px-4">Barang Terpasang</th>
                <th className="py-3 px-4 text-right">Total Nilai Barang</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSites.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-12 text-center text-slate-400">
                    <Network className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="font-medium text-slate-600">Tidak ada data titik FO yang cocok</p>
                  </td>
                </tr>
              ) : (
                filteredSites.map((site) => {
                  const itemsCount = site.items ? site.items.length : 0;
                  return (
                    <tr key={site.id} className="hover:bg-emerald-50/20 transition">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-md text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {site.tipe_lokasi}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{site.daerah_lokasi}</div>
                        {site.catatan && (
                          <div className="text-[11px] text-slate-500 max-w-sm truncate">{site.catatan}</div>
                        )}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-slate-700 font-medium">
                        {site.pic_teknisi || '-'}
                      </td>

                      <td className="py-3 px-4 whitespace-nowrap text-slate-500">
                        {formatDate(site.tanggal_pasang)}
                      </td>

                      <td className="py-3 px-4">
                        <button
                          onClick={() => setSelectedSiteDetail(site)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:text-emerald-900"
                        >
                          <Package className="w-3.5 h-3.5" />
                          <span>{itemsCount} Barang Terpasang</span>
                        </button>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">
                          {site.items && site.items.length > 0
                            ? site.items.map(i => `${i.nama_barang} (${i.jumlah} ${i.satuan})`).join(', ')
                            : 'Belum ada barang diinput'}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-slate-900">
                        {formatRupiah(site.total_harga)}
                      </td>

                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedSiteDetail(site)}
                            title="Lihat Detail Titik FO"
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setPrintSite(site)}
                            title="Cetak Berita Acara Titik FO"
                            className="p-1.5 rounded-lg text-emerald-700 hover:bg-emerald-50 transition"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(site)}
                            title="Edit Titik FO & Barang"
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDeleteFOSite(site)}
                            title="Hapus Titik FO"
                            className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <span>Menampilkan {filteredSites.length} titik FO</span>
          <span className="font-semibold text-slate-700">
            Total Nilai Aset FO Terpasang: {formatRupiah(filteredSites.reduce((a, b) => a + (Number(b.total_harga) || 0), 0))}
          </span>
        </div>
      </div>

      {/* FO Site Detail Modal */}
      {selectedSiteDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
              <div>
                <span className="text-xs text-emerald-300 font-mono font-bold block">{selectedSiteDetail.tipe_lokasi}</span>
                <h3 className="text-base font-bold">{selectedSiteDetail.daerah_lokasi}</h3>
              </div>
              <button
                onClick={() => setSelectedSiteDetail(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Tipe Node:</span>
                  <span className="font-bold text-slate-800">{selectedSiteDetail.tipe_lokasi}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">PIC / Teknisi:</span>
                  <span className="font-bold text-slate-800">{selectedSiteDetail.pic_teknisi || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tgl Pasang:</span>
                  <span className="font-medium text-slate-700">{formatDate(selectedSiteDetail.tanggal_pasang)}</span>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-slate-500 block">Catatan Titik:</span>
                  <span className="font-medium text-slate-700">{selectedSiteDetail.catatan || '-'}</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Rincian Barang & Perangkat Terpasang di Titik FO
                  </h4>
                  <span className="text-xs font-bold text-emerald-700">
                    Total: {formatRupiah(selectedSiteDetail.total_harga)}
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
                      <tr>
                        <th className="py-2.5 px-3">Kode Barang</th>
                        <th className="py-2.5 px-3">Nama Barang</th>
                        <th className="py-2.5 px-3">Jenis</th>
                        <th className="py-2.5 px-3 text-right">Jumlah</th>
                        <th className="py-2.5 px-3 text-right">Harga</th>
                        <th className="py-2.5 px-3 text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedSiteDetail.items && selectedSiteDetail.items.length > 0 ? (
                        selectedSiteDetail.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono font-medium text-indigo-700">{it.kode_barang}</td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{it.nama_barang}</td>
                            <td className="py-2.5 px-3 text-slate-500">{it.jenis_barang}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                              {formatNumber(it.jumlah)} {it.satuan}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600">{formatRupiah(it.harga_barang)}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-emerald-700">{formatRupiah(it.subtotal)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="6" className="py-6 text-center text-slate-400">
                            Belum ada perangkat terpasang.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {selectedSiteDetail.items && selectedSiteDetail.items.length > 0 && (
                      <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                        <tr>
                          <td colSpan="5" className="py-2.5 px-3 text-right text-slate-700">Total Nilai Barang:</td>
                          <td className="py-2.5 px-3 text-right text-emerald-700">{formatRupiah(selectedSiteDetail.total_harga)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  const s = selectedSiteDetail;
                  setPrintSite(s);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Berita Acara FO</span>
              </button>
              <button
                onClick={() => {
                  const s = selectedSiteDetail;
                  setSelectedSiteDetail(null);
                  handleOpenEdit(s);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-xl transition"
              >
                Edit Data
              </button>
              <button
                onClick={() => setSelectedSiteDetail(null)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded-xl transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit FO Site with Dynamic Installed Items Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 max-h-[92vh] flex flex-col">
            <div className="bg-gradient-to-r from-emerald-900 to-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-emerald-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-600/40 border border-emerald-400/30 flex items-center justify-center">
                  <Network className="w-5 h-5 text-emerald-300" />
                </div>
                <div>
                  <h3 className="font-bold text-base">
                    {editingSite ? 'Edit Titik Divisi FO' : 'Form Input Titik Divisi FO'}
                  </h3>
                  <p className="text-xs text-emerald-200">
                    Input daerah/lokasi dan barang terpasang (otomatis nama, jenis, harga & total harga)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsFormModalOpen(false)}
                className="text-white/80 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveFOSite} className="flex-1 overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section 1: Lokasi & PIC */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  1. Data Titik Lokasi FO
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Daerah / Lokasi *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.daerah_lokasi}
                      onChange={(e) => setFormData({ ...formData, daerah_lokasi: e.target.value })}
                      placeholder="Contoh: ODP-01 Jl. Sudirman Depan Gedung Bank / Simpang KM 12"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-emerald-500 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tipe Lokasi Node *
                    </label>
                    <select
                      value={formData.tipe_lokasi}
                      onChange={(e) => setFormData({ ...formData, tipe_lokasi: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold focus:bg-white focus:border-emerald-500"
                    >
                      {TIPE_FO_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      PIC / Teknisi FO
                    </label>
                    <input
                      type="text"
                      value={formData.pic_teknisi}
                      onChange={(e) => setFormData({ ...formData, pic_teknisi: e.target.value })}
                      placeholder="Nama teknisi penanggung jawab"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tanggal Pemasangan
                    </label>
                    <input
                      type="date"
                      value={formData.tanggal_pasang}
                      onChange={(e) => setFormData({ ...formData, tanggal_pasang: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-emerald-500"
                    />
                  </div>

                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Catatan / Keterangan Titik FO
                    </label>
                    <input
                      type="text"
                      value={formData.catatan}
                      onChange={(e) => setFormData({ ...formData, catatan: e.target.value })}
                      placeholder="Cth: ODP terhubung ke Feeder ODC Hub Barat, Tiang No. T-045"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Barang Terpasang (Multi-item dynamic rows) */}
              <div className="pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 mb-3 border-b border-slate-200 gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                      2. Input Barang Terpasang di FO (Bisa Input Beberapa Barang)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Ketika pilih kode barang: nama barang, harga, jenis dan referensi otomatis muncul.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition self-start sm:self-auto"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    <span>+ Tambah Baris Barang</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {formData.items.map((row, index) => (
                    <div
                      key={index}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-200 relative group hover:border-emerald-300 transition"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Kode Barang (Master) *
                          </label>
                          <select
                            value={row.kode_barang}
                            onChange={(e) => handleItemCodeChange(index, e.target.value)}
                            className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-semibold focus:border-emerald-500"
                          >
                            <option value="">-- Pilih Kode Barang --</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.kode_barang}>
                                {it.kode_barang} - {it.nama_barang} (Stok: {it.stok} {it.satuan})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Nama Barang (Otomatis Muncul)
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={row.nama_barang ? `${row.nama_barang}` : ''}
                            placeholder="Otomatis dari kode barang..."
                            className="w-full px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 truncate"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Jumlah ({row.satuan || 'satuan'}) *
                          </label>
                          <input
                            type="number"
                            step="any"
                            min="0.01"
                            value={row.jumlah}
                            onChange={(e) => handleItemQtyChange(index, e.target.value)}
                            className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-center focus:border-emerald-500"
                          />
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Harga Barang (Otomatis)
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={formatRupiah(row.harga_barang)}
                            className="w-full px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-right text-slate-800"
                          />
                        </div>

                        <div className="sm:col-span-1 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveItemRow(index)}
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                            title="Hapus baris barang ini"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {row.kode_barang && (
                        <div className="mt-2 pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">
                            Jenis: <strong className="text-slate-700">{row.jenis_barang || '-'}</strong> | Suplayer: <strong className="text-slate-700">{row.referensi_suplayer || '-'}</strong>
                          </span>
                          <span className="font-semibold text-emerald-700">
                            Subtotal: {formatRupiah(row.subtotal)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}

                  {formData.items.length === 0 && (
                    <div className="p-6 text-center text-slate-400 border border-dashed border-slate-300 rounded-xl">
                      Belum ada barang yang diinput. Klik tombol "+ Tambah Baris Barang" di atas.
                    </div>
                  )}
                </div>

                {/* Total Harga Barang Summary Banner */}
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-emerald-900 block">
                      TOTAL HARGA BARANG (DIVISI FO):
                    </span>
                    <span className="text-[11px] text-emerald-700">
                      Menjumlahkan dari berapa barang yang diinput ({formData.items.length} item)
                    </span>
                  </div>
                  <div className="text-xl font-bold text-emerald-950 font-mono">
                    {formatRupiah(formTotalPrice)}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : (editingSite ? 'Simpan Perubahan' : 'Simpan Titik FO & Alokasi Barang')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Work Order / Berita Acara FO Print Modal */}
      <WorkOrderPrintModal
        isOpen={!!printSite}
        onClose={() => setPrintSite(null)}
        data={printSite}
        type="fo"
      />
    </div>
  );
}
