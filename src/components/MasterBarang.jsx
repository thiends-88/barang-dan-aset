import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Package, 
  Plus, 
  Search, 
  Filter, 
  Printer, 
  Edit3, 
  Trash2, 
  ArrowUpRight, 
  ArrowDownLeft, 
  AlertTriangle, 
  CheckCircle2, 
  Barcode as BarcodeIcon,
  DollarSign,
  TrendingUp,
  RefreshCw,
  Tag
} from 'lucide-react';
import BarcodeRenderer from './BarcodeRenderer';
import CategoryManagerModal from './CategoryManagerModal';
import { formatRupiah, formatNumber } from '../utils/formatters';

const DEFAULT_CATEGORIES = [
  'Perangkat Aktif Pelanggan',
  'Kabel Fiber Optic',
  'Aksesoris & Pasif FO',
  'Perangkat Wireless Tower',
  'Struktur & Aksesoris Tower',
  'Kabel Jaringan',
  'Perangkat Jaringan Core',
  'Perangkat Power & Kelistrikan',
  'Alat Kerja & Splicer'
];

const DEFAULT_UNITS = ['unit', 'roll', 'meter', 'bks', 'pcs', 'pack', 'set'];

export default function MasterBarang({ 
  items, 
  onRefresh, 
  onOpenBarcodeModal, 
  onOpenScanner 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [adjustingItem, setAdjustingItem] = useState(null);

  // Category state
  const [categories, setCategories] = useState(
    DEFAULT_CATEGORIES.map((c, idx) => ({ id: idx + 1, nama_kategori: c }))
  );
  const [isCustomCategoryInput, setIsCustomCategoryInput] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState('');

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      if (data.success && Array.isArray(data.data) && data.data.length > 0) {
        setCategories(data.data);
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Form State
  const [formData, setFormData] = useState({
    kode_barang: '',
    nama_barang: '',
    satuan: 'unit',
    jenis_barang: 'Perangkat Aktif Pelanggan',
    stok: 0,
    min_stok: 5,
    harga_barang: 0,
    referensi_suplayer: '',
    catatan: ''
  });

  // Adjust State
  const [adjustData, setAdjustData] = useState({
    jenis: 'MASUK',
    jumlah: 1,
    suplayer_penerima: '',
    keterangan: ''
  });

  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchSearch = 
        item.kode_barang.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.nama_barang.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.referensi_suplayer && item.referensi_suplayer.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchCategory = !selectedCategory || item.jenis_barang === selectedCategory;
      const matchLowStock = !showLowStockOnly || item.stok <= item.min_stok;

      return matchSearch && matchCategory && matchLowStock;
    });
  }, [items, searchTerm, selectedCategory, showLowStockOnly]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalSKU = items.length;
    const totalStok = items.reduce((acc, i) => acc + (Number(i.stok) || 0), 0);
    const totalNilai = items.reduce((acc, i) => acc + ((Number(i.stok) || 0) * (Number(i.harga_barang) || 0)), 0);
    const lowStockCount = items.filter(i => i.stok <= i.min_stok).length;
    return { totalSKU, totalStok, totalNilai, lowStockCount };
  }, [items]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setIsCustomCategoryInput(false);
    setCustomCategoryName('');
    const defaultCat = categories.length > 0 ? categories[0].nama_kategori : 'Perangkat Aktif Pelanggan';
    setFormData({
      kode_barang: `BRG-${Date.now().toString().slice(-6)}`,
      nama_barang: '',
      satuan: 'unit',
      jenis_barang: defaultCat,
      stok: 10,
      min_stok: 5,
      harga_barang: 100000,
      referensi_suplayer: '',
      catatan: ''
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleOpenEdit = (item) => {
    setEditingItem(item);
    setIsCustomCategoryInput(false);
    setCustomCategoryName('');
    setFormData({
      kode_barang: item.kode_barang,
      nama_barang: item.nama_barang,
      satuan: item.satuan,
      jenis_barang: item.jenis_barang,
      stok: item.stok,
      min_stok: item.min_stok,
      harga_barang: item.harga_barang,
      referensi_suplayer: item.referensi_suplayer || '',
      catatan: item.catatan || ''
    });
    setFormError('');
    setIsFormModalOpen(true);
  };

  const handleOpenAdjust = (item, type = 'MASUK') => {
    setAdjustingItem(item);
    setAdjustData({
      jenis: type,
      jumlah: 1,
      suplayer_penerima: type === 'MASUK' ? (item.referensi_suplayer || '') : 'Operasional',
      keterangan: type === 'MASUK' ? 'Restock pengadaan barang' : 'Pengeluaran kebutuhan operasional'
    });
    setIsAdjustModalOpen(true);
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!formData.kode_barang || !formData.nama_barang) {
      setFormError('Kode barang dan nama barang wajib diisi');
      return;
    }

    if (!formData.jenis_barang || !formData.jenis_barang.trim()) {
      setFormError('Jenis / Kategori barang wajib diisi');
      return;
    }

    setIsSubmitting(true);
    setFormError('');

    try {
      const payload = {
        ...formData,
        jenis_barang: formData.jenis_barang.trim()
      };

      const url = editingItem ? `/api/items/${editingItem.id}` : '/api/items';
      const method = editingItem ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyimpan barang');
      }

      setIsFormModalOpen(false);
      onRefresh();
      fetchCategories();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveAdjust = async (e) => {
    e.preventDefault();
    if (!adjustingItem) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/items/${adjustingItem.id}/stock-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adjustData)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menyesuaikan stok');
      }

      setIsAdjustModalOpen(false);
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!window.confirm(`Yakin ingin menghapus master barang "${item.nama_barang}" (${item.kode_barang})?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/items/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus barang');
      }
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Master Barang</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{formatNumber(stats.totalSKU)} <span className="text-xs font-normal text-slate-500">Item</span></div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Katalog aset terdaftar</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
            <Package className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Total Stok di Gudang</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{formatNumber(stats.totalStok)} <span className="text-xs font-normal text-slate-500">Unit/Qty</span></div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Tersedia belum terpasang</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Nilai Valuasi Gudang</span>
            <div className="text-xl font-bold text-indigo-700 mt-1">{formatRupiah(stats.totalNilai)}</div>
            <span className="text-[11px] text-slate-400 mt-0.5 block">Total aset fisik di gudang</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
            <DollarSign className="w-6 h-6" />
          </div>
        </div>

        <div className={`p-5 rounded-2xl border shadow-sm flex items-center justify-between transition ${
          stats.lowStockCount > 0 ? 'bg-amber-50/70 border-amber-200 text-amber-900' : 'bg-white border-slate-200/80 text-slate-900'
        }`}>
          <div>
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider block">Peringatan Stok Menipis</span>
            <div className="text-2xl font-bold mt-1">
              {stats.lowStockCount} <span className="text-xs font-normal text-amber-700">Item</span>
            </div>
            <button
              onClick={() => setShowLowStockOnly(!showLowStockOnly)}
              className="text-[11px] font-medium text-amber-800 underline hover:text-amber-950 mt-0.5 block text-left"
            >
              {showLowStockOnly ? 'Tampilkan Semua Barang' : 'Filter Barang Menipis'}
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-100/80 border border-amber-200 flex items-center justify-center text-amber-700">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Table Toolbar */}
        <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
            {/* Search Box */}
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Cari kode barang, nama, atau suplayer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl text-sm transition"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            </div>

            {/* Category Dropdown */}
            <div className="relative">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full sm:w-auto pl-3 pr-8 py-2 bg-slate-50 border border-slate-300 focus:bg-white focus:border-indigo-500 rounded-xl text-xs font-medium text-slate-700"
              >
                <option value="">Semua Kategori ({categories.length})</option>
                {categories.map((cat) => (
                  <option key={cat.id || cat.nama_kategori} value={cat.nama_kategori}>
                    {cat.nama_kategori}
                  </option>
                ))}
              </select>
            </div>

            {showLowStockOnly && (
              <button
                onClick={() => setShowLowStockOnly(false)}
                className="px-3 py-1.5 bg-amber-100 text-amber-800 text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:bg-amber-200 transition"
              >
                <span>Filter: Menipis</span>
                <span className="font-bold">×</span>
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setIsCategoryModalOpen(true)}
              className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold text-xs rounded-xl flex items-center gap-1.5 border border-indigo-200 transition"
              title="Kelola & Tambah Kategori / Jenis Barang"
            >
              <Tag className="w-3.5 h-3.5 text-indigo-600" />
              <span>Kelola Kategori</span>
            </button>

            <button
              onClick={onOpenScanner}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs rounded-xl flex items-center gap-2 border border-slate-300 transition"
            >
              <BarcodeIcon className="w-4 h-4 text-indigo-600" />
              <span>Scan Barcode</span>
            </button>

            <button
              onClick={handleOpenAdd}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs rounded-xl flex items-center gap-2 shadow-sm shadow-indigo-200 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah Master Barang</span>
            </button>
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">Kode & Barcode</th>
                <th className="py-3 px-4">Nama Barang</th>
                <th className="py-3 px-4">Kategori / Jenis</th>
                <th className="py-3 px-4">Satuan</th>
                <th className="py-3 px-4 text-right">Stok Gudang</th>
                <th className="py-3 px-4 text-right">Harga Satuan</th>
                <th className="py-3 px-4 text-right">Nilai Aset Stok</th>
                <th className="py-3 px-4">Referensi / Suplayer</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan="9" className="py-12 text-center text-slate-400">
                    <Package className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="font-medium text-slate-600">Tidak ada barang yang cocok</p>
                    <p className="text-[11px] text-slate-400">Coba ubah kata kunci pencarian atau kategori</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const isLow = item.stok <= item.min_stok;
                  const totalValue = item.stok * item.harga_barang;

                  return (
                    <tr key={item.id} className="hover:bg-indigo-50/30 transition">
                      {/* Code & Barcode */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onOpenBarcodeModal(item)}
                            title="Klik untuk cetak label barcode"
                            className="p-1 rounded bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 transition"
                          >
                            <BarcodeIcon className="w-4 h-4" />
                          </button>
                          <span className="font-mono font-bold text-slate-800">
                            {item.kode_barang}
                          </span>
                        </div>
                      </td>

                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 max-w-xs">{item.nama_barang}</div>
                        {item.catatan && (
                          <div className="text-[11px] text-slate-400 truncate max-w-xs">{item.catatan}</div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {item.jenis_barang}
                        </span>
                      </td>

                      {/* Unit */}
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-600">
                        {item.satuan}
                      </td>

                      {/* Stock in Warehouse */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={`inline-block px-2 py-0.5 rounded-md font-bold text-xs ${
                            isLow 
                              ? 'bg-rose-100 text-rose-700 border border-rose-200' 
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {formatNumber(item.stok)} {item.satuan}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          Min: {item.min_stok}
                        </span>
                      </td>

                      {/* Unit Price */}
                      <td className="py-3 px-4 text-right whitespace-nowrap font-medium text-slate-800">
                        {formatRupiah(item.harga_barang)}
                      </td>

                      {/* Total Inventory Value */}
                      <td className="py-3 px-4 text-right whitespace-nowrap font-bold text-indigo-700">
                        {formatRupiah(totalValue)}
                      </td>

                      {/* Supplier Reference */}
                      <td className="py-3 px-4 text-slate-600 max-w-[180px] truncate">
                        {item.referensi_suplayer || '-'}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {/* Stock In Quick */}
                          <button
                            onClick={() => handleOpenAdjust(item, 'MASUK')}
                            title="Tambah Stok Masuk"
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 transition"
                          >
                            <ArrowDownLeft className="w-4 h-4" />
                          </button>

                          {/* Stock Out Quick */}
                          <button
                            onClick={() => handleOpenAdjust(item, 'KELUAR')}
                            title="Pengeluaran Stok"
                            className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition"
                          >
                            <ArrowUpRight className="w-4 h-4" />
                          </button>

                          {/* Print Label */}
                          <button
                            onClick={() => onOpenBarcodeModal(item)}
                            title="Cetak Label Barcode"
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
                          >
                            <Printer className="w-4 h-4" />
                          </button>

                          {/* Edit Item */}
                          <button
                            onClick={() => handleOpenEdit(item)}
                            title="Edit Master"
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          {/* Delete Item */}
                          <button
                            onClick={() => handleDeleteItem(item)}
                            title="Hapus Master"
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

        {/* Table Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex items-center justify-between">
          <span>Menampilkan {filteredItems.length} dari total {items.length} master barang</span>
          <span className="font-semibold text-slate-700">Total Nilai Terfilter: {formatRupiah(filteredItems.reduce((a, b) => a + (b.stok * b.harga_barang), 0))}</span>
        </div>
      </div>

      {/* Add / Edit Master Barang Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-600/40 border border-indigo-400/30 flex items-center justify-center">
                  <Package className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h3 className="font-bold text-base">
                    {editingItem ? 'Edit Master Barang' : 'Tambah Master Barang Baru'}
                  </h3>
                  <p className="text-xs text-slate-300">
                    Sistem data barang dan aset terpadu
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsFormModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="p-6 space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Kode Barang */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Kode Barang (Barcode) *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.kode_barang}
                    onChange={(e) => setFormData({ ...formData, kode_barang: e.target.value.toUpperCase() })}
                    placeholder="Contoh: BRG-ONT-001"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono uppercase focus:bg-white focus:border-indigo-500"
                  />
                </div>

                {/* Satuan */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Satuan *
                  </label>
                  <select
                    value={formData.satuan}
                    onChange={(e) => setFormData({ ...formData, satuan: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500"
                  >
                    {DEFAULT_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Barcode Live Preview */}
              {formData.kode_barang && (
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div className="text-[11px] text-slate-500">
                    <span className="font-semibold block text-slate-700">Preview Barcode:</span>
                    <span>Akan dicetak pada label aset fisik</span>
                  </div>
                  <div className="bg-white px-2 py-1 rounded border border-slate-200">
                    <BarcodeRenderer value={formData.kode_barang} width={1.2} height={28} fontSize={10} />
                  </div>
                </div>
              )}

              {/* Nama Barang */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nama Barang *
                </label>
                <input
                  type="text"
                  required
                  value={formData.nama_barang}
                  onChange={(e) => setFormData({ ...formData, nama_barang: e.target.value })}
                  placeholder="Contoh: ONU XPON Huawei HG8546M 1GE+3FE+WiFi"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500"
                />
              </div>

              {/* Jenis Barang */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">
                    Jenis / Kategori Barang *
                  </label>
                  {!isCustomCategoryInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomCategoryInput(true);
                        setCustomCategoryName('');
                      }}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                    >
                      <span>+ Ketik Kategori Baru</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomCategoryInput(false);
                        const defaultCat = categories.length > 0 ? categories[0].nama_kategori : '';
                        setFormData({ ...formData, jenis_barang: defaultCat });
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700 underline"
                    >
                      Pilih dari daftar yang ada
                    </button>
                  )}
                </div>

                {isCustomCategoryInput ? (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      required
                      value={customCategoryName}
                      onChange={(e) => {
                        setCustomCategoryName(e.target.value);
                        setFormData({ ...formData, jenis_barang: e.target.value });
                      }}
                      placeholder="Ketik kategori manual baru (cth: Antena Grid / SFP Modul)..."
                      className="w-full px-3 py-2 bg-indigo-50/50 border-2 border-indigo-400 rounded-xl text-sm font-semibold text-slate-900 focus:bg-white focus:border-indigo-600"
                      autoFocus
                    />
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>Kategori ini akan otomatis tersimpan ke daftar master kategori.</span>
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustomCategoryInput(false);
                          const defaultCat = categories.length > 0 ? categories[0].nama_kategori : '';
                          setFormData({ ...formData, jenis_barang: defaultCat });
                        }}
                        className="text-indigo-600 hover:underline"
                      >
                        Batal
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select
                      value={formData.jenis_barang}
                      onChange={(e) => {
                        if (e.target.value === '__add_new__') {
                          setIsCustomCategoryInput(true);
                          setCustomCategoryName('');
                        } else {
                          setFormData({ ...formData, jenis_barang: e.target.value });
                        }
                      }}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500 font-medium"
                    >
                      {categories.map((cat) => (
                        <option key={cat.id || cat.nama_kategori} value={cat.nama_kategori}>
                          {cat.nama_kategori}
                        </option>
                      ))}
                      <option value="__add_new__" className="text-indigo-600 font-bold">
                        + Tambah Kategori Baru Manual...
                      </option>
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Stok Awal / Saat ini */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Stok di Gudang
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.stok}
                    onChange={(e) => setFormData({ ...formData, stok: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500 font-semibold"
                  />
                </div>

                {/* Min Stok Alert */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Batas Min. Stok
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={formData.min_stok}
                    onChange={(e) => setFormData({ ...formData, min_stok: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500"
                  />
                </div>

                {/* Harga Barang */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Harga Barang (Rp) *
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.harga_barang}
                    onChange={(e) => setFormData({ ...formData, harga_barang: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500 font-bold text-indigo-700"
                  />
                </div>
              </div>

              {/* Referensi Pembelian / Suplayer */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Referensi Pembelian Barang / Suplayer
                </label>
                <input
                  type="text"
                  value={formData.referensi_suplayer}
                  onChange={(e) => setFormData({ ...formData, referensi_suplayer: e.target.value })}
                  placeholder="Contoh: PT. Fiber Optik Solusindo / Toko Berkah"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500"
                />
              </div>

              {/* Catatan / Spesifikasi */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Catatan / Keterangan Teknis
                </label>
                <textarea
                  rows="2"
                  value={formData.catatan}
                  onChange={(e) => setFormData({ ...formData, catatan: e.target.value })}
                  placeholder="Keterangan garansi, spesifikasi teknis, dll..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:bg-white focus:border-indigo-500"
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
                  className="px-5 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : (editingItem ? 'Simpan Perubahan' : 'Tambah Master Barang')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Stock Adjust Modal */}
      {isAdjustModalOpen && adjustingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className={`px-6 py-4 text-white flex items-center justify-between ${
              adjustData.jenis === 'MASUK' ? 'bg-emerald-700' : 'bg-rose-700'
            }`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
                  {adjustData.jenis === 'MASUK' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    {adjustData.jenis === 'MASUK' ? 'Penambahan Stok Masuk' : 'Pengurangan Stok Keluar'}
                  </h3>
                  <p className="text-[11px] text-white/80">{adjustingItem.nama_barang}</p>
                </div>
              </div>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-white/80 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAdjust} className="p-6 space-y-4">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-500 block">Stok Gudang Saat Ini:</span>
                  <span className="text-base font-bold text-slate-800">
                    {adjustingItem.stok} {adjustingItem.satuan}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-slate-500 block">Harga Satuan:</span>
                  <span className="font-semibold text-slate-800">
                    {formatRupiah(adjustingItem.harga_barang)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Jenis Mutasi
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustData({ ...adjustData, jenis: 'MASUK' })}
                    className={`py-2 text-xs font-semibold rounded-xl border transition ${
                      adjustData.jenis === 'MASUK'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-800'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    + Barang Masuk
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustData({ ...adjustData, jenis: 'KELUAR' })}
                    className={`py-2 text-xs font-semibold rounded-xl border transition ${
                      adjustData.jenis === 'KELUAR'
                        ? 'bg-rose-50 border-rose-500 text-rose-800'
                        : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    - Barang Keluar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Jumlah ({adjustingItem.satuan}) *
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={adjustData.jumlah}
                  onChange={(e) => setAdjustData({ ...adjustData, jumlah: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-base font-bold text-slate-900 focus:bg-white focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {adjustData.jenis === 'MASUK' ? 'Referensi Suplayer / Sumber' : 'Penerima / Lokasi Penggunaan'}
                </label>
                <input
                  type="text"
                  required
                  value={adjustData.suplayer_penerima}
                  onChange={(e) => setAdjustData({ ...adjustData, suplayer_penerima: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Keterangan Transaksi
                </label>
                <textarea
                  rows="2"
                  value={adjustData.keterangan}
                  onChange={(e) => setAdjustData({ ...adjustData, keterangan: e.target.value })}
                  placeholder="Keterangan surat jalan / alasan mutasi..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-indigo-500"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-sm transition disabled:opacity-50 ${
                    adjustData.jenis === 'MASUK' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {isSubmitting ? 'Memproses...' : 'Simpan Mutasi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Kelola Kategori */}
      <CategoryManagerModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={categories}
        items={items}
        onRefreshCategories={fetchCategories}
        onRefreshItems={onRefresh}
      />
    </div>
  );
}
