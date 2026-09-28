import React, { useState, useMemo } from 'react';
import { 
  Users, 
  Plus, 
  Search, 
  Filter, 
  Trash2, 
  Edit3, 
  Package, 
  Eye, 
  AlertCircle, 
  Wifi, 
  Radio, 
  CheckCircle2, 
  Clock, 
  XCircle, 
  RotateCcw,
  DollarSign,
  PlusCircle,
  ExternalLink,
  ChevronDown,
  Building,
  Printer,
  Barcode as BarcodeIcon,
  FileCheck
} from 'lucide-react';
import { formatRupiah, formatNumber, formatDate } from '../utils/formatters';
import { notify } from '../utils/notify';
import WorkOrderPrintModal from './WorkOrderPrintModal';

const PAKET_OPTIONS = [
  'personal',
  'home',
  'family',
  'middle',
  'soho',
  'small',
  'little',
  'bronze',
  'free',
  'parallel',
  'custom',
  'dedicated'
];

const KATEGORI_OPTIONS = ['bandwidth', 'rent', 'service', 'kombinasi'];
const STATUS_OPTIONS = ['aktif', 'blokir', 'cuti', 'putus'];
const DEFAULT_UNITS = ['unit', 'roll', 'meter', 'bks', 'pcs'];

export default function DivisiPelanggan({ 
  customers, 
  items, 
  onRefresh, 
  onOpenBarcodeModal 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [infraFilter, setInfraFilter] = useState('');
  const [selectedCustDetail, setSelectedCustDetail] = useState(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [printCust, setPrintCust] = useState(null);

  // Form State
  const [formData, setFormData] = useState({
    id_pelanggan: '',
    nama_pelanggan: '',
    infrastruktur: 'optic',
    paket: 'home',
    keterangan_paket: '',
    kategori: 'bandwidth',
    status: 'aktif',
    alamat: '',
    telepon: '',
    tanggal_pasang: new Date().toISOString().split('T')[0],
    catatan: '',
    items: []
  });

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchSearch = 
        c.id_pelanggan.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.nama_pelanggan.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.alamat && c.alamat.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (c.paket && c.paket.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus = !statusFilter || c.status === statusFilter;
      const matchInfra = !infraFilter || c.infrastruktur === infraFilter;

      return matchSearch && matchStatus && matchInfra;
    });
  }, [customers, searchTerm, statusFilter, infraFilter]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalCust = customers.length;
    const aktifCount = customers.filter(c => c.status === 'aktif').length;
    const opticCount = customers.filter(c => c.infrastruktur === 'optic').length;
    const wirelessCount = customers.filter(c => c.infrastruktur === 'wireless').length;
    const totalAssetVal = customers.reduce((acc, c) => acc + (Number(c.total_harga) || 0), 0);
    return { totalCust, aktifCount, opticCount, wirelessCount, totalAssetVal };
  }, [customers]);

  // Open Add modal
  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setFormData({
      id_pelanggan: `CUST-${Date.now().toString().slice(-5)}`,
      nama_pelanggan: '',
      infrastruktur: 'optic',
      paket: 'home',
      keterangan_paket: 'Internet 30 Mbps',
      kategori: 'bandwidth',
      status: 'aktif',
      alamat: '',
      telepon: '',
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
          serial_number: '',
          referensi_suplayer: ''
        }
      ]
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  // Open Edit modal
  const handleOpenEdit = (cust) => {
    setEditingCustomer(cust);
    setFormData({
      id_pelanggan: cust.id_pelanggan,
      nama_pelanggan: cust.nama_pelanggan,
      infrastruktur: cust.infrastruktur,
      paket: cust.paket,
      keterangan_paket: cust.keterangan_paket || '',
      kategori: cust.kategori,
      status: cust.status,
      alamat: cust.alamat || '',
      telepon: cust.telepon || '',
      tanggal_pasang: cust.tanggal_pasang || new Date().toISOString().split('T')[0],
      catatan: cust.catatan || '',
      items: (cust.items && cust.items.length > 0)
        ? cust.items.map(it => ({
            kode_barang: it.kode_barang,
            nama_barang: it.nama_barang,
            jenis_barang: it.jenis_barang,
            satuan: it.satuan,
            jumlah: it.jumlah,
            harga_barang: it.harga_barang,
            subtotal: it.subtotal,
            serial_number: it.serial_number || '',
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

  // Dynamic row: change Serial Number / MAC
  const handleItemSNChange = (index, snVal) => {
    const updated = [...formData.items];
    updated[index].serial_number = snVal;
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
  const handleAddItemRow = (presetItem = null) => {
    if (presetItem) {
      setFormData({
        ...formData,
        items: [
          ...formData.items,
          {
            kode_barang: presetItem.kode_barang,
            nama_barang: presetItem.nama_barang,
            jenis_barang: presetItem.jenis_barang,
            satuan: presetItem.satuan,
            jumlah: 1,
            harga_barang: presetItem.harga_barang,
            subtotal: presetItem.harga_barang,
            serial_number: '',
            referensi_suplayer: presetItem.referensi_suplayer || ''
          }
        ]
      });
    } else {
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
            serial_number: '',
            referensi_suplayer: ''
          }
        ]
      });
    }
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

  // Save customer
  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (!formData.id_pelanggan || !formData.nama_pelanggan) {
      setFormError('ID Pelanggan dan Nama Pelanggan wajib diisi');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const url = editingCustomer ? `/api/customers/${editingCustomer.id}` : '/api/customers';
      const method = editingCustomer ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan pelanggan');
      }

      setIsFormModalOpen(false);
      notify(editingCustomer ? 'Data pelanggan berhasil diperbarui' : 'Pelanggan baru berhasil disimpan', 'success');
      onRefresh();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dismantle customer items
  const handleDismantle = async (cust) => {
    if (!window.confirm(`Yakin ingin melakukan dismantle perangkat pada pelanggan "${cust.nama_pelanggan}"? Semua barang terpasang akan dikembalikan ke stok gudang dan status pelanggan akan diubah ke "Putus".`)) {
      return;
    }

    try {
      const res = await fetch(`/api/customers/${cust.id}/dismantle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keterangan: `Dismantle penarikan aset dari ${cust.nama_pelanggan}` })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal melakukan dismantle');
      }

      notify(data.message, 'success');
      if (selectedCustDetail && selectedCustDetail.id === cust.id) {
        setSelectedCustDetail(null);
      }
      onRefresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  // Delete customer
  const handleDeleteCustomer = async (cust) => {
    if (!window.confirm(`Hapus data pelanggan "${cust.nama_pelanggan}" (${cust.id_pelanggan})? Barang yang masih terpasang akan otomatis dikembalikan ke stok gudang.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/customers/${cust.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus pelanggan');
      }
      if (selectedCustDetail && selectedCustDetail.id === cust.id) {
        setSelectedCustDetail(null);
      }
      notify(data.message || 'Pelanggan berhasil dihapus', 'success');
      onRefresh();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Pelanggan</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{formatNumber(stats.totalCust)} <span className="text-xs font-normal text-slate-500">Klien</span></div>
            <span className="text-[11px] text-emerald-600 font-semibold mt-0.5 block">{stats.aktifCount} Aktif Berlangganan</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Infrastruktur</span>
            <div className="text-lg font-bold text-slate-900 mt-1 flex items-center gap-3">
              <span className="text-emerald-700 font-bold">{stats.opticCount} Optic</span>
              <span className="text-slate-300">|</span>
              <span className="text-purple-700 font-bold">{stats.wirelessCount} Wireless</span>
            </div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Distribusi media transmisi</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Wifi className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Aset di Pelanggan</span>
            <div className="text-xl font-bold text-indigo-700 mt-1">{formatRupiah(stats.totalAssetVal)}</div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Valuasi perangkat CPE terpasang</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Pemasangan Cepat</span>
            <button
              onClick={handleOpenAdd}
              className="mt-2 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Input Pelanggan Baru</span>
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
                placeholder="Cari ID, nama pelanggan, paket, atau alamat..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 focus:bg-white focus:border-indigo-500 rounded-xl text-sm transition"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:bg-white"
            >
              <option value="">Semua Status</option>
              {STATUS_OPTIONS.map((st) => (
                <option key={st} value={st}>
                  Status: {st.toUpperCase()}
                </option>
              ))}
            </select>

            {/* Infra Filter */}
            <select
              value={infraFilter}
              onChange={(e) => setInfraFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:bg-white"
            >
              <option value="">Semua Infra</option>
              <option value="optic">Optic</option>
              <option value="wireless">Wireless</option>
            </select>
          </div>

          <button
            onClick={handleOpenAdd}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-xl flex items-center gap-2 shadow-sm shadow-blue-200 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Tambah Pelanggan & Barang</span>
          </button>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">ID Pelanggan</th>
                <th className="py-3 px-4">Nama Pelanggan</th>
                <th className="py-3 px-4">Infra & Paket</th>
                <th className="py-3 px-4">Kategori</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Barang Terpasang</th>
                <th className="py-3 px-4 text-right">Total Nilai Barang</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan="8" className="py-12 text-center text-slate-400">
                    <Users className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="font-medium text-slate-600">Tidak ada data pelanggan yang cocok</p>
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => {
                  const itemsCount = cust.items ? cust.items.length : 0;
                  return (
                    <tr key={cust.id} className="hover:bg-blue-50/20 transition">
                      {/* ID */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono font-bold text-indigo-700">
                        {cust.id_pelanggan}
                      </td>

                      {/* Nama & Alamat */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{cust.nama_pelanggan}</div>
                        <div className="text-[11px] text-slate-500 max-w-xs truncate">{cust.alamat || '-'}</div>
                      </td>

                      {/* Infra & Paket */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            cust.infrastruktur === 'optic'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}>
                            {cust.infrastruktur}
                          </span>
                          <span className="font-bold text-slate-800 capitalize">{cust.paket}</span>
                        </div>
                        {cust.keterangan_paket && (
                          <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                            {cust.keterangan_paket}
                          </div>
                        )}
                      </td>

                      {/* Kategori */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="text-slate-600 capitalize">{cust.kategori}</span>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          cust.status === 'aktif' ? 'bg-emerald-100 text-emerald-800' :
                          cust.status === 'blokir' ? 'bg-rose-100 text-rose-800' :
                          cust.status === 'cuti' ? 'bg-amber-100 text-amber-800' :
                          'bg-slate-200 text-slate-700'
                        }`}>
                          {cust.status}
                        </span>
                      </td>

                      {/* Barang Terpasang List Snippet */}
                      <td className="py-3 px-4">
                        <button
                          onClick={() => setSelectedCustDetail(cust)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          <Package className="w-3.5 h-3.5" />
                          <span>{itemsCount} Perangkat Terpasang</span>
                        </button>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs mt-0.5">
                          {cust.items && cust.items.length > 0
                            ? cust.items.map(i => `${i.nama_barang} (${i.jumlah} ${i.satuan})`).join(', ')
                            : 'Belum ada barang diinput'}
                        </div>
                      </td>

                      {/* Total Harga */}
                      <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-slate-900">
                        {formatRupiah(cust.total_harga)}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setSelectedCustDetail(cust)}
                            title="Lihat Detail & Barang Terpasang"
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setPrintCust(cust)}
                            title="Cetak Berita Acara Instalasi (BASTP)"
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(cust)}
                            title="Edit Pelanggan & Barang"
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {itemsCount > 0 && cust.status !== 'putus' && (
                            <button
                              onClick={() => handleDismantle(cust)}
                              title="Bongkar / Dismantle Barang (Tarik ke Gudang)"
                              className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 hover:text-amber-700 transition"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteCustomer(cust)}
                            title="Hapus Data Pelanggan"
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
          <span>Menampilkan {filteredCustomers.length} pelanggan</span>
          <span className="font-semibold text-slate-700">
            Total Nilai Aset Terpasang: {formatRupiah(filteredCustomers.reduce((a, b) => a + (Number(b.total_harga) || 0), 0))}
          </span>
        </div>
      </div>

      {/* Customer Detail Drawer / Modal */}
      {selectedCustDetail && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden sm:my-8 pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[90vh] flex flex-col">
            <div className="bg-slate-900 text-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between">
              <div>
                <span className="text-xs text-indigo-300 font-mono font-bold block">{selectedCustDetail.id_pelanggan}</span>
                <h3 className="text-base font-bold">{selectedCustDetail.nama_pelanggan}</h3>
              </div>
              <button
                onClick={() => setSelectedCustDetail(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
              {/* Profile Details */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200 text-xs">
                <div>
                  <span className="text-slate-500 block">Infrastruktur:</span>
                  <span className="font-bold uppercase text-slate-800">{selectedCustDetail.infrastruktur}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Paket:</span>
                  <span className="font-bold capitalize text-slate-800">{selectedCustDetail.paket}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Kategori:</span>
                  <span className="font-bold capitalize text-slate-800">{selectedCustDetail.kategori}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Status:</span>
                  <span className="font-bold uppercase text-slate-800">{selectedCustDetail.status}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500 block">Alamat Pemasangan:</span>
                  <span className="font-medium text-slate-700">{selectedCustDetail.alamat || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">No. Telepon / HP:</span>
                  <span className="font-medium text-slate-700">{selectedCustDetail.telepon || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tgl Pasang:</span>
                  <span className="font-medium text-slate-700">{formatDate(selectedCustDetail.tanggal_pasang)}</span>
                </div>
              </div>

              {/* Installed Items Table */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Rincian Barang & Perangkat Terpasang
                  </h4>
                  <span className="text-xs font-bold text-indigo-700">
                    Total: {formatRupiah(selectedCustDetail.total_harga)}
                  </span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full min-w-[640px] text-left text-xs">
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
                      {selectedCustDetail.items && selectedCustDetail.items.length > 0 ? (
                        selectedCustDetail.items.map((it, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 font-mono font-medium text-indigo-700">{it.kode_barang}</td>
                            <td className="py-2.5 px-3 font-medium text-slate-900">{it.nama_barang}</td>
                            <td className="py-2.5 px-3 text-slate-500">{it.jenis_barang}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-800">
                              {formatNumber(it.jumlah)} {it.satuan}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600">{formatRupiah(it.harga_barang)}</td>
                            <td className="py-2.5 px-3 text-right font-bold text-indigo-700">{formatRupiah(it.subtotal)}</td>
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
                    {selectedCustDetail.items && selectedCustDetail.items.length > 0 && (
                      <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                        <tr>
                          <td colSpan="5" className="py-2.5 px-3 text-right text-slate-700">Total Harga Barang:</td>
                          <td className="py-2.5 px-3 text-right text-indigo-700">{formatRupiah(selectedCustDetail.total_harga)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              {selectedCustDetail.status !== 'putus' && selectedCustDetail.items?.length > 0 && (
                <button
                  onClick={() => handleDismantle(selectedCustDetail)}
                  className="px-4 py-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Bongkar / Dismantle Semua Perangkat</span>
                </button>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => {
                    const cust = selectedCustDetail;
                    setPrintCust(cust);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Cetak BASTP</span>
                </button>
                <button
                  onClick={() => {
                    const cust = selectedCustDetail;
                    setSelectedCustDetail(null);
                    handleOpenEdit(cust);
                  }}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-xl transition"
                >
                  Edit Data
                </button>
                <button
                  onClick={() => setSelectedCustDetail(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-medium rounded-xl transition"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Customer with Dynamic Installed Items Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden sm:my-8 pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[92vh] flex flex-col">
            <div className="bg-gradient-to-r from-blue-900 to-indigo-950 text-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between border-b border-indigo-900">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-200" />
                </div>
                <div>
                  <h3 className="font-bold text-base">
                    {editingCustomer ? 'Edit Pelanggan & Barang Terpasang' : 'Form Input Pelanggan Baru'}
                  </h3>
                  <p className="text-xs text-blue-200">
                    Otomatisasi pengisian spesifikasi barang & kalkulasi total nilai aset terpasang
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

            <form onSubmit={handleSaveCustomer} className="flex-1 overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Section 1: Data Identitas Pelanggan */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                  1. Informasi Pelanggan & Layanan
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      ID Pelanggan *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.id_pelanggan}
                      onChange={(e) => setFormData({ ...formData, id_pelanggan: e.target.value.toUpperCase() })}
                      placeholder="CUST-OPT-001"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold uppercase focus:bg-white focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nama Pelanggan *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.nama_pelanggan}
                      onChange={(e) => setFormData({ ...formData, nama_pelanggan: e.target.value })}
                      placeholder="Nama lengkap perorangan / perusahaan"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500 font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Infrastruktur *
                    </label>
                    <select
                      value={formData.infrastruktur}
                      onChange={(e) => setFormData({ ...formData, infrastruktur: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500"
                    >
                      <option value="optic">Optic (Fiber Optic)</option>
                      <option value="wireless">Wireless (Radio / Wireless)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Paket *
                    </label>
                    <select
                      value={formData.paket}
                      onChange={(e) => setFormData({ ...formData, paket: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs capitalize focus:bg-white focus:border-blue-500"
                    >
                      {PAKET_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Keterangan Paket
                    </label>
                    <input
                      type="text"
                      value={formData.keterangan_paket}
                      onChange={(e) => setFormData({ ...formData, keterangan_paket: e.target.value })}
                      placeholder="Cth: 50 Mbps Unlimited / Dedicated 1:1"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Kategori *
                    </label>
                    <select
                      value={formData.kategori}
                      onChange={(e) => setFormData({ ...formData, kategori: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs capitalize focus:bg-white focus:border-blue-500"
                    >
                      {KATEGORI_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Status Pelanggan *
                    </label>
                    <select
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs uppercase font-bold focus:bg-white focus:border-blue-500"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Tanggal Pemasangan
                    </label>
                    <input
                      type="date"
                      value={formData.tanggal_pasang}
                      onChange={(e) => setFormData({ ...formData, tanggal_pasang: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Alamat Pemasangan
                    </label>
                    <input
                      type="text"
                      value={formData.alamat}
                      onChange={(e) => setFormData({ ...formData, alamat: e.target.value })}
                      placeholder="Alamat lengkap lokasi pemasangan"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      No. Telepon / Kontak
                    </label>
                    <input
                      type="text"
                      value={formData.telepon}
                      onChange={(e) => setFormData({ ...formData, telepon: e.target.value })}
                      placeholder="0812xxxxxxx"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Barang Terpasang (Multi-item dynamic rows with auto-fill) */}
              <div className="pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2 mb-3 border-b border-slate-200 gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                      2. Input Barang Terpasang (Bisa Input Beberapa Barang)
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Pilih atau ketik kode barang: jenis barang, harga, dan referensi akan langsung muncul otomatis.
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

                {/* Dynamic Item Rows */}
                <div className="space-y-3">
                  {formData.items.map((row, index) => (
                    <div
                      key={index}
                      className="p-3 bg-slate-50 rounded-xl border border-slate-200 relative group hover:border-blue-300 transition"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                        {/* Kode Barang Dropdown / Auto-complete */}
                        <div className="sm:col-span-4">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Kode Barang (Master) *
                          </label>
                          <select
                            value={row.kode_barang}
                            onChange={(e) => handleItemCodeChange(index, e.target.value)}
                            className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-mono font-semibold focus:border-blue-500"
                          >
                            <option value="">-- Pilih Kode Barang --</option>
                            {items.map((it) => (
                              <option key={it.id} value={it.kode_barang}>
                                {it.kode_barang} - {it.nama_barang} (Stok: {it.stok} {it.satuan})
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Nama & Jenis Barang (Otomatis Muncul) */}
                        <div className="sm:col-span-3">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Nama & Jenis (Otomatis)
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={row.nama_barang ? `${row.nama_barang} (${row.jenis_barang})` : ''}
                            placeholder="Otomatis dari kode barang..."
                            className="w-full px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 truncate"
                          />
                        </div>

                        {/* Jumlah & Satuan */}
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
                            className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-center focus:border-blue-500"
                          />
                        </div>

                        {/* Harga Barang Satuan (Otomatis Muncul) */}
                        <div className="sm:col-span-2">
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Harga Satuan (Rp)
                          </label>
                          <input
                            type="text"
                            readOnly
                            value={formatRupiah(row.harga_barang)}
                            className="w-full px-2.5 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-right text-slate-800"
                          />
                        </div>

                        {/* Subtotal & Delete Row */}
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

                      {/* Sub-row details: Serial Number, Subtotal & Supplier */}
                      <div className="mt-2.5 pt-2 border-t border-slate-200/80 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center text-xs">
                        <div className="sm:col-span-6 flex items-center gap-2">
                          <label className="text-[11px] font-semibold text-slate-500 shrink-0">
                            No. Seri / SN / MAC:
                          </label>
                          <input
                            type="text"
                            value={row.serial_number || ''}
                            onChange={(e) => handleItemSNChange(index, e.target.value)}
                            placeholder="Scan SN atau ketik MAC..."
                            className="flex-1 px-2 py-1 bg-white border border-slate-300 rounded text-xs font-mono uppercase focus:border-blue-500"
                          />
                        </div>

                        <div className="sm:col-span-6 flex items-center justify-between sm:justify-end gap-3 text-[11px]">
                          <span className="text-slate-500">
                            Suplayer: <strong className="text-slate-700">{row.referensi_suplayer || '-'}</strong>
                          </span>
                          <span className="font-bold text-indigo-700 text-xs">
                            Subtotal: {formatRupiah(row.subtotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {formData.items.length === 0 && (
                    <div className="p-6 text-center text-slate-400 border border-dashed border-slate-300 rounded-xl">
                      Belum ada barang yang ditambahkan. Klik tombol "+ Tambah Baris Barang" di atas.
                    </div>
                  )}
                </div>

                {/* Total Harga Barang Summary Banner */}
                <div className="mt-4 p-4 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-indigo-900 block">
                      TOTAL HARGA BARANG TERPASANG:
                    </span>
                    <span className="text-[11px] text-indigo-700">
                      Otomatis menjumlahkan semua subtotal ({formData.items.length} item barang)
                    </span>
                  </div>
                  <div className="text-xl font-bold text-indigo-950 font-mono">
                    {formatRupiah(formTotalPrice)}
                  </div>
                </div>
              </div>

              {/* Catatan Tambahan */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan Teknisi / Pemasangan
                </label>
                <textarea
                  rows="2"
                  value={formData.catatan}
                  onChange={(e) => setFormData({ ...formData, catatan: e.target.value })}
                  placeholder="Catatan port ODF/ODP, redaman optik, atau arah antena..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-blue-500"
                />
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
                  className="px-6 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : (editingCustomer ? 'Simpan Perubahan' : 'Simpan Pelanggan & Alokasi Barang')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Work Order / BASTP Print Modal */}
      <WorkOrderPrintModal
        isOpen={!!printCust}
        onClose={() => setPrintCust(null)}
        data={printCust}
        type="pelanggan"
      />
    </div>
  );
}
