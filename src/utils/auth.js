/**
 * Util sesi login & pembungkus fetch global.
 *
 * - Token disimpan di localStorage agar sesi bertahan saat refresh.
 * - installAuthFetch() menambal window.fetch SEKALI: setiap request /api
 *   otomatis menyertakan header Authorization, dan bila server menjawab 401
 *   sesi dihapus lalu pengguna dikembalikan ke halaman login.
 *
 * Semua fungsi aman dipanggil dari SSR (renderToString) — tanpa akses
 * window/localStorage saat environment tidak tersedia.
 */

const TOKEN_KEY = 'bda_token';
const USER_KEY = 'bda_user';

const hasStorage = () => typeof localStorage !== 'undefined';

export function getToken() {
  return hasStorage() ? localStorage.getItem(TOKEN_KEY) : null;
}

export function getSession() {
  if (!hasStorage()) return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(USER_KEY);
  if (!token || !raw) return null;
  try {
    return { token, user: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  if (!hasStorage()) return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  if (!hasStorage()) return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ============================================================
// Hirarki peran & hak akses sisi tampilan (server tetap final)
// ============================================================
export const ROLE_LABELS = {
  admin: 'Administrator',
  staff_gudang: 'Staff Gudang',
  teknisi: 'Teknisi Lapangan',
  viewer: 'Viewer'
};

export const ROLE_DESCRIPTIONS = {
  admin: 'Akses penuh: semua modul, manajemen user, dan reset data',
  staff_gudang: 'Kelola master barang, stok masuk/keluar, import, dan scan',
  teknisi: 'Kelola data pelanggan, FO, dan tower serta barang terpasang',
  viewer: 'Hanya melihat dashboard, daftar data, dan laporan'
};

/** Urutan menu yang bisa dibuka tiap peran. */
export const MENU_ACCESS = {
  dashboard: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  master: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  pelanggan: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  fo: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  tower: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  transaksi: ['admin', 'staff_gudang'],
  bonteknisi: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  laporan: ['admin', 'staff_gudang', 'teknisi', 'viewer'],
  users: ['admin']
};

export const canAccessMenu = (menuId, role) => (MENU_ACCESS[menuId] || []).includes(role);

/** Boleh mengubah master barang / transaksi stok? (admin & staff gudang) */
export const canManageInventory = (role) => ['admin', 'staff_gudang'].includes(role);

/** Boleh membuat bon teknisi, mencatat pengembalian & membatalkan bon? (admin & staff gudang) */
export const canManageBon = (role) => ['admin', 'staff_gudang'].includes(role);

/** Boleh mencatat realisasi pemasangan dari bon? (admin, staff gudang, teknisi) */
export const canInstallFromBon = (role) => ['admin', 'staff_gudang', 'teknisi'].includes(role);

/** Boleh mengubah data pelanggan/FO/tower? (admin, staff gudang, teknisi) */
export const canManageDivisions = (role) => ['admin', 'staff_gudang', 'teknisi'].includes(role);

// ============================================================
// Penambal window.fetch (dipasang sekali dari App)
// ============================================================
let installed = false;

export function installAuthFetch(onUnauthorized, onTransient401) {
  if (installed || typeof window === 'undefined' || !window.fetch) return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const isApi = url.startsWith('/api') || url.includes('://') && url.includes('/api') ;

    // Catat token yang dipakai request INI (bisa saja token lama yang baru diganti)
    let usedToken = null;
    if (isApi && !url.includes('/api/auth/login')) {
      usedToken = getToken();
      if (usedToken) {
        const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined) || {});
        // Multi-saluran: beberapa proxy preview menghapus header Authorization,
        // jadi token juga dikirim lewat header kustom + (GET) query parameter.
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${usedToken}`);
        if (!headers.has('X-Session-Token')) headers.set('X-Session-Token', usedToken);
        const method = String(init.method || 'GET').toUpperCase();
        if (method === 'GET' && typeof input === 'string' && !url.includes('_token=')) {
          input = url + (url.includes('?') ? '&' : '?') + '_token=' + encodeURIComponent(usedToken);
        }
        init = { ...init, headers };
      }
    }

    const res = await originalFetch(input, init);

    if (isApi && res.status === 401 && !url.includes('/api/auth/login')) {
      // Hanya proses bila request ini memakai token yang MASIH aktif tersimpan
      const currentToken = getToken();
      if (usedToken && currentToken && usedToken === currentToken) {
        // Lapisan 1: API kami selalu menjawab JSON. Bila 401 datang sebagai
        // HTML, hampir pasti dari gateway/proxy (sandbox bangun tidur) → abaikan.
        const contentType = res.headers?.get?.('content-type') || '';
        const looksLikeApi = contentType.includes('application/json');

        // Lapisan 2: konfirmasi ulang ke server — benarkah sesi ini ditolak?
        // Melindungi sesi dari 401 palsu infrastruktur (proxy/gateway tersendat).
        let confirmed = false;
        if (looksLikeApi) {
          try {
            const probe = await originalFetch(`/api/auth/me?_token=${encodeURIComponent(usedToken)}`, {
              headers: { Authorization: `Bearer ${usedToken}`, 'X-Session-Token': usedToken }
            });
            const probeType = probe.headers?.get?.('content-type') || '';
            confirmed = probe.status === 401 && probeType.includes('application/json');
          } catch {
            confirmed = false; // jaringan putus ≠ sesi tidak valid
          }
        }

        if (confirmed) {
          console.warn('[auth] Sesi dikonfirmasi ditolak server (401):', url);
          clearSession();
          if (typeof onUnauthorized === 'function') {
            onUnauthorized('Sesi Anda berakhir. Silakan login kembali.');
          }
        } else {
          console.warn('[auth] 401 tidak terkonfirmasi (kemungkinan gangguan proxy), sesi dipertahankan:', url);
          if (typeof onTransient401 === 'function') onTransient401(url);
        }
      } else {
        console.info('[auth] Mengabaikan 401 dari request token lama:', url);
      }
    }
    return res;
  };
}
