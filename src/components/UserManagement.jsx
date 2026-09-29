import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldCheck,
  UserPlus,
  Search,
  Edit3,
  Trash2,
  X,
  RefreshCw,
  User as UserIcon,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff
} from 'lucide-react';
import { notify } from '../utils/notify';
import { ROLE_LABELS, ROLE_DESCRIPTIONS } from '../utils/auth';

const ROLE_BADGE = {
  admin: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  staff_gudang: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  teknisi: 'bg-amber-100 text-amber-700 border-amber-200',
  viewer: 'bg-slate-100 text-slate-600 border-slate-200'
};

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
  description: ROLE_DESCRIPTIONS[value]
}));

const emptyForm = { username: '', nama_lengkap: '', password: '', role: 'viewer', status: 'aktif' };

export default function UserManagement({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('');

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null); // null = tambah baru
  const [formData, setFormData] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [deletingUser, setDeletingUser] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.success) setUsers(data.data);
      else notify(data.error || 'Gagal memuat daftar user', 'error');
    } catch (err) {
      notify('Gagal terhubung ke server', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const filteredUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.nama_lengkap.toLowerCase().includes(q)
      );
    });
  }, [users, searchTerm, roleFilter]);

  const stats = useMemo(() => ({
    total: users.length,
    aktif: users.filter((u) => u.status === 'aktif').length,
    admin: users.filter((u) => u.role === 'admin').length
  }), [users]);

  const openAdd = () => {
    setEditingUser(null);
    setFormData(emptyForm);
    setFormError('');
    setShowPassword(false);
    setIsFormOpen(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      nama_lengkap: user.nama_lengkap,
      password: '',
      role: user.role,
      status: user.status
    });
    setFormError('');
    setShowPassword(false);
    setIsFormOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    const payload = {
      nama_lengkap: formData.nama_lengkap.trim(),
      role: formData.role,
      status: formData.status
    };

    if (!editingUser) {
      payload.username = formData.username.trim();
      payload.password = formData.password;
      if (!payload.username || !payload.password) {
        setFormError('Username dan password wajib diisi untuk user baru');
        return;
      }
    } else if (formData.password) {
      payload.password = formData.password; // hanya dikirim bila diganti
    }

    if (!payload.nama_lengkap) {
      setFormError('Nama lengkap wajib diisi');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = editingUser ? `/api/users/${editingUser.id}` : '/api/users';
      const res = await fetch(url, {
        method: editingUser ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setFormError(data.error || 'Gagal menyimpan user');
        return;
      }
      notify(editingUser ? `User "${formData.username}" berhasil diperbarui` : `User "${payload.username}" berhasil ditambahkan`);
      setIsFormOpen(false);
      fetchUsers();
    } catch (err) {
      setFormError('Gagal terhubung ke server');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingUser) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/users/${deletingUser.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        notify(data.error || 'Gagal menghapus user', 'error');
        return;
      }
      notify(data.message || 'User berhasil dihapus');
      setDeletingUser(null);
      fetchUsers();
    } catch (err) {
      notify('Gagal terhubung ke server', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatDateTime = (val) => {
    if (!val) return '—';
    const d = new Date(String(val).replace(' ', 'T'));
    if (isNaN(d)) return val;
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4">
      {/* Header + Statistik */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              Manajemen User
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Kelola akun & hirarki peran: Administrator → Staff Gudang → Teknisi Lapangan → Viewer
            </p>
          </div>
          <button
            onClick={openAdd}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center gap-2 shadow-sm shadow-indigo-200 transition self-start sm:self-auto"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tambah User</span>
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
            <div className="text-xl font-black text-slate-800">{stats.total}</div>
            <div className="text-[11px] font-medium text-slate-500">Total User</div>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <div className="text-xl font-black text-emerald-700">{stats.aktif}</div>
            <div className="text-[11px] font-medium text-emerald-600">User Aktif</div>
          </div>
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-3 py-2.5">
            <div className="text-xl font-black text-indigo-700">{stats.admin}</div>
            <div className="text-[11px] font-medium text-indigo-600">Administrator</div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between mb-4">
          <div className="flex flex-1 flex-col sm:flex-row gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari username / nama..."
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:bg-white focus:border-indigo-400 outline-none transition"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:bg-white"
            >
              <option value="">Semua Peran</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabel user */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 uppercase tracking-wider font-semibold">
              <tr>
                <th className="py-3 px-4">User</th>
                <th className="py-3 px-4">Peran</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Login Terakhir</th>
                <th className="py-3 px-4">Dibuat</th>
                <th className="py-3 px-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-10 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    Memuat daftar user...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-10 text-center text-slate-400">
                    Tidak ada user yang cocok dengan pencarian.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = currentUser && u.id === currentUser.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                            u.role === 'admin' ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'
                          }`}>
                            {u.nama_lengkap.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-bold text-slate-800 flex items-center gap-1.5">
                              {u.nama_lengkap}
                              {isSelf && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200">Anda</span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border ${ROLE_BADGE[u.role] || ROLE_BADGE.viewer}`}>
                          {ROLE_LABELS[u.role] || u.role}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold border ${
                          u.status === 'aktif'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                        }`}>
                          {u.status === 'aktif' ? <CheckCircle2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {u.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {formatDateTime(u.last_login)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">{formatDateTime(u.created_at)}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(u)}
                            className="p-2 rounded-lg bg-slate-100 hover:bg-indigo-100 text-slate-500 hover:text-indigo-700 transition"
                            title="Edit user"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => setDeletingUser(u)}
                              className="p-2 rounded-lg bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-700 transition"
                              title="Hapus user"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Tambah / Edit */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 my-8">
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white px-5 py-4 rounded-t-2xl flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {editingUser ? <Edit3 className="w-5 h-5 text-indigo-300" /> : <UserPlus className="w-5 h-5 text-indigo-300" />}
                <h3 className="font-bold">{editingUser ? `Edit User: @${editingUser.username}` : 'Tambah User Baru'}</h3>
              </div>
              <button onClick={() => setIsFormOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Username */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Username *</label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    disabled={!!editingUser}
                    placeholder="cth: agus.teknisi"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 rounded-xl text-sm disabled:opacity-60 disabled:cursor-not-allowed transition"
                  />
                </div>
                {editingUser
                  ? <p className="text-[11px] text-slate-400 mt-1">Username tidak dapat diubah.</p>
                  : <p className="text-[11px] text-slate-400 mt-1">3-32 karakter: huruf, angka, titik, strip, underscore.</p>}
              </div>

              {/* Nama lengkap */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">Nama Lengkap *</label>
                <input
                  type="text"
                  value={formData.nama_lengkap}
                  onChange={(e) => setFormData({ ...formData, nama_lengkap: e.target.value })}
                  placeholder="cth: Agus Setiawan"
                  className="w-full px-4 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 rounded-xl text-sm transition"
                />
              </div>

              {/* Peran & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Peran *</label>
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 rounded-xl text-sm transition"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1.5">Status *</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 rounded-xl text-sm transition"
                  >
                    <option value="aktif">Aktif</option>
                    <option value="nonaktif">Nonaktif</option>
                  </select>
                </div>
              </div>
              <p className="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2 -mt-1">
                {ROLE_DESCRIPTIONS[formData.role]}
              </p>

              {/* Password */}
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1.5">
                  {editingUser ? 'Password Baru (opsional)' : 'Password *'}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={editingUser ? 'Kosongkan bila tidak diganti' : 'Minimal 6 karakter'}
                    autoComplete="new-password"
                    className="w-full pl-10 pr-11 py-2.5 bg-slate-50 border-2 border-slate-200 focus:border-indigo-500 rounded-xl text-sm transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-indigo-600 transition"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : editingUser ? 'Simpan Perubahan' : 'Tambah User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal konfirmasi hapus */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Hapus User?</h3>
                <p className="text-xs text-slate-500">Tindakan ini tidak dapat dibatalkan.</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
              Akun <span className="font-mono font-bold">@{deletingUser.username}</span> ({deletingUser.nama_lengkap} — {ROLE_LABELS[deletingUser.role]}) akan dihapus permanen dan tidak bisa dipakai login lagi.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setDeletingUser(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                Batal
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition disabled:opacity-50"
              >
                {isDeleting ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
