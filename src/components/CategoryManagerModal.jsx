import React, { useState } from 'react';
import { X, Tag, Plus, Edit2, Trash2, Check, AlertCircle, Package } from 'lucide-react';
import { notify } from '../utils/notify';

export default function CategoryManagerModal({
  isOpen,
  onClose,
  categories,
  items,
  onRefreshCategories,
  onRefreshItems
}) {
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [editingDesc, setEditingDesc] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  // Calculate items count per category
  const getItemCount = (catName) => {
    return items.filter(
      (it) => it.jenis_barang && it.jenis_barang.toLowerCase() === catName.toLowerCase()
    ).length;
  };

  const handleAddCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama_kategori: newCatName.trim(),
          deskripsi: newCatDesc.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menambahkan kategori');
      }

      setNewCatName('');
      setNewCatDesc('');
      onRefreshCategories();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (cat) => {
    setEditingId(cat.id);
    setEditingName(cat.nama_kategori);
    setEditingDesc(cat.deskripsi || '');
    setErrorMsg('');
  };

  const handleSaveEdit = async (catId) => {
    if (!editingName.trim()) return;

    setIsSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch(`/api/categories/${catId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nama_kategori: editingName.trim(),
          deskripsi: editingDesc.trim()
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal mengubah kategori');
      }

      setEditingId(null);
      onRefreshCategories();
      if (onRefreshItems) onRefreshItems();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (cat) => {
    const count = getItemCount(cat.nama_kategori);
    if (count > 0) {
      notify(`Kategori "${cat.nama_kategori}" masih digunakan oleh ${count} barang. Pindahkan atau ubah kategori barang terlebih dahulu sebelum menghapus.`, 'error');
      return;
    }

    if (!window.confirm(`Hapus kategori "${cat.nama_kategori}"?`)) return;

    try {
      const res = await fetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Gagal menghapus kategori');
      }
      onRefreshCategories();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200 overflow-hidden sm:my-8 pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600/40 border border-indigo-400/30 flex items-center justify-center">
              <Tag className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h3 className="font-bold text-base">Kelola Kategori / Jenis Barang</h3>
              <p className="text-xs text-slate-300">
                Tambahkan atau sesuaikan kategori barang sesuai kebutuhan perusahaan
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form Add New Category */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2 flex items-center gap-1.5">
              <Plus className="w-4 h-4 text-indigo-600" />
              <span>Tambah Kategori Baru Secara Manual</span>
            </h4>
            <form onSubmit={handleAddCategory} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Nama Kategori / Jenis Barang *
                  </label>
                  <input
                    type="text"
                    required
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                    placeholder="Contoh: Perangkat Server DC / Solar Panel"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:border-indigo-500 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Deskripsi / Catatan (Opsional)
                  </label>
                  <input
                    type="text"
                    value={newCatDesc}
                    onChange={(e) => setNewCatDesc(e.target.value)}
                    placeholder="Cth: Baterai, Inverter, dan Panel Surya"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs focus:border-indigo-500"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSubmitting || !newCatName.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambahkan Kategori</span>
                </button>
              </div>
            </form>
          </div>

          {/* Categories List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Daftar Kategori Terdaftar ({categories.length})
              </h4>
              <span className="text-[11px] text-slate-500">
                Kategori ini langsung muncul di semua form dan filter
              </span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
              {categories.map((cat) => {
                const count = getItemCount(cat.nama_kategori);
                const isEditing = editingId === cat.id;

                return (
                  <div
                    key={cat.id}
                    className="p-3.5 bg-white hover:bg-slate-50 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    {isEditing ? (
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="px-2.5 py-1.5 bg-white border border-indigo-400 rounded-lg text-xs font-bold"
                          autoFocus
                        />
                        <input
                          type="text"
                          value={editingDesc}
                          onChange={(e) => setEditingDesc(e.target.value)}
                          placeholder="Deskripsi..."
                          className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                        />
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                          <Tag className="w-4 h-4 text-indigo-600" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-900">
                              {cat.nama_kategori}
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                              {count} Barang
                            </span>
                          </div>
                          {cat.deskripsi && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{cat.deskripsi}</p>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 self-end sm:self-auto">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => handleSaveEdit(cat.id)}
                            className="p-1.5 bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
                            title="Simpan Perubahan"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="p-1.5 bg-slate-200 text-slate-700 hover:bg-slate-300 rounded-lg text-xs transition"
                            title="Batal"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleStartEdit(cat)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="Edit / Ganti Nama Kategori"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(cat)}
                            className={`p-1.5 rounded-lg transition ${
                              count > 0
                                ? 'text-slate-300 cursor-not-allowed'
                                : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                            }`}
                            title={count > 0 ? 'Tidak dapat dihapus karena masih digunakan barang' : 'Hapus Kategori'}
                            disabled={count > 0}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition"
          >
            Selesai / Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
