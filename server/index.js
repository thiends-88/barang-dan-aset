import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db, { initDb, DB_PATH, DATA_DIR, BACKUP_DIR } from './db.js';
import { DatabaseSync } from 'node:sqlite';
import { pipeline, Transform } from 'node:stream';
import { seedData, seedUsers } from './seed.js';
import { ROLES, hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { getGitInfo, readPackageVersion, localStamp } from '../scripts/build-info.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLEARED_MARKER_PATH = path.join(DATA_DIR, '.cleared');

// Initialize DB and Seed data. Marker ini membedakan database produksi yang sengaja
// dikosongkan dari database baru yang memang perlu diisi data contoh.
initDb();
if (fs.existsSync(CLEARED_MARKER_PATH)) {
  console.log('[seed] dilewati — marker data/.cleared ditemukan');
} else {
  seedData();
}
seedUsers();

// Paksa semua perubahan seed masuk ke file .db utama (bukan hanya WAL),
// agar data tetap utuh saat workspace dipulihkan dari snapshot.
try {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
} catch { /* abaikan bila mode WAL tidak aktif */ }

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// INFO VERSI (dipakai /api/version, /api/health & VersionBadge)
// ==========================================
const SERVER_STARTED_AT = new Date();
// Commit yang benar-benar ter-checkout saat server start (null bila tanpa git)
const RUNTIME_GIT = getGitInfo();
const BUILD_INFO_PATH = path.join(__dirname, '..', 'dist', 'build-info.json');

/** Baca dist/build-info.json (dibuat `npm run build`); null bila belum ada/rusak. */
function readBuildInfo() {
  try {
    return JSON.parse(fs.readFileSync(BUILD_INFO_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function getVersionInfo() {
  const build = readBuildInfo();
  return {
    version: readPackageVersion(),
    build, // frontend yang sedang disajikan dari dist/
    runtime: {
      commit: RUNTIME_GIT.commit,
      commitShort: RUNTIME_GIT.commitShort,
      branch: RUNTIME_GIT.branch,
      commitDate: RUNTIME_GIT.commitDate,
      node: process.version,
      startedAt: localStamp(SERVER_STARTED_AT),
      uptimeSeconds: Math.round(process.uptime())
    }
  };
}

app.use(cors());
// Batas diperbesar agar import massal (ribuan baris JSON) tidak ditolak 413
app.use(express.json({ limit: '5mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Setelah pemulihan database, koneksi DB sudah ditutup & proses akan keluar —
// tolak semua request API lain sementara (lihat blok CADANGAN & PEMULIHAN DATABASE).
let serverRestarting = false;
app.use((req, res, next) => {
  if (serverRestarting && req.path.startsWith('/api/') && req.path !== '/api/health') {
    return res.status(503).json({ success: false, error: 'Server sedang memulai ulang setelah pemulihan database. Coba lagi beberapa detik.' });
  }
  next();
});

// ==========================================
// MIDDLEWARE OTENTIKASI & HIRARKI PERAN
// ==========================================

// Jalur yang boleh diakses tanpa login
const PUBLIC_PATHS = [
  /^\/api\/auth\/login$/,
  /^\/api\/health$/, // diagnostik waktu server — berguna cek sinkron jam
  /^\/api\/version$/, // info versi terpasang — dipakai skrip update & VersionBadge
  /^\/api\/public\//, // ringkasan aman untuk halaman login sebelum pengguna masuk
  /^\/api\/import\/template\// // template file statis, aman diumumkan
];

// Diagnostik: waktu & zona waktu server (dipakai memastikan jam sinkron WIB)
app.get('/api/health', (req, res) => {
  const now = new Date();
  res.json({
    success: true,
    data: {
      serverTime: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offsetMinutes: -now.getTimezoneOffset(),
      version: readPackageVersion(),
      commit: RUNTIME_GIT.commitShort,
      buildCommit: readBuildInfo()?.commitShort || null
    }
  });
});

// Info versi terpasang: versi paket, build frontend (dist/) & commit yang berjalan
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: getVersionInfo() });
});

// Aturan hak akses tulis (POST/PUT/DELETE) per kelompok endpoint.
// Endpoint GET boleh diakses semua peran yang sudah login.
const WRITE_RULES = [
  { pattern: /^\/api\/users(\/|$)/, roles: ['admin'] },
  { pattern: /^\/api\/reset-seed$/, roles: ['admin'] },
  { pattern: /^\/api\/admin(\/|$)/, roles: ['admin'] },
  // Bon Teknisi: realisasi pemasangan boleh dicatat teknisi sendiri; bawa barang
  // (stok gudang keluar), pengembalian, dan pembatalan hanya admin/staff gudang.
  { pattern: /^\/api\/technician-loans\/\d+\/install$/, roles: ['admin', 'staff_gudang', 'teknisi'] },
  { pattern: /^\/api\/technician-loans(\/|$)/, roles: ['admin', 'staff_gudang'] },
  { pattern: /^\/api\/teknisi(\/|$)/, roles: ['admin', 'staff_gudang'] },
  { pattern: /^\/api\/(items|categories|transactions)(\/|$)/, roles: ['admin', 'staff_gudang'] },
  { pattern: /^\/api\/(customers|fo|tower)(\/|$)/, roles: ['admin', 'staff_gudang', 'teknisi'] }
];

/*
 * Ekstrak token dari beberapa saluran — beberapa gateway/proxy preview
 * menghapus header Authorization, jadi klien juga mengirim lewat header
 * kustom dan (untuk GET) query parameter sebagai cadangan.
 */
function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  if (req.headers['x-session-token']) return String(req.headers['x-session-token']);
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']);
  if (typeof req.query?._token === 'string') return req.query._token;
  return null;
}

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_PATHS.some((p) => p.test(req.path))) return next();

  const token = extractToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login kembali.' });
  }

  // Ambil user terbaru dari DB agar perubahan peran/status langsung berlaku
  const user = db.prepare('SELECT id, username, nama_lengkap, role, status FROM users WHERE id = ?').get(payload.uid);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Akun tidak ditemukan. Silakan login kembali.' });
  }
  if (user.status !== 'aktif') {
    return res.status(403).json({ success: false, error: 'Akun Anda dinonaktifkan. Hubungi Administrator.' });
  }
  req.user = user;

  // Batasi operasi tulis sesuai peran
  if (req.method !== 'GET') {
    const rule = WRITE_RULES.find((r) => r.pattern.test(req.path));
    const allowed = rule ? rule.roles : ['admin', 'staff_gudang', 'teknisi'];
    if (!allowed.includes(user.role)) {
      const label = ROLES[user.role] || user.role;
      return res.status(403).json({ success: false, error: `Akses ditolak: peran ${label} tidak memiliki izin untuk aksi ini.` });
    }
  }
  next();
});

// Ringkasan publik untuk halaman login. Hanya angka agregat yang dibuka; tidak ada
// nama pelanggan, detail transaksi, ataupun informasi akun yang ikut terekspos.
app.get('/api/public/summary', (req, res) => {
  try {
    const transaksi = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN jenis = 'MASUK' THEN jumlah ELSE 0 END), 0) AS masuk,
        COALESCE(SUM(CASE WHEN jenis = 'KELUAR' THEN jumlah ELSE 0 END), 0) AS keluar
      FROM transactions
    `).get();
    const gudang = db.prepare(`
      SELECT COUNT(*) AS sku,
             COALESCE(SUM(stok), 0) AS stok_gudang,
             COALESCE(SUM(stok * harga_barang), 0) AS nilai_gudang
      FROM items
    `).get();
    const pelanggan = db.prepare(`
      SELECT COUNT(*) AS jumlah, COALESCE(SUM(total_harga), 0) AS nilai
      FROM customers
    `).get();
    const fo = db.prepare(`
      SELECT COUNT(*) AS jumlah, COALESCE(SUM(total_harga), 0) AS nilai
      FROM fo_sites
    `).get();
    const tower = db.prepare(`
      SELECT COUNT(*) AS jumlah, COALESCE(SUM(total_harga), 0) AS nilai
      FROM tower_sites
    `).get();
    const transit = db.prepare(`
      SELECT COALESCE(SUM(
        (li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) * li.harga_barang
      ), 0) AS nilai
      FROM technician_loans l
      JOIN technician_loan_items li ON li.loan_id = l.id
      WHERE l.status IN ('AKTIF', 'SEBAGIAN')
    `).get();

    const summary = {
      masuk: Number(transaksi.masuk || 0),
      keluar: Number(transaksi.keluar || 0),
      aset: Number(gudang.nilai_gudang || 0)
        + Number(pelanggan.nilai || 0)
        + Number(fo.nilai || 0)
        + Number(tower.nilai || 0)
        + Number(transit.nilai || 0),
      sku: Number(gudang.sku || 0),
      pelanggan: Number(pelanggan.jumlah || 0),
      fo: Number(fo.jumlah || 0),
      tower: Number(tower.jumlah || 0),
      stok_gudang: Number(gudang.stok_gudang || 0)
    };

    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// AUTH: LOGIN & PROFIL
// ==========================================

// Pembatas percobaan login (anti brute-force sederhana, in-memory)
const loginAttempts = new Map(); // key: "ip|username" → { count, resetAt }
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 15;

function loginThrottleKey(req, username) {
  return `${req.ip || 'unknown'}|${String(username || '').toLowerCase()}`;
}

function hitLoginThrottle(key) {
  const nowMs = Date.now();
  let entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= nowMs) {
    entry = { count: 0, resetAt: nowMs + LOGIN_WINDOW_MS };
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'Username dan password wajib diisi' });
    }

    const throttleKey = loginThrottleKey(req, username);
    const entry = loginAttempts.get(throttleKey);
    if (entry && entry.resetAt > Date.now() && entry.count >= LOGIN_MAX_ATTEMPTS) {
      const menit = Math.ceil((entry.resetAt - Date.now()) / 60000);
      return res.status(429).json({ success: false, error: `Terlalu banyak percobaan login. Coba lagi dalam ${menit} menit.` });
    }

    const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(String(username).trim());
    if (!user || !verifyPassword(password, user.password_hash)) {
      hitLoginThrottle(throttleKey);
      return res.status(401).json({ success: false, error: 'Username atau password salah' });
    }
    loginAttempts.delete(throttleKey);
    if (user.status !== 'aktif') {
      return res.status(403).json({ success: false, error: 'Akun dinonaktifkan. Hubungi Administrator.' });
    }

    db.prepare("UPDATE users SET last_login = datetime('now', 'localtime') WHERE id = ?").run(user.id);
    const token = signToken(user.id);
    res.json({
      success: true,
      data: {
        token,
        user: { id: user.id, username: user.username, nama_lengkap: user.nama_lengkap, role: user.role }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

app.post('/api/auth/logout', (req, res) => {
  // Token stateless — cukup dihapus di sisi klien
  res.json({ success: true, message: 'Berhasil keluar' });
});

// ==========================================
// MANAJEMEN USER (khusus admin)
// ==========================================

function adminOnly(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Fitur ini khusus Administrator' });
    return false;
  }
  return true;
}

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

// Daftar semua user (tanpa hash password)
app.get('/api/users', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const users = db.prepare(`
      SELECT id, username, nama_lengkap, role, status, last_login, created_at, updated_at
      FROM users ORDER BY role = 'admin' DESC, username ASC
    `).all();
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tambah user baru
app.post('/api/users', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { username, password, nama_lengkap, role = 'viewer', status = 'aktif' } = req.body || {};

    if (!username || !USERNAME_RE.test(String(username).trim())) {
      return res.status(400).json({ success: false, error: 'Username 3-32 karakter, hanya huruf/angka/titik/strip/underscore' });
    }
    if (!nama_lengkap || !String(nama_lengkap).trim()) {
      return res.status(400).json({ success: false, error: 'Nama lengkap wajib diisi' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Password minimal 6 karakter' });
    }
    if (!ROLES[role]) {
      return res.status(400).json({ success: false, error: `Peran tidak dikenal. Pilihan: ${Object.keys(ROLES).join(', ')}` });
    }
    if (!['aktif', 'nonaktif'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status harus aktif atau nonaktif' });
    }

    const dup = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(String(username).trim());
    if (dup) {
      return res.status(400).json({ success: false, error: `Username "${username}" sudah digunakan` });
    }

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, nama_lengkap, role, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(username).trim().toLowerCase(), hashPassword(password), String(nama_lengkap).trim(), role, status);

    const user = db.prepare('SELECT id, username, nama_lengkap, role, status, last_login, created_at, updated_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Edit user
app.put('/api/users/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { id } = req.params;
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }

    const { nama_lengkap, role, status, password } = req.body || {};

    if (nama_lengkap !== undefined && !String(nama_lengkap).trim()) {
      return res.status(400).json({ success: false, error: 'Nama lengkap tidak boleh kosong' });
    }
    if (role !== undefined && !ROLES[role]) {
      return res.status(400).json({ success: false, error: `Peran tidak dikenal. Pilihan: ${Object.keys(ROLES).join(', ')}` });
    }
    if (status !== undefined && !['aktif', 'nonaktif'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Status harus aktif atau nonaktif' });
    }
    if (password !== undefined && String(password).length > 0 && String(password).length < 6) {
      return res.status(400).json({ success: false, error: 'Password baru minimal 6 karakter' });
    }

    const newRole = role ?? target.role;
    const newStatus = status ?? target.status;

    // Lindungi diri sendiri agar admin tidak kehilangan akses
    if (target.id === req.user.id && (newRole !== 'admin' || newStatus !== 'aktif')) {
      return res.status(400).json({ success: false, error: 'Tidak dapat mengubah peran/status akun sendiri — gunakan akun admin lain' });
    }
    // Pastikan selalu ada minimal satu admin aktif
    if (target.role === 'admin' && (newRole !== 'admin' || newStatus !== 'aktif')) {
      const otherAdmins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'aktif' AND id != ?").get(target.id).c;
      if (otherAdmins === 0) {
        return res.status(400).json({ success: false, error: 'Tidak dapat menonaktifkan/menurunkan admin terakhir yang aktif' });
      }
    }

    db.prepare(`
      UPDATE users SET nama_lengkap = ?, role = ?, status = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      nama_lengkap !== undefined ? String(nama_lengkap).trim() : target.nama_lengkap,
      newRole,
      newStatus,
      target.id
    );

    if (password && String(password).length >= 6) {
      db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
        .run(hashPassword(password), target.id);
    }

    const user = db.prepare('SELECT id, username, nama_lengkap, role, status, last_login, created_at, updated_at FROM users WHERE id = ?').get(target.id);
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hapus user
app.delete('/api/users/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const { id } = req.params;
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User tidak ditemukan' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'Tidak dapat menghapus akun yang sedang Anda gunakan' });
    }
    if (target.role === 'admin') {
      const otherAdmins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'aktif' AND id != ?").get(target.id).c;
      if (otherAdmins === 0) {
        return res.status(400).json({ success: false, error: 'Tidak dapat menghapus admin terakhir yang aktif' });
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    res.json({ success: true, message: `User "${target.username}" berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Tanggal LOKAL hari ini (YYYY-MM-DD).
 * SATU-SATUNYA sumber tanggal di server — selaras dengan SQLite
 * datetime/date('now','localtime') dan kolom `waktu` (toTimeString lokal).
 * DILARANG memakai toISOString() (UTC) karena bisa bergeser sehari
 * terhadap waktu lokal, merusak rekap per tanggal di semua divisi.
 */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Validasi tanggal "YYYY-MM-DD" yang benar-benar ada di kalender.
 * Mencegah kolom tanggal berisi nilai sampah (mis. "2026-13-45") yang membuat
 * rekap per tahun/bulan (strftime) diam-diam kosong dan nomor transaksi ngawur.
 */
function isTanggalValid(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  const kabisat = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const maxHari = [31, kabisat ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= maxHari;
}

/** Tanggal opsional dari klien → string valid, null bila kosong, atau melempar Error Bahasa Indonesia. */
function tanggalOpsional(nilai, label) {
  const s = String(nilai ?? '').trim();
  if (!s) return null;
  if (!isTanggalValid(s)) throw new Error(`${label} harus berformat YYYY-MM-DD yang valid (diterima: "${s}")`);
  return s;
}

/**
 * Angka finite >= 0 dari klien — menolak nilai negatif / bukan angka.
 * Dipakai field stok, min_stok, dan harga_barang pada Master Barang agar
 * stok gudang tidak pernah bisa dibuat minus dari input yang salah.
 */
function angkaNonNegatif(nilai, label) {
  const num = toNonNegNumber(nilai);
  if (num === null) throw new Error(`${label} harus berupa angka 0 atau lebih (diterima: "${nilai}")`);
  return num;
}

/**
 * Field teks dari klien — menolak objek/array/boolean agar nilai seperti
 * `{a:1}` tidak diam-diam tersimpan sebagai "[object Object]".
 */
function teksBody(nilai, label) {
  if (nilai === undefined || nilai === null) return '';
  const t = typeof nilai;
  if (t !== 'string' && t !== 'number') throw new Error(`${label} harus berupa teks`);
  return String(nilai).trim();
}

// ==========================================================
// KONDISI BARANG & GUDANG RUSAK (logika bersama)
// ==========================================================
const KONDISI_LIST = ['Baik', 'Rusak Ringan', 'Rusak Berat', 'Afkir'];
const KONDISI_RUSAK = ['Rusak Ringan', 'Rusak Berat', 'Afkir'];
const DAMAGED_STATUS = ['DITAMPUNG', 'DIPERBAIKI', 'DIMUSNAHKAN'];
function normalizeKondisi(v) {
  if (v === undefined || v === null || String(v).trim() === '') return 'Baik';
  const s = String(v).trim();
  const found = KONDISI_LIST.find((k) => k.toLowerCase() === s.toLowerCase());
  if (found) return found;
  throw new Error(`Kondisi harus salah satu dari: ${KONDISI_LIST.join(', ')} (diterima: \"${s}\")`);
}
function isKondisiRusak(k) {
  return KONDISI_RUSAK.includes(k);
}
// Simpan entri ke ledger barang rusak
function buatDamagedEntry({ kode_barang, nama_barang, jenis_barang, satuan, harga_barang, jumlah, kondisi, sumber, sumber_id, sumber_nama, no_transaksi, keterangan, tanggal, dibuat_oleh }) {
  const now = new Date();
  const tgl = tanggal || todayLocal();
  const waktu = now.toTimeString().split(' ')[0];
  const k = normalizeKondisi(kondisi);
  const res = db.prepare(`
    INSERT INTO damaged_items (kode_barang, nama_barang, jenis_barang, satuan, harga_barang, jumlah, jumlah_awal, status, kondisi, sumber, sumber_id, sumber_nama, no_transaksi, keterangan, tanggal, waktu, dibuat_oleh)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'DITAMPUNG', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kode_barang, nama_barang, jenis_barang || '', satuan, harga_barang || 0, jumlah, jumlah,
    k, sumber || '', sumber_id ?? null, sumber_nama || '', no_transaksi || '', keterangan || '', tgl, waktu, dibuat_oleh || ''
  );
  return res.lastInsertRowid;
}

const hasTrxNoStmt = db.prepare('SELECT 1 FROM transactions WHERE no_transaksi = ?');
let trxFallbackSeq = 10000;

/**
 * Buat nomor transaksi unik: TRX-IN-YYYYMM-NNNN / TRX-OUT-YYYYMM-NNNN.
 * - Bulan (YYYYMM) mengikuti tanggal transaksi (default: todayLocal()) agar
 *   entri bertanggal mundur tetap selaras antara `tanggal` dan `no_transaksi`.
 * - Wajib memeriksa `transactions.no_transaksi` (UNIQUE) sebelum dipakai.
 *   Sebelumnya memakai acak 4 digit (1000–9999) tanpa cek unik: akibat
 *   paradoks ulang tahun, ~1% run `api-test.mjs` mengalami bentrok acak saat
 *   DELETE /api/tower/:id (me-rollback transaksi hapus → stok tertinggal 15
 *   dari 20 + 4 kegagalan lanjutan), dan import massal ratusan barang hampir
 *   pasti gagal dengan "UNIQUE constraint failed: transactions.no_transaksi".
 */
function generateTrxNumber(type, tanggal) {
  const prefix = type === 'MASUK' ? 'TRX-IN' : 'TRX-OUT';
  const tgl = typeof tanggal === 'string' && /^\d{4}-\d{2}/.test(tanggal) ? tanggal : todayLocal();
  const yearMonth = tgl.slice(0, 7).replace('-', '');

  for (let attempt = 0; attempt < 20; attempt++) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const candidate = `${prefix}-${yearMonth}-${randomSuffix}`;
    if (!hasTrxNoStmt.get(candidate)) return candidate;
  }

  // Cadangan deterministik bila ruang 4 digit pada bulan tersebut padat
  // (mis. import ribuan baris barang sekaligus dalam satu bulan).
  while (true) {
    const candidate = `${prefix}-${yearMonth}-${trxFallbackSeq++}`;
    if (!hasTrxNoStmt.get(candidate)) return candidate;
  }
}

// ==========================================
// HELPER: VALIDASI BARANG TERPASANG & INTEGRITAS STOK
// ==========================================

/** Ambil master barang berdasarkan kode (tidak peka huruf besar/kecil). */
function getMasterItem(kode) {
  return db.prepare('SELECT * FROM items WHERE kode_barang = ?')
    .get(String(kode || '').trim().toUpperCase());
}

/**
 * Validasi daftar barang terpasang yang dikirim dari frontend.
 * - Kode barang wajib terdaftar di master data
 * - Jumlah wajib angka >= 0 (baris kosong / jumlah 0 otomatis dilewati, jumlah negatif ditolak)
 * Mengembalikan { validated, totalHarga }.
 */
function validateInstalledItems(items, installDate) {
  const validated = [];
  let totalHarga = 0;

  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !it.kode_barang || !String(it.kode_barang).trim()) continue;

    const master = getMasterItem(it.kode_barang);
    if (!master) {
      throw new Error(`Kode barang "${it.kode_barang}" tidak terdaftar di master data`);
    }

    const mentah = it.jumlah;
    if (mentah === undefined || mentah === null || mentah === '') continue; // baris belum diisi
    const qty = Number(mentah);
    if (!Number.isFinite(qty)) {
      throw new Error(`Jumlah untuk "${master.nama_barang}" harus berupa angka (diterima: "${mentah}")`);
    }
    if (qty < 0) {
      throw new Error(`Jumlah untuk "${master.nama_barang}" tidak boleh negatif (diterima: ${qty})`);
    }
    if (qty === 0) continue; // baris dengan jumlah 0 dianggap belum diisi

    const subtotal = qty * master.harga_barang;
    totalHarga += subtotal;

    validated.push({
      kode_barang: master.kode_barang,
      nama_barang: master.nama_barang,
      jenis_barang: master.jenis_barang,
      satuan: master.satuan,
      jumlah: qty,
      harga_barang: master.harga_barang,
      subtotal,
      serial_number: it.serial_number ? String(it.serial_number).trim() : '',
      referensi_suplayer: master.referensi_suplayer || '',
      tanggal_pasang: installDate
    });
  }

  return { validated, totalHarga };
}

/** Total jumlah per kode barang. */
function sumQtyByCode(rows) {
  const map = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    map.set(r.kode_barang, (map.get(r.kode_barang) || 0) + Number(r.jumlah || 0));
  }
  return map;
}

/**
 * Pastikan stok gudang mencukupi sebelum stok dipotong.
 * oldQtyByCode = jumlah yang sedang terpasang dan akan dikembalikan lebih dulu (kasus edit data).
 */
function assertStockAvailable(newQtyByCode, oldQtyByCode = new Map()) {
  for (const [kode, qty] of newQtyByCode) {
    const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(kode);
    if (!master) {
      throw new Error(`Barang dengan kode "${kode}" tidak ditemukan di master data`);
    }
    const tersedia = Number(master.stok) + Number(oldQtyByCode.get(kode) || 0);
    if (qty > tersedia) {
      throw new Error(
        `Stok gudang tidak mencukupi untuk "${master.nama_barang}" (${kode}). ` +
        `Tersedia: ${tersedia} ${master.satuan}, dibutuhkan: ${qty} ${master.satuan}.`
      );
    }
  }
}

/** Catat satu baris mutasi stok ke tabel transactions. */
function logStockMutation({ jenis, kategori, divisi, refId = null, lokasi, item, jumlah, harga_satuan, keterangan = '', tanggal: tanggalMutasi, kondisi = 'Baik' }) {
  const now = new Date();
  const tanggal = tanggalMutasi || todayLocal();
  const harga = Number(harga_satuan !== undefined ? harga_satuan : (item.harga_barang || 0));
  const trxNo = generateTrxNumber(jenis, tanggal);
  const kondisiBersih = normalizeKondisi(kondisi);
  db.prepare(`
    INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, serial_number, keterangan, kondisi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trxNo,
    tanggal,
    now.toTimeString().split(' ')[0],
    jenis,
    kategori,
    divisi,
    refId,
    lokasi,
    item.kode_barang,
    item.nama_barang,
    item.satuan,
    jumlah,
    harga,
    jumlah * harga,
    item.serial_number || '',
    keterangan,
    kondisiBersih
  );
  return trxNo;
}

/**
 * Sinkronkan barang terpasang pada satu data divisi (pelanggan / FO / tower).
 * Baris lama diganti baris baru, lalu stok gudang disesuaikan berdasarkan SELISIH,
 * sehingga tidak ada stok yang hilang/tertahan dan setiap selisih tercatat sebagai mutasi.
 */
function reconcileInstalledItems({ table, fkColumn, ownerId, oldItems, validatedItems, divisi, refId, lokasiPenerima, label }) {
  const oldQtyByCode = sumQtyByCode(oldItems);
  const newQtyByCode = sumQtyByCode(validatedItems);

  // Baris dihapus lalu dibuat ulang — jejak teknisi pemasang & No. Bon (dari fitur Bon Teknisi)
  // dipertahankan dengan mencocokkan kode barang + SN pada baris lama.
  const jejak = new Map();
  for (const o of oldItems || []) {
    if (o && (o.dipasang_oleh || o.no_bon)) {
      jejak.set(`${o.kode_barang}|${(o.serial_number || '').toUpperCase()}`, { dipasang_oleh: o.dipasang_oleh || '', no_bon: o.no_bon || '' });
    }
  }
  db.prepare(`DELETE FROM ${table} WHERE ${fkColumn} = ?`).run(ownerId);
  const insert = db.prepare(`
    INSERT INTO ${table} (${fkColumn}, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang, dipasang_oleh, no_bon)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const it of validatedItems) {
    const j = jejak.get(`${it.kode_barang}|${(it.serial_number || '').toUpperCase()}`) || { dipasang_oleh: '', no_bon: '' };
    insert.run(ownerId, it.kode_barang, it.nama_barang, it.jenis_barang, it.satuan, it.jumlah, it.harga_barang, it.subtotal, it.serial_number, it.referensi_suplayer, it.tanggal_pasang, j.dipasang_oleh, j.no_bon);
  }

  const semuaKode = new Set([...oldQtyByCode.keys(), ...newQtyByCode.keys()]);
  for (const kode of semuaKode) {
    const sebelum = oldQtyByCode.get(kode) || 0;
    const sesudah = newQtyByCode.get(kode) || 0;
    const selisih = sesudah - sebelum; // > 0 = ambil dari gudang, < 0 = kembali ke gudang
    if (selisih === 0) continue;

    db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now','localtime') WHERE kode_barang = ?").run(selisih, kode);
    const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(kode);
    if (!master) continue;

    logStockMutation({
      jenis: selisih > 0 ? 'KELUAR' : 'MASUK',
      kategori: selisih > 0 ? 'Penyesuaian Pemasangan' : 'Penyesuaian Pengembalian',
      divisi,
      refId,
      lokasi: lokasiPenerima,
      item: master,
      jumlah: Math.abs(selisih),
      harga_satuan: master.harga_barang,
      keterangan: `${label} — ${selisih > 0 ? 'tambahan pemasangan' : 'pengembalian ke gudang'} ${Math.abs(selisih)} ${master.satuan}`
    });
  }
}

/** Kembalikan stok semua barang yang masih terpasang pada satu data divisi (dipakai saat hapus data). */
function restoreInstalledStock({ table, fkColumn, ownerId, divisi, refId, lokasi, label }) {
  const items = db.prepare(`SELECT * FROM ${table} WHERE ${fkColumn} = ?`).all(ownerId);
  for (const it of items) {
    db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE kode_barang = ?").run(it.jumlah, it.kode_barang);
    logStockMutation({
      jenis: 'MASUK',
      kategori: 'Penghapusan Data',
      divisi,
      refId,
      lokasi,
      item: it,
      jumlah: it.jumlah,
      harga_satuan: it.harga_barang,
      keterangan: `${label} — ${it.jumlah} ${it.satuan} dikembalikan ke stok gudang`
    });
  }
  return items.length;
}

// ==========================================
// 0. MASTER KATEGORI / JENIS BARANG
// ==========================================

// Get all categories
app.get('/api/categories', (req, res) => {
  try {
    // Auto-sync any category present in items that might not be in categories table
    const distinctItemCats = db.prepare("SELECT DISTINCT jenis_barang FROM items WHERE jenis_barang IS NOT NULL AND jenis_barang != ''").all();
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (nama_kategori) VALUES (?)');
    for (const c of distinctItemCats) {
      insertCat.run(c.jenis_barang);
    }

    const categories = db.prepare('SELECT * FROM categories ORDER BY nama_kategori ASC').all();
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create category
app.post('/api/categories', (req, res) => {
  try {
    const { nama_kategori, deskripsi = '' } = req.body;
    if (!nama_kategori || !nama_kategori.trim()) {
      return res.status(400).json({ success: false, error: 'Nama kategori wajib diisi' });
    }

    const trimmed = nama_kategori.trim();
    const existing = db.prepare('SELECT * FROM categories WHERE LOWER(nama_kategori) = LOWER(?)').get(trimmed);
    if (existing) {
      return res.status(400).json({ success: false, error: `Kategori "${trimmed}" sudah ada`, data: existing });
    }

    const insert = db.prepare('INSERT INTO categories (nama_kategori, deskripsi) VALUES (?, ?)');
    const result = insert.run(trimmed, deskripsi.trim());
    const newCat = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: newCat, message: `Kategori "${trimmed}" berhasil ditambahkan` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update category
app.put('/api/categories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { nama_kategori, deskripsi } = req.body;

    const current = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    const newName = nama_kategori ? nama_kategori.trim() : current.nama_kategori;
    if (newName.toLowerCase() !== current.nama_kategori.toLowerCase()) {
      const dup = db.prepare('SELECT id FROM categories WHERE LOWER(nama_kategori) = LOWER(?) AND id != ?').get(newName, id);
      if (dup) {
        return res.status(400).json({ success: false, error: `Kategori "${newName}" sudah ada` });
      }
    }

    // Update category and update all items using the old category name
    db.prepare('UPDATE categories SET nama_kategori = ?, deskripsi = ? WHERE id = ?').run(
      newName,
      deskripsi !== undefined ? deskripsi.trim() : current.deskripsi,
      id
    );

    if (newName !== current.nama_kategori) {
      db.prepare('UPDATE items SET jenis_barang = ? WHERE jenis_barang = ?').run(newName, current.nama_kategori);
    }

    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: `Kategori berhasil diubah` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete category
app.delete('/api/categories/:id', (req, res) => {
  try {
    const { id } = req.params;
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!cat) {
      return res.status(404).json({ success: false, error: 'Kategori tidak ditemukan' });
    }

    // Check if items are using this category
    const used = db.prepare('SELECT COUNT(*) as count FROM items WHERE LOWER(jenis_barang) = LOWER(?)').get(cat.nama_kategori);
    if (used.count > 0) {
      return res.status(400).json({
        success: false,
        error: `Kategori "${cat.nama_kategori}" tidak dapat dihapus karena masih digunakan oleh ${used.count} barang. Ubah kategori barang terlebih dahulu.`
      });
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ success: true, message: `Kategori "${cat.nama_kategori}" berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 1. MASTER BARANG (ITEMS)
// ==========================================

// Get all items
app.get('/api/items', (req, res) => {
  try {
    // stok_transit = barang yang sedang dibawa teknisi (bon aktif) — sudah keluar dari stok gudang
    const items = db.prepare(`
      SELECT i.*, COALESCE((
        SELECT SUM(li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali)
        FROM technician_loan_items li
        JOIN technician_loans l ON l.id = li.loan_id
        WHERE li.kode_barang = i.kode_barang AND l.status IN ('AKTIF', 'SEBAGIAN')
      ), 0) AS stok_transit
      FROM items i
      ORDER BY i.id DESC
    `).all();
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single item by ID or code
app.get('/api/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    let item = null;
    if (isNaN(id)) {
      item = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(id);
    } else {
      item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    }
    if (!item) {
      return res.status(404).json({ success: false, error: 'Barang tidak ditemukan' });
    }
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create item
app.post('/api/items', (req, res) => {
  try {
    const body = req.body || {};
    // Semua field dinormalisasi lebih dulu; nilai non-string (mis. objek) tidak
    // boleh menabrak .trim() sehingga menjawab 500, dan angka negatif / bukan
    // angka (mis. stok "-5" atau "abc") ditolak 400 — bukan disimpan apa adanya.
    let kode_barang, nama_barang, satuan, jenis_barang, referensi_suplayer, catatan;
    let stok, min_stok, harga_barang;
    try {
      kode_barang = teksBody(body.kode_barang, 'Kode barang').toUpperCase();
      nama_barang = teksBody(body.nama_barang, 'Nama barang');
      satuan = teksBody(body.satuan, 'Satuan') || 'unit';
      jenis_barang = teksBody(body.jenis_barang, 'Jenis / kategori barang');
      referensi_suplayer = teksBody(body.referensi_suplayer, 'Referensi suplayer');
      catatan = teksBody(body.catatan, 'Catatan');

      if (!kode_barang || !nama_barang || !jenis_barang) {
        throw new Error('Kode, nama, dan jenis barang wajib diisi');
      }
      if (kode_barang.length > 60) throw new Error('Kode barang maksimal 60 karakter');
      if (nama_barang.length > 200) throw new Error('Nama barang maksimal 200 karakter');
      if (jenis_barang.length > 100) throw new Error('Jenis / kategori barang maksimal 100 karakter');
      if (satuan.length > 30) throw new Error('Satuan maksimal 30 karakter');

      stok = angkaNonNegatif(body.stok ?? 0, 'Stok awal');
      min_stok = angkaNonNegatif(body.min_stok ?? 5, 'Batas min. stok');
      harga_barang = angkaNonNegatif(body.harga_barang ?? 0, 'Harga barang');
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }

    // Check duplicate code
    const existing = db.prepare('SELECT id FROM items WHERE LOWER(kode_barang) = LOWER(?)').get(kode_barang);
    if (existing) {
      return res.status(400).json({ success: false, error: `Kode barang "${kode_barang}" sudah digunakan` });
    }

    const createItemTx = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO items (kode_barang, nama_barang, satuan, jenis_barang, stok, min_stok, harga_barang, referensi_suplayer, catatan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insert.run(
        kode_barang,
        nama_barang,
        satuan,
        jenis_barang,
        stok,
        min_stok,
        harga_barang,
        referensi_suplayer,
        catatan
      );

      const newItemId = result.lastInsertRowid;

      // Auto-register category into categories table if new
      try {
        db.prepare('INSERT OR IGNORE INTO categories (nama_kategori) VALUES (?)').run(jenis_barang);
      } catch {}

      // Log stock-in transaction if initial stock > 0
      if (stok > 0) {
        const now = new Date();
        const tanggal = todayLocal();
        const waktu = now.toTimeString().split(' ')[0];
        const trxNo = generateTrxNumber('MASUK', tanggal);

        db.prepare(`
          INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          trxNo,
          tanggal,
          waktu,
          'MASUK',
          'Pembelian Supplier',
          'GUDANG',
          newItemId,
          referensi_suplayer || 'Stok Awal Master',
          kode_barang,
          nama_barang,
          satuan,
          stok,
          harga_barang,
          stok * harga_barang,
          'Input Master Barang Baru (Stok Awal)'
        );
      }

      return newItemId;
    });

    const newItemId = createItemTx();
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(newItemId);
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update item
//
// Perubahan stok lewat form edit WAJIB tercatat sebagai mutasi "Koreksi Stok"
// (dulu kolom stok bisa diubah diam-diam tanpa jejak transaksi sehingga invarian
// "stok = snapshot + Σ(transactions)" rusak dan stok bisa menjadi minus).
// Perubahan kode barang juga disinkronkan ke seluruh rujukan barang terpasang
// agar laporan & pengaman hapus tetap mengenali barang yang sama.
app.put('/api/items/:id', (req, res) => {
  const updateItem = db.transaction(() => {
    const { id } = req.params;
    const body = req.body || {};

    const current = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!current) {
      const e = new Error('Barang tidak ditemukan');
      e.statusCode = 404;
      throw e;
    }

    const kode_barang = body.kode_barang !== undefined
      ? teksBody(body.kode_barang, 'Kode barang').toUpperCase()
      : current.kode_barang;
    const nama_barang = body.nama_barang !== undefined
      ? teksBody(body.nama_barang, 'Nama barang')
      : current.nama_barang;
    const satuan = body.satuan !== undefined
      ? (teksBody(body.satuan, 'Satuan') || current.satuan)
      : current.satuan;
    const jenis_barang = body.jenis_barang !== undefined
      ? teksBody(body.jenis_barang, 'Jenis / kategori barang')
      : current.jenis_barang;
    const referensi_suplayer = body.referensi_suplayer !== undefined
      ? teksBody(body.referensi_suplayer, 'Referensi suplayer')
      : current.referensi_suplayer;
    const catatan = body.catatan !== undefined
      ? teksBody(body.catatan, 'Catatan')
      : current.catatan;

    if (!kode_barang) throw new Error('Kode barang tidak boleh kosong');
    if (!nama_barang) throw new Error('Nama barang tidak boleh kosong');
    if (!jenis_barang) throw new Error('Jenis / kategori barang tidak boleh kosong');
    if (kode_barang.length > 60) throw new Error('Kode barang maksimal 60 karakter');
    if (nama_barang.length > 200) throw new Error('Nama barang maksimal 200 karakter');
    if (jenis_barang.length > 100) throw new Error('Jenis / kategori barang maksimal 100 karakter');
    if (satuan.length > 30) throw new Error('Satuan maksimal 30 karakter');

    const stok = body.stok !== undefined ? angkaNonNegatif(body.stok, 'Stok') : current.stok;
    const min_stok = body.min_stok !== undefined ? angkaNonNegatif(body.min_stok, 'Batas min. stok') : current.min_stok;
    const harga_barang = body.harga_barang !== undefined ? angkaNonNegatif(body.harga_barang, 'Harga barang') : current.harga_barang;

    // Check duplicate code if changed
    if (kode_barang !== current.kode_barang) {
      const dup = db.prepare('SELECT id FROM items WHERE LOWER(kode_barang) = LOWER(?) AND id != ?').get(kode_barang, id);
      if (dup) {
        throw new Error(`Kode barang "${kode_barang}" sudah digunakan`);
      }
    }

    db.prepare(`
      UPDATE items
      SET kode_barang = ?,
          nama_barang = ?,
          satuan = ?,
          jenis_barang = ?,
          stok = ?,
          min_stok = ?,
          harga_barang = ?,
          referensi_suplayer = ?,
          catatan = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      kode_barang,
      nama_barang,
      satuan,
      jenis_barang,
      stok,
      min_stok,
      harga_barang,
      referensi_suplayer,
      catatan,
      current.id
    );

    // Auto-register category into categories table if new
    try {
      db.prepare('INSERT OR IGNORE INTO categories (nama_kategori) VALUES (?)').run(jenis_barang);
    } catch {}

    // Perubahan angka stok dari form edit → catat mutasi koreksi agar jejak audit utuh
    const selisih = round3(stok - Number(current.stok));
    if (selisih !== 0) {
      logStockMutation({
        jenis: selisih > 0 ? 'MASUK' : 'KELUAR',
        kategori: 'Koreksi Stok',
        divisi: 'GUDANG',
        refId: current.id,
        lokasi: 'Koreksi Master Barang',
        item: { ...current, kode_barang, nama_barang, satuan, harga_barang },
        jumlah: Math.abs(selisih),
        harga_satuan: harga_barang,
        keterangan: `Koreksi stok manual Master Barang ${kode_barang}: ${current.stok} → ${stok} ${satuan}`
      });
    }

    // Ganti kode barang → seluruh rujukan barang terpasang ikut diperbarui
    if (kode_barang !== current.kode_barang) {
      for (const tbl of ['customer_items', 'fo_items', 'tower_items', 'technician_loan_items']) {
        db.prepare(`UPDATE ${tbl} SET kode_barang = ? WHERE UPPER(kode_barang) = UPPER(?)`).run(kode_barang, current.kode_barang);
      }
    }

    return db.prepare('SELECT * FROM items WHERE id = ?').get(current.id);
  });

  try {
    res.json({ success: true, data: updateItem() });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }
});

// Delete item
app.delete('/api/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Barang tidak ditemukan' });
    }

    // Check if item is in use
    const custUse = db.prepare('SELECT COUNT(*) as c FROM customer_items WHERE kode_barang = ?').get(item.kode_barang);
    const foUse = db.prepare('SELECT COUNT(*) as c FROM fo_items WHERE kode_barang = ?').get(item.kode_barang);
    const towerUse = db.prepare('SELECT COUNT(*) as c FROM tower_items WHERE kode_barang = ?').get(item.kode_barang);

    if (custUse.c > 0 || foUse.c > 0 || towerUse.c > 0) {
      return res.status(400).json({
        success: false,
        error: `Barang "${item.nama_barang}" tidak dapat dihapus karena masih terpasang di divisi (${custUse.c} pelanggan, ${foUse.c} titik FO, ${towerUse.c} site tower). Silakan dismantle terlebih dahulu.`
      });
    }

    const transit = db.prepare(`
      SELECT COALESCE(SUM(li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali), 0) AS qty
      FROM technician_loan_items li JOIN technician_loans l ON l.id = li.loan_id
      WHERE li.kode_barang = ? AND l.status IN ('AKTIF', 'SEBAGIAN')
    `).get(item.kode_barang);
    if (transit.qty > 0) {
      return res.status(400).json({
        success: false,
        error: `Barang \"${item.nama_barang}\" tidak dapat dihapus karena masih dibawa teknisi (${transit.qty} ${item.satuan} pada bon aktif). Selesaikan atau kembalikan bon terlebih dahulu.`
      });
    }

    db.prepare('DELETE FROM items WHERE id = ?').run(id);
    res.json({ success: true, message: `Barang ${item.nama_barang} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// IMPORT MASSAL (dari file CSV / Excel yang sudah diparse frontend menjadi JSON)
// ==========================================

const MAX_IMPORT_ROWS = 5000;

// ============================================================
// TEMPLATE IMPORT — diunduh langsung dari server (lebih andal
// daripada Blob URL yang sering diblokir iframe preview/browser)
// GET /api/import/template/items?format=xlsx|csv
// GET /api/import/template/customers?format=xlsx|csv
// ============================================================
const IMPORT_TEMPLATES = {
  items: {
    filename: 'template_import_barang',
    sheetName: 'Data Barang',
    headers: ['kode_barang', 'nama_barang', 'satuan', 'jenis_barang', 'stok', 'min_stok', 'harga_barang', 'referensi_suplayer', 'catatan'],
    sample: [
      ['BRG-ONT-F609', 'ONU ZTE F609 GPON 4FE+2POTS+WiFi', 'unit', 'Perangkat Aktif Pelanggan', 25, 5, 185000, 'PT. Fiber Solusindo Nusantara', 'CONTOH — hapus baris ini sebelum import'],
      ['BRG-FO-SPLITTER-1-8', 'Splitter PLC 1:8 SC-UPC Cassette', 'pcs', 'Aksesoris & Pasif FO', 40, 10, 45000, 'PT. Solusi Optik Digital', '']
    ]
  },
  customers: {
    filename: 'template_import_pelanggan',
    sheetName: 'Data Pelanggan',
    headers: ['id_pelanggan', 'nama_pelanggan', 'infrastruktur', 'paket', 'keterangan_paket', 'kategori', 'status', 'alamat', 'telepon', 'tanggal_pasang', 'catatan'],
    sample: [
      ['PLG-2026-0001', 'Budi Santoso', 'optic', 'home', '20 Mbps', 'bandwidth', 'aktif', 'Jl. Merdeka No. 10, Solok', '081234567890', '2026-09-01', 'CONTOH — hapus baris ini sebelum import'],
      ['PLG-2026-0002', 'Toko Kelontong Barokah', 'wireless', 'soho', '50 Mbps', 'rent', 'aktif', 'Pasar Raya Solok Blok C-2', '081298765432', '2026-09-03', '']
    ]
  }
};

app.get('/api/import/template/:type', async (req, res) => {
  try {
    const tpl = IMPORT_TEMPLATES[req.params.type];
    if (!tpl) {
      return res.status(404).json({ success: false, error: 'Template tidak dikenal. Gunakan "items" atau "customers".' });
    }
    const format = String(req.query.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const aoa = [tpl.headers, ...tpl.sample];

    if (format === 'csv') {
      // Pemisah titik koma + BOM agar langsung rapi dibuka di Excel Indonesia
      const csv = '﻿' + aoa
        .map((r) => r.map((v) => String(v ?? '').replaceAll(';', ',')).join(';'))
        .join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${tpl.filename}.csv"`);
      return res.send(csv);
    }

    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = tpl.headers.map((h) => ({ wch: Math.max(h.length + 2, 16) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tpl.sheetName);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${tpl.filename}.xlsx"`);
    return res.send(buf);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/** Validasi payload import: harus berupa { rows: [...] } dengan batas jumlah baris. */
function parseImportPayload(req, res) {
  const rows = req.body?.rows;
  const mode = req.body?.mode === 'update' ? 'update' : 'skip';
  if (!Array.isArray(rows)) {
    res.status(400).json({ success: false, error: 'Payload tidak valid: "rows" harus berupa array' });
    return null;
  }
  if (rows.length === 0) {
    res.status(400).json({ success: false, error: 'File tidak berisi baris data untuk diimport' });
    return null;
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    res.status(400).json({ success: false, error: `Maksimal ${MAX_IMPORT_ROWS} baris per sekali import (diterima: ${rows.length})` });
    return null;
  }
  return { rows, mode };
}

/** Angka >= 0 atau null (angka negatif / bukan angka ditolak). */
function toNonNegNumber(val) {
  if (val === undefined || val === null || String(val).trim() === '') return 0;
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

// Import massal Master Barang
app.post('/api/items/import', (req, res) => {
  const payload = parseImportPayload(req, res);
  if (!payload) return;
  const { rows, mode } = payload;

  const summary = { inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const seenCodes = new Set();

  const insertItem = db.prepare(`
    INSERT INTO items (kode_barang, nama_barang, satuan, jenis_barang, stok, min_stok, harga_barang, referensi_suplayer, catatan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateItem = db.prepare(`
    UPDATE items SET nama_barang = ?, satuan = ?, jenis_barang = ?, min_stok = ?, harga_barang = ?,
      referensi_suplayer = ?, catatan = ?, updated_at = datetime('now', 'localtime')
    WHERE LOWER(kode_barang) = LOWER(?)
  `);
  const insertTrx = db.prepare(`
    INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runImport = db.transaction(() => {
    rows.forEach((raw, idx) => {
      const baris = idx + 2; // baris 1 = header di file asal
      const row = raw || {};
      const kode = String(row.kode_barang ?? '').trim().toUpperCase();
      const nama = String(row.nama_barang ?? '').trim();
      const jenis = String(row.jenis_barang ?? '').trim();
      const satuan = String(row.satuan ?? '').trim() || 'unit';
      const suplayer = String(row.referensi_suplayer ?? '').trim();
      const catatan = String(row.catatan ?? '').trim();

      const fail = (error) => { summary.failed++; summary.errors.push({ baris, kode: kode || '-', error }); };

      if (!kode && !nama && !jenis) return; // baris kosong murni diabaikan
      if (!kode) return fail('Kode barang wajib diisi');
      if (!nama) return fail(`Nama barang wajib diisi (${kode})`);
      if (!jenis) return fail(`Jenis/kategori barang wajib diisi (${kode})`);
      if (seenCodes.has(kode)) return fail(`Kode ${kode} muncul lebih dari sekali di file`);
      seenCodes.add(kode);

      const stok = toNonNegNumber(row.stok);
      const minStok = toNonNegNumber(row.min_stok === '' || row.min_stok === undefined ? 5 : row.min_stok);
      const harga = toNonNegNumber(row.harga_barang);
      if (stok === null) return fail(`Stok "${row.stok}" bukan angka valid (${kode})`);
      if (minStok === null) return fail(`Min stok "${row.min_stok}" bukan angka valid (${kode})`);
      if (harga === null) return fail(`Harga "${row.harga_barang}" bukan angka valid (${kode})`);

      const existing = db.prepare('SELECT id FROM items WHERE LOWER(kode_barang) = LOWER(?)').get(kode);
      if (existing) {
        if (mode === 'update') {
          // Mode perbarui: update data master saja, stok tidak disentuh demi integritas transaksi
          updateItem.run(nama, satuan, jenis, minStok, harga, suplayer, catatan, kode);
          summary.updated++;
        } else {
          summary.skipped++;
        }
        return;
      }

      const result = insertItem.run(kode, nama, satuan, jenis, stok, minStok, harga, suplayer, catatan);
      try {
        db.prepare('INSERT OR IGNORE INTO categories (nama_kategori) VALUES (?)').run(jenis);
      } catch {}

      // Catat stok awal sebagai transaksi masuk agar riwayat tetap konsisten
      if (stok > 0) {
        const now = new Date();
        const tanggal = todayLocal();
        insertTrx.run(
          generateTrxNumber('MASUK', tanggal),
          tanggal,
          now.toTimeString().split(' ')[0],
          'MASUK',
          'Pembelian Supplier',
          'GUDANG',
          result.lastInsertRowid,
          suplayer || 'Import Data',
          kode,
          nama,
          satuan,
          stok,
          harga,
          stok * harga,
          'Import Massal Master Barang (Stok Awal)'
        );
      }
      summary.inserted++;
    });
  });

  try {
    runImport();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: `Import dibatalkan: ${err.message}` });
  }
});

// Import massal Pelanggan (data master saja, tanpa barang terpasang)
app.post('/api/customers/import', (req, res) => {
  const payload = parseImportPayload(req, res);
  if (!payload) return;
  const { rows, mode } = payload;

  const INFRA_OPTIONS = ['optic', 'wireless'];
  const PAKET_OPTIONS = ['personal', 'home', 'family', 'middle', 'soho', 'small', 'little', 'bronze', 'free', 'parallel', 'custom', 'dedicated'];
  const KATEGORI_OPTIONS = ['bandwidth', 'rent', 'service', 'lainnya', 'kombinasi'];
  const STATUS_OPTIONS = ['aktif', 'blokir', 'cuti', 'putus'];

  const summary = { inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const seenIds = new Set();

  const insertCust = db.prepare(`
    INSERT INTO customers (id_pelanggan, nama_pelanggan, infrastruktur, paket, keterangan_paket, kategori, status, alamat, telepon, tanggal_pasang, total_harga, catatan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const updateCust = db.prepare(`
    UPDATE customers SET nama_pelanggan = ?, infrastruktur = ?, paket = ?, keterangan_paket = ?, kategori = ?,
      status = ?, alamat = ?, telepon = ?, tanggal_pasang = ?, catatan = ?, updated_at = datetime('now', 'localtime')
    WHERE LOWER(id_pelanggan) = LOWER(?)
  `);

  const runImport = db.transaction(() => {
    rows.forEach((raw, idx) => {
      const baris = idx + 2;
      const row = raw || {};
      const idPel = String(row.id_pelanggan ?? '').trim().toUpperCase();
      const nama = String(row.nama_pelanggan ?? '').trim();
      const infra = String(row.infrastruktur ?? '').trim().toLowerCase() || 'optic';
      const paket = String(row.paket ?? '').trim().toLowerCase() || 'home';
      const ketPaket = String(row.keterangan_paket ?? '').trim();
      const kategori = String(row.kategori ?? '').trim().toLowerCase() || 'bandwidth';
      const status = String(row.status ?? '').trim().toLowerCase() || 'aktif';
      const alamat = String(row.alamat ?? '').trim();
      const telepon = String(row.telepon ?? '').trim();
      const catatan = String(row.catatan ?? '').trim();
      let tanggal = String(row.tanggal_pasang ?? '').trim() || todayLocal();
      // Terima juga timestamp ISO penuh ("2026-09-01T00:00:00.000Z") → ambil bagian tanggalnya
      if (/^\d{4}-\d{2}-\d{2}T/.test(tanggal)) tanggal = tanggal.slice(0, 10);

      const fail = (error) => { summary.failed++; summary.errors.push({ baris, kode: idPel || '-', error }); };

      if (!idPel && !nama) return;
      if (!idPel) return fail('ID Pelanggan wajib diisi');
      if (!nama) return fail(`Nama pelanggan wajib diisi (${idPel})`);
      if (seenIds.has(idPel)) return fail(`ID ${idPel} muncul lebih dari sekali di file`);
      seenIds.add(idPel);
      if (!INFRA_OPTIONS.includes(infra)) return fail(`Infrastruktur "${infra}" tidak dikenal (${INFRA_OPTIONS.join('/')}) [${idPel}]`);
      if (!PAKET_OPTIONS.includes(paket)) return fail(`Paket "${paket}" tidak dikenal (${PAKET_OPTIONS.join('/')}) [${idPel}]`);
      if (!KATEGORI_OPTIONS.includes(kategori)) return fail(`Kategori "${kategori}" tidak dikenal (${KATEGORI_OPTIONS.join('/')}) [${idPel}]`);
      if (!STATUS_OPTIONS.includes(status)) return fail(`Status "${status}" tidak dikenal (${STATUS_OPTIONS.join('/')}) [${idPel}]`);
      if (!isTanggalValid(tanggal)) return fail(`Tanggal pasang "${tanggal}" tidak valid, gunakan format YYYY-MM-DD yang benar [${idPel}]`);

      const existing = db.prepare('SELECT id FROM customers WHERE LOWER(id_pelanggan) = LOWER(?)').get(idPel);
      if (existing) {
        if (mode === 'update') {
          updateCust.run(nama, infra, paket, ketPaket, kategori, status, alamat, telepon, tanggal, catatan, idPel);
          summary.updated++;
        } else {
          summary.skipped++;
        }
        return;
      }

      insertCust.run(idPel, nama, infra, paket, ketPaket, kategori, status, alamat, telepon, tanggal, catatan);
      summary.inserted++;
    });
  });

  try {
    runImport();
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ success: false, error: `Import dibatalkan: ${err.message}` });
  }
});

// Quick Stock Adjust (Masuk / Keluar)
app.post('/api/items/:id/stock-adjust', (req, res) => {
  try {
    const { id } = req.params;
    const { jenis, jumlah, keterangan, suplayer_penerima } = req.body;

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) {
      return res.status(404).json({ success: false, error: 'Barang tidak ditemukan' });
    }

    const qty = Number(jumlah);
    if (isNaN(qty) || qty <= 0) {
      return res.status(400).json({ success: false, error: 'Jumlah harus lebih besar dari 0' });
    }

    // Jenis harus jelas: sebelumnya nilai tak dikenal (mis. "xyz") diperlakukan
    // sebagai KELUAR sehingga stok bisa berkurang tanpa disadari operator.
    if (jenis !== 'MASUK' && jenis !== 'KELUAR') {
      return res.status(400).json({ success: false, error: 'Jenis penyesuaian harus MASUK atau KELUAR' });
    }

    let newStock = item.stok;
    const isMasuk = jenis === 'MASUK';

    if (isMasuk) {
      newStock += qty;
    } else {
      if (item.stok < qty) {
        return res.status(400).json({
          success: false,
          error: `Stok gudang tidak mencukupi (Tersedia: ${item.stok} ${item.satuan}, Dibutuhkan: ${qty} ${item.satuan})`
        });
      }
      newStock -= qty;
    }

    const adjustStockTx = db.transaction(() => {
      db.prepare("UPDATE items SET stok = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(newStock, id);

      const now = new Date();
      const tanggal = todayLocal();
      const waktu = now.toTimeString().split(' ')[0];
      const trxNo = generateTrxNumber(isMasuk ? 'MASUK' : 'KELUAR', tanggal);

      db.prepare(`
        INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trxNo,
        tanggal,
        waktu,
        isMasuk ? 'MASUK' : 'KELUAR',
        isMasuk ? 'Pembelian Supplier' : 'Mutasi',
        'GUDANG',
        id,
        suplayer_penerima || (isMasuk ? (item.referensi_suplayer || 'Gudang') : 'Operasional Internal'),
        item.kode_barang,
        item.nama_barang,
        item.satuan,
        qty,
        item.harga_barang,
        qty * item.harga_barang,
        keterangan || (isMasuk ? 'Penambahan stok gudang manual' : 'Pengurangan stok gudang manual')
      );
    });

    adjustStockTx();

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: `Stok berhasil diupdate. Sisa stok: ${newStock} ${item.satuan}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// 2. DIVISI PELANGGAN
// ==========================================

// Get all customers with items
app.get('/api/customers', (req, res) => {
  try {
    const customers = db.prepare('SELECT * FROM customers ORDER BY id DESC').all();
    const getItems = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?');

    const result = customers.map(cust => {
      const items = getItems.all(cust.id);
      return {
        ...cust,
        items
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single customer
app.get('/api/customers/:id', (req, res) => {
  try {
    const { id } = req.params;
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!cust) {
      return res.status(404).json({ success: false, error: 'Pelanggan tidak ditemukan' });
    }
    const items = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(id);
    res.json({ success: true, data: { ...cust, items } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create customer with installed items
app.post('/api/customers', (req, res) => {
  const transaction = db.transaction(() => {
    const {
      id_pelanggan,
      nama_pelanggan,
      infrastruktur = 'optic',
      paket = 'home',
      keterangan_paket = '',
      kategori = 'bandwidth',
      status = 'aktif',
      alamat = '',
      telepon = '',
      tanggal_pasang,
      catatan = '',
      items = []
    } = req.body;

    if (!id_pelanggan || !nama_pelanggan) {
      throw new Error('ID Pelanggan dan Nama Pelanggan wajib diisi');
    }

    const dup = db.prepare('SELECT id FROM customers WHERE LOWER(id_pelanggan) = LOWER(?)').get(id_pelanggan.trim());
    if (dup) {
      throw new Error(`ID Pelanggan "${id_pelanggan}" sudah digunakan`);
    }

    const installDate = tanggalOpsional(tanggal_pasang, 'Tanggal pasang') || todayLocal();

    // Validasi barang terpasang & pastikan stok gudang mencukupi
    const { validated: validatedItems, totalHarga } = validateInstalledItems(items, installDate);
    assertStockAvailable(sumQtyByCode(validatedItems));

    const insertCust = db.prepare(`
      INSERT INTO customers (id_pelanggan, nama_pelanggan, infrastruktur, paket, keterangan_paket, kategori, status, alamat, telepon, tanggal_pasang, total_harga, catatan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const custResult = insertCust.run(
      id_pelanggan.trim().toUpperCase(),
      nama_pelanggan.trim(),
      infrastruktur,
      paket,
      keterangan_paket.trim(),
      kategori,
      status,
      alamat.trim(),
      telepon.trim(),
      installDate,
      totalHarga,
      catatan.trim()
    );

    const custId = custResult.lastInsertRowid;

    const insertCustItem = db.prepare(`
      INSERT INTO customer_items (customer_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      UPDATE items SET stok = stok - ?, updated_at = datetime('now', 'localtime') WHERE kode_barang = ?
    `);

    const insertTrx = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, serial_number, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const waktu = now.toTimeString().split(' ')[0];

    for (const it of validatedItems) {
      insertCustItem.run(
        custId,
        it.kode_barang,
        it.nama_barang,
        it.jenis_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        it.serial_number,
        it.referensi_suplayer,
        it.tanggal_pasang
      );

      // Deduct warehouse stock
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Outgoing transaction
      const trxNo = generateTrxNumber('KELUAR', installDate);
      insertTrx.run(
        trxNo,
        installDate,
        waktu,
        'KELUAR',
        'Pemasangan Pelanggan',
        'PELANGGAN',
        custId,
        nama_pelanggan.trim(),
        it.kode_barang,
        it.nama_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        it.serial_number,
        `Instalasi perangkat pelanggan ${id_pelanggan.trim().toUpperCase()} (${paket} - ${infrastruktur})${it.serial_number ? ` [SN: ${it.serial_number}]` : ''}`
      );
    }

    return custId;
  });

  try {
    const custId = transaction();
    const newCust = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId);
    const items = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(custId);
    res.status(201).json({ success: true, data: { ...newCust, items } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update customer
app.put('/api/customers/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const {
      id_pelanggan,
      nama_pelanggan,
      infrastruktur,
      paket,
      keterangan_paket,
      kategori,
      status,
      alamat,
      telepon,
      tanggal_pasang,
      catatan,
      items
    } = req.body;

    const current = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!current) {
      throw new Error('Pelanggan tidak ditemukan');
    }

    if (id_pelanggan && id_pelanggan.toUpperCase() !== current.id_pelanggan) {
      const dup = db.prepare('SELECT id FROM customers WHERE LOWER(id_pelanggan) = LOWER(?) AND id != ?').get(id_pelanggan.trim(), id);
      if (dup) {
        throw new Error(`ID Pelanggan "${id_pelanggan}" sudah digunakan`);
      }
    }

    const tanggalPasang = tanggalOpsional(tanggal_pasang, 'Tanggal pasang') || current.tanggal_pasang;
    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(id);
      const installDate = tanggalPasang;
      const { validated, totalHarga: totalBaru } = validateInstalledItems(items, installDate);
      assertStockAvailable(sumQtyByCode(validated), sumQtyByCode(oldItems));

      totalHarga = totalBaru;
      reconcileInstalledItems({
        table: 'customer_items',
        fkColumn: 'customer_id',
        ownerId: id,
        oldItems,
        validatedItems: validated,
        divisi: 'PELANGGAN',
        refId: Number(id),
        lokasiPenerima: (nama_pelanggan ? nama_pelanggan.trim() : current.nama_pelanggan),
        label: `Edit data pelanggan ${current.id_pelanggan}`
      });
    }

    db.prepare(`
      UPDATE customers
      SET id_pelanggan = ?,
          nama_pelanggan = ?,
          infrastruktur = ?,
          paket = ?,
          keterangan_paket = ?,
          kategori = ?,
          status = ?,
          alamat = ?,
          telepon = ?,
          tanggal_pasang = ?,
          total_harga = ?,
          catatan = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      id_pelanggan ? id_pelanggan.trim().toUpperCase() : current.id_pelanggan,
      nama_pelanggan ? nama_pelanggan.trim() : current.nama_pelanggan,
      infrastruktur || current.infrastruktur,
      paket || current.paket,
      keterangan_paket !== undefined ? keterangan_paket.trim() : current.keterangan_paket,
      kategori || current.kategori,
      status || current.status,
      alamat !== undefined ? alamat.trim() : current.alamat,
      telepon !== undefined ? telepon.trim() : current.telepon,
      tanggalPasang,
      totalHarga,
      catatan !== undefined ? catatan.trim() : current.catatan,
      id
    );

    return id;
  });

  try {
    const custId = transaction();
    const updatedCust = db.prepare('SELECT * FROM customers WHERE id = ?').get(custId);
    const items = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(custId);
    res.json({ success: true, data: { ...updatedCust, items } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Dismantle customer items (e.g. customer terminated or returns items)
// Mendukung kondisi pengembalian: Baik (kembali ke stok) atau Rusak Ringan/Berat/Afkir (masuk ledger rusak)
app.post('/api/customers/:id/dismantle', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const { keterangan = 'Dismantle perangkat pelanggan putus langganan', kondisi, items: itemsKondisi } = req.body;
    const kondisiGlobal = kondisi !== undefined ? normalizeKondisi(kondisi) : 'Baik';
    // Peta kondisi per kode barang (bila frontend mengirim rincian per item)
    const kondisiPerKode = new Map();
    if (Array.isArray(itemsKondisi)) {
      for (const ic of itemsKondisi) {
        if (ic && ic.kode_barang) {
          try {
            kondisiPerKode.set(String(ic.kode_barang).toUpperCase(), normalizeKondisi(ic.kondisi || kondisiGlobal));
          } catch {}
        }
      }
    }

    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!cust) {
      throw new Error('Pelanggan tidak ditemukan');
    }

    const items = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(id);
    if (items.length === 0) {
      throw new Error('Tidak ada barang terpasang pada pelanggan ini');
    }

    const now = new Date();
    const tanggal = todayLocal();
    const waktu = now.toTimeString().split(' ')[0];

    const updateStock = db.prepare('UPDATE items SET stok = stok + ? WHERE kode_barang = ?');
    const insertTrx = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan, kondisi)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of items) {
      const kondisiItem = kondisiPerKode.get(String(it.kode_barang).toUpperCase()) || kondisiGlobal;
      const rusakItem = isKondisiRusak(kondisiItem);
      if (!rusakItem) {
        updateStock.run(it.jumlah, it.kode_barang);
      }
      const kategoriItem = rusakItem ? (kondisiItem === 'Afkir' ? 'Barang Afkir' : 'Barang Rusak') : 'Pengembalian / Dismantle';
      const trxNo = generateTrxNumber('MASUK', tanggal);
      insertTrx.run(
        trxNo,
        tanggal,
        waktu,
        'MASUK',
        kategoriItem,
        'PELANGGAN',
        id,
        `${cust.nama_pelanggan} (${cust.id_pelanggan})`,
        it.kode_barang,
        it.nama_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        `${keterangan} - ${rusakItem ? `Barang ${kondisiItem.toLowerCase()} masuk gudang rusak` : 'Barang ditarik kembali ke gudang'}`,
        kondisiItem
      );
      if (rusakItem) {
        buatDamagedEntry({
          kode_barang: it.kode_barang, nama_barang: it.nama_barang, jenis_barang: it.jenis_barang,
          satuan: it.satuan, harga_barang: it.harga_barang, jumlah: it.jumlah, kondisi: kondisiItem,
          sumber: 'Dismantle Pelanggan', sumber_id: Number(id), sumber_nama: `${cust.nama_pelanggan} (${cust.id_pelanggan})`,
          no_transaksi: trxNo, keterangan, tanggal, dibuat_oleh: req.user?.nama_lengkap || req.user?.username || ''
        });
      }
    }

    // Remove installed items from customer
    db.prepare('DELETE FROM customer_items WHERE customer_id = ?').run(id);

    // Update customer status to putus and total_harga to 0
    db.prepare("UPDATE customers SET status = 'putus', total_harga = 0, updated_at = datetime('now', 'localtime') WHERE id = ?").run(id);

    return items.length;
  });

  try {
    const count = transaction();
    res.json({ success: true, message: `Berhasil mendismantle ${count} item barang dari pelanggan. Stok telah dikembalikan ke gudang.` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete customer
app.delete('/api/customers/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!cust) throw new Error('Pelanggan tidak ditemukan');

    // Stok barang yang masih terpasang dikembalikan agar tidak hilang
    const jumlahItem = restoreInstalledStock({
      table: 'customer_items', fkColumn: 'customer_id', ownerId: id,
      divisi: 'PELANGGAN', refId: Number(id),
      lokasi: `${cust.nama_pelanggan} (${cust.id_pelanggan})`,
      label: `Hapus data pelanggan ${cust.id_pelanggan}`
    });

    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    return { nama: cust.nama_pelanggan, jumlahItem };
  });

  try {
    const hasil = transaction();
    res.json({
      success: true,
      message: `Pelanggan ${hasil.nama} berhasil dihapus` +
        (hasil.jumlahItem > 0 ? ` (${hasil.jumlahItem} barang terpasang dikembalikan ke stok gudang)` : '')
    });
  } catch (err) {
    res.status(err.message.includes('tidak ditemukan') ? 404 : 400).json({ success: false, error: err.message });
  }
});


// ==========================================
// 3. DIVISI FO (FIBER OPTIC)
// ==========================================

// Get all FO sites with items
app.get('/api/fo', (req, res) => {
  try {
    const sites = db.prepare('SELECT * FROM fo_sites ORDER BY id DESC').all();
    const getItems = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?');

    const result = sites.map(site => {
      const items = getItems.all(site.id);
      return {
        ...site,
        items
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single FO site
app.get('/api/fo/:id', (req, res) => {
  try {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM fo_sites WHERE id = ?').get(id);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Titik FO tidak ditemukan' });
    }
    const items = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?').all(id);
    res.json({ success: true, data: { ...site, items } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create FO site with installed items
app.post('/api/fo', (req, res) => {
  const transaction = db.transaction(() => {
    const {
      daerah_lokasi,
      tipe_lokasi = 'ODP',
      pic_teknisi = '',
      tanggal_pasang,
      catatan = '',
      items = []
    } = req.body;

    if (!daerah_lokasi) {
      throw new Error('Daerah / Lokasi FO wajib diisi');
    }

    const installDate = tanggalOpsional(tanggal_pasang, 'Tanggal pasang') || todayLocal();

    // Validasi barang terpasang & pastikan stok gudang mencukupi
    const { validated: validatedItems, totalHarga } = validateInstalledItems(items, installDate);
    assertStockAvailable(sumQtyByCode(validatedItems));

    const insertFO = db.prepare(`
      INSERT INTO fo_sites (daerah_lokasi, tipe_lokasi, pic_teknisi, tanggal_pasang, total_harga, catatan)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const foResult = insertFO.run(
      daerah_lokasi.trim(),
      tipe_lokasi,
      pic_teknisi.trim(),
      installDate,
      totalHarga,
      catatan.trim()
    );

    const foId = foResult.lastInsertRowid;

    const insertFOItem = db.prepare(`
      INSERT INTO fo_items (fo_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      UPDATE items SET stok = stok - ?, updated_at = datetime('now', 'localtime') WHERE kode_barang = ?
    `);

    const insertTrx = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const waktu = now.toTimeString().split(' ')[0];

    for (const it of validatedItems) {
      insertFOItem.run(
        foId,
        it.kode_barang,
        it.nama_barang,
        it.jenis_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        it.serial_number,
        it.referensi_suplayer,
        it.tanggal_pasang
      );

      // Deduct warehouse stock
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Outgoing transaction
      const trxNo = generateTrxNumber('KELUAR', installDate);
      insertTrx.run(
        trxNo,
        installDate,
        waktu,
        'KELUAR',
        'Pemasangan Divisi FO',
        'DIVISI FO',
        foId,
        daerah_lokasi.trim(),
        it.kode_barang,
        it.nama_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        `Instalasi perangkat infrastruktur FO di ${daerah_lokasi.trim()} (Tipe: ${tipe_lokasi}, PIC: ${pic_teknisi || '-'})`
      );
    }

    return foId;
  });

  try {
    const foId = transaction();
    const newSite = db.prepare('SELECT * FROM fo_sites WHERE id = ?').get(foId);
    const items = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?').all(foId);
    res.status(201).json({ success: true, data: { ...newSite, items } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update FO site
app.put('/api/fo/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const {
      daerah_lokasi,
      tipe_lokasi,
      pic_teknisi,
      tanggal_pasang,
      catatan,
      items
    } = req.body;

    const current = db.prepare('SELECT * FROM fo_sites WHERE id = ?').get(id);
    if (!current) {
      throw new Error('Titik FO tidak ditemukan');
    }

    const tanggalPasang = tanggalOpsional(tanggal_pasang, 'Tanggal pasang') || current.tanggal_pasang;
    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?').all(id);
      const installDate = tanggalPasang;
      const { validated, totalHarga: totalBaru } = validateInstalledItems(items, installDate);
      assertStockAvailable(sumQtyByCode(validated), sumQtyByCode(oldItems));

      totalHarga = totalBaru;
      reconcileInstalledItems({
        table: 'fo_items',
        fkColumn: 'fo_id',
        ownerId: id,
        oldItems,
        validatedItems: validated,
        divisi: 'DIVISI FO',
        refId: Number(id),
        lokasiPenerima: (daerah_lokasi ? daerah_lokasi.trim() : current.daerah_lokasi),
        label: `Edit titik FO ${current.daerah_lokasi}`
      });
    }

    db.prepare(`
      UPDATE fo_sites
      SET daerah_lokasi = ?,
          tipe_lokasi = ?,
          pic_teknisi = ?,
          tanggal_pasang = ?,
          total_harga = ?,
          catatan = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      daerah_lokasi ? daerah_lokasi.trim() : current.daerah_lokasi,
      tipe_lokasi || current.tipe_lokasi,
      pic_teknisi !== undefined ? pic_teknisi.trim() : current.pic_teknisi,
      tanggalPasang,
      totalHarga,
      catatan !== undefined ? catatan.trim() : current.catatan,
      id
    );

    return id;
  });

  try {
    const foId = transaction();
    const updated = db.prepare('SELECT * FROM fo_sites WHERE id = ?').get(foId);
    const items = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?').all(foId);
    res.json({ success: true, data: { ...updated, items } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete FO site
app.delete('/api/fo/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM fo_sites WHERE id = ?').get(id);
    if (!site) throw new Error('Titik FO tidak ditemukan');

    const jumlahItem = restoreInstalledStock({
      table: 'fo_items', fkColumn: 'fo_id', ownerId: id,
      divisi: 'DIVISI FO', refId: Number(id), lokasi: site.daerah_lokasi,
      label: `Hapus titik FO ${site.daerah_lokasi}`
    });

    db.prepare('DELETE FROM fo_sites WHERE id = ?').run(id);
    return { nama: site.daerah_lokasi, jumlahItem };
  });

  try {
    const hasil = transaction();
    res.json({
      success: true,
      message: `Titik FO ${hasil.nama} berhasil dihapus` +
        (hasil.jumlahItem > 0 ? ` (${hasil.jumlahItem} barang terpasang dikembalikan ke stok gudang)` : '')
    });
  } catch (err) {
    res.status(err.message.includes('tidak ditemukan') ? 404 : 400).json({ success: false, error: err.message });
  }
});


// ==========================================
// 4. DIVISI TOWER
// ==========================================

// Get all Tower sites with items
app.get('/api/tower', (req, res) => {
  try {
    const sites = db.prepare('SELECT * FROM tower_sites ORDER BY id DESC').all();
    const getItems = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?');

    const result = sites.map(site => {
      const items = getItems.all(site.id);
      return {
        ...site,
        items
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get single Tower site
app.get('/api/tower/:id', (req, res) => {
  try {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM tower_sites WHERE id = ?').get(id);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Site Tower tidak ditemukan' });
    }
    const items = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?').all(id);
    res.json({ success: true, data: { ...site, items } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create Tower site with installed items
app.post('/api/tower', (req, res) => {
  const transaction = db.transaction(() => {
    const {
      daerah_lokasi,
      jenis = 'tower', // tower | monopol
      type = 'triangle', // monopol | triangle | square
      ketinggian = '30 meter',
      kepemilikan = 'Milik Sendiri',
      pic_teknisi = '',
      tanggal_pasang,
      catatan = '',
      items = []
    } = req.body;

    if (!daerah_lokasi) {
      throw new Error('Daerah / Lokasi Tower wajib diisi');
    }

    const installDate = tanggalOpsional(tanggal_pasang, 'Tanggal pasang') || todayLocal();

    // Validasi barang terpasang & pastikan stok gudang mencukupi
    const { validated: validatedItems, totalHarga } = validateInstalledItems(items, installDate);
    assertStockAvailable(sumQtyByCode(validatedItems));

    const insertTower = db.prepare(`
      INSERT INTO tower_sites (daerah_lokasi, jenis, type, ketinggian, kepemilikan, pic_teknisi, tanggal_pasang, total_harga, catatan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const towerResult = insertTower.run(
      daerah_lokasi.trim(),
      jenis,
      type,
      ketinggian.trim(),
      kepemilikan.trim(),
      pic_teknisi.trim(),
      installDate,
      totalHarga,
      catatan.trim()
    );

    const towerId = towerResult.lastInsertRowid;

    const insertTowerItem = db.prepare(`
      INSERT INTO tower_items (tower_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      UPDATE items SET stok = stok - ?, updated_at = datetime('now', 'localtime') WHERE kode_barang = ?
    `);

    const insertTrx = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = new Date();
    const waktu = now.toTimeString().split(' ')[0];

    for (const it of validatedItems) {
      insertTowerItem.run(
        towerId,
        it.kode_barang,
        it.nama_barang,
        it.jenis_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        it.serial_number,
        it.referensi_suplayer,
        it.tanggal_pasang
      );

      // Deduct warehouse stock
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Outgoing transaction
      const trxNo = generateTrxNumber('KELUAR', installDate);
      insertTrx.run(
        trxNo,
        installDate,
        waktu,
        'KELUAR',
        'Pemasangan Divisi Tower',
        'DIVISI TOWER',
        towerId,
        daerah_lokasi.trim(),
        it.kode_barang,
        it.nama_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        `Instalasi site tower di ${daerah_lokasi.trim()} (${jenis} - ${type}, ${ketinggian}, PIC: ${pic_teknisi || '-'})`
      );
    }

    return towerId;
  });

  try {
    const towerId = transaction();
    const newSite = db.prepare('SELECT * FROM tower_sites WHERE id = ?').get(towerId);
    const items = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?').all(towerId);
    res.status(201).json({ success: true, data: { ...newSite, items } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update Tower site
app.put('/api/tower/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const {
      daerah_lokasi,
      jenis,
      type,
      ketinggian,
      kepemilikan,
      pic_teknisi,
      tanggal_pasang,
      catatan,
      items
    } = req.body;

    const current = db.prepare('SELECT * FROM tower_sites WHERE id = ?').get(id);
    if (!current) {
      throw new Error('Site Tower tidak ditemukan');
    }

    const tanggalPasang = tanggalOpsional(tanggal_pasang, 'Tanggal pasang') || current.tanggal_pasang;
    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?').all(id);
      const installDate = tanggalPasang;
      const { validated, totalHarga: totalBaru } = validateInstalledItems(items, installDate);
      assertStockAvailable(sumQtyByCode(validated), sumQtyByCode(oldItems));

      totalHarga = totalBaru;
      reconcileInstalledItems({
        table: 'tower_items',
        fkColumn: 'tower_id',
        ownerId: id,
        oldItems,
        validatedItems: validated,
        divisi: 'DIVISI TOWER',
        refId: Number(id),
        lokasiPenerima: (daerah_lokasi ? daerah_lokasi.trim() : current.daerah_lokasi),
        label: `Edit site tower ${current.daerah_lokasi}`
      });
    }

    db.prepare(`
      UPDATE tower_sites
      SET daerah_lokasi = ?,
          jenis = ?,
          type = ?,
          ketinggian = ?,
          kepemilikan = ?,
          pic_teknisi = ?,
          tanggal_pasang = ?,
          total_harga = ?,
          catatan = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      daerah_lokasi ? daerah_lokasi.trim() : current.daerah_lokasi,
      jenis || current.jenis,
      type || current.type,
      ketinggian ? ketinggian.trim() : current.ketinggian,
      kepemilikan ? kepemilikan.trim() : current.kepemilikan,
      pic_teknisi !== undefined ? pic_teknisi.trim() : current.pic_teknisi,
      tanggalPasang,
      totalHarga,
      catatan !== undefined ? catatan.trim() : current.catatan,
      id
    );

    return id;
  });

  try {
    const towerId = transaction();
    const updated = db.prepare('SELECT * FROM tower_sites WHERE id = ?').get(towerId);
    const items = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?').all(towerId);
    res.json({ success: true, data: { ...updated, items } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete Tower site
app.delete('/api/tower/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM tower_sites WHERE id = ?').get(id);
    if (!site) throw new Error('Site Tower tidak ditemukan');

    const jumlahItem = restoreInstalledStock({
      table: 'tower_items', fkColumn: 'tower_id', ownerId: id,
      divisi: 'DIVISI TOWER', refId: Number(id), lokasi: site.daerah_lokasi,
      label: `Hapus site tower ${site.daerah_lokasi}`
    });

    db.prepare('DELETE FROM tower_sites WHERE id = ?').run(id);
    return { nama: site.daerah_lokasi, jumlahItem };
  });

  try {
    const hasil = transaction();
    res.json({
      success: true,
      message: `Site Tower ${hasil.nama} berhasil dihapus` +
        (hasil.jumlahItem > 0 ? ` (${hasil.jumlahItem} barang terpasang dikembalikan ke stok gudang)` : '')
    });
  } catch (err) {
    res.status(err.message.includes('tidak ditemukan') ? 404 : 400).json({ success: false, error: err.message });
  }
});


// ==========================================
// 5. TRANSAKSI KELUAR MASUK BARANG (TRANSACTIONS)
// ==========================================

// Batas aman jumlah baris rincian yang dikirim sekaligus oleh GET /api/transactions
// agar respons JSON dan render tabel browser tetap ringan saat mutasi tumbuh puluhan
// ribu baris selama bertahun-tahun. Angka ringkasan (summary) tetap dihitung utuh di
// SQL atas seluruh baris yang cocok dengan filter (tanpa terpotong LIMIT).
const MAX_TRANSACTION_ROWS = 5000;

// Daftar kategori transaksi yang pernah dipakai (untuk dropdown filter)
app.get('/api/transactions/categories', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT kategori_transaksi AS kategori, COUNT(*) AS jumlah
      FROM transactions
      WHERE kategori_transaksi IS NOT NULL AND kategori_transaksi != ''
      GROUP BY kategori_transaksi
      ORDER BY kategori_transaksi ASC
    `).all();
    const list = rows.map((r) => r.kategori);
    res.json({ success: true, data: list, detail: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// Alias untuk kompatibilitas penamaan
app.get('/api/transaction-categories', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT kategori_transaksi AS kategori, COUNT(*) AS jumlah
      FROM transactions
      WHERE kategori_transaksi IS NOT NULL AND kategori_transaksi != ''
      GROUP BY kategori_transaksi
      ORDER BY kategori_transaksi ASC
    `).all();
    const list = rows.map((r) => r.kategori);
    res.json({ success: true, data: list, detail: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// Get transactions with rich filtering
app.get('/api/transactions', (req, res) => {
  try {
    const {
      start_date,
      end_date,
      year,
      month,
      week,
      divisi,
      jenis,
      kategori_transaksi,
      kategori,
      search,
      limit
    } = req.query;

    let whereSql = ' WHERE 1=1';
    const params = [];

    // Date range
    if (start_date && end_date) {
      whereSql += ' AND tanggal >= ? AND tanggal <= ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      whereSql += ' AND tanggal >= ?';
      params.push(start_date);
    } else if (end_date) {
      whereSql += ' AND tanggal <= ?';
      params.push(end_date);
    }

    // Specific Year filter
    if (year) {
      whereSql += " AND strftime('%Y', tanggal) = ?";
      params.push(String(year));
    }

    // Specific Month filter (1-12)
    if (month && year) {
      const formattedMonth = String(month).padStart(2, '0');
      whereSql += " AND strftime('%Y-%m', tanggal) = ?";
      params.push(`${year}-${formattedMonth}`);
    }

    // Week of month filter (1-5)
    if (week && year && month) {
      // Minggu 1: hari 1-7, Minggu 2: 8-14, Minggu 3: 15-21, Minggu 4: 22-28, Minggu 5: 29-31
      const w = parseInt(week, 10);
      let dayStart = 1;
      let dayEnd = 31;
      if (w === 1) { dayStart = 1; dayEnd = 7; }
      else if (w === 2) { dayStart = 8; dayEnd = 14; }
      else if (w === 3) { dayStart = 15; dayEnd = 21; }
      else if (w === 4) { dayStart = 22; dayEnd = 28; }
      else if (w === 5) { dayStart = 29; dayEnd = 31; }

      const formattedMonth = String(month).padStart(2, '0');
      const sDate = `${year}-${formattedMonth}-${String(dayStart).padStart(2, '0')}`;
      const eDate = `${year}-${formattedMonth}-${String(dayEnd).padStart(2, '0')}`;

      whereSql += ' AND tanggal >= ? AND tanggal <= ?';
      params.push(sDate, eDate);
    }

    // Divisi filter
    if (divisi && divisi !== 'SEMUA') {
      whereSql += ' AND UPPER(divisi) = UPPER(?)';
      params.push(divisi);
    }

    // Jenis filter (MASUK / KELUAR)
    if (jenis && (jenis === 'MASUK' || jenis === 'KELUAR')) {
      whereSql += ' AND jenis = ?';
      params.push(jenis);
    }

    // Kategori transaksi filter (eksak, tidak peka huruf besar/kecil)
    const kategoriFilter = kategori_transaksi || kategori;
    if (kategoriFilter && String(kategoriFilter).trim() !== '' && String(kategoriFilter).toUpperCase() !== 'SEMUA') {
      whereSql += ' AND kategori_transaksi = ?';
      params.push(String(kategoriFilter).trim());
    }

    // Keyword search (ikut mencocokkan kategori & kondisi agar ?search=Rusak ketemu)
    if (search) {
      whereSql += ' AND (kode_barang LIKE ? OR nama_barang LIKE ? OR no_transaksi LIKE ? OR lokasi_penerima LIKE ? OR keterangan LIKE ? OR kategori_transaksi LIKE ? OR kondisi LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s, s);
    }

    // Ringkasan dihitung utuh di SQL atas seluruh baris yang cocok dengan filter
    // (tidak ikut terpotong oleh LIMIT rincian baris).
    const agg = db.prepare(`
      SELECT
        COUNT(*) AS total_transaksi,
        COALESCE(SUM(CASE WHEN jenis = 'MASUK' THEN jumlah ELSE 0 END), 0) AS total_masuk_qty,
        COALESCE(SUM(CASE WHEN jenis = 'MASUK' THEN total_harga ELSE 0 END), 0) AS total_masuk_nilai,
        COALESCE(SUM(CASE WHEN jenis = 'KELUAR' THEN jumlah ELSE 0 END), 0) AS total_keluar_qty,
        COALESCE(SUM(CASE WHEN jenis = 'KELUAR' THEN total_harga ELSE 0 END), 0) AS total_keluar_nilai
      FROM transactions
      ${whereSql}
    `).get(...params);

    // Rekap per kategori dihitung UTUH di SQL (tidak terpotong LIMIT) — penting
    // saat data >5.000 baris, rekap harus tetap akurat.
    const perKategoriRows = db.prepare(`
      SELECT
        kategori_transaksi,
        COUNT(*) AS jumlah_transaksi,
        COALESCE(SUM(jumlah), 0) AS total_qty,
        COALESCE(SUM(total_harga), 0) AS total_nilai,
        COALESCE(SUM(CASE WHEN jenis='MASUK' THEN jumlah ELSE 0 END),0) AS masuk_qty,
        COALESCE(SUM(CASE WHEN jenis='KELUAR' THEN jumlah ELSE 0 END),0) AS keluar_qty,
        COALESCE(SUM(CASE WHEN jenis='MASUK' THEN total_harga ELSE 0 END),0) AS masuk_nilai,
        COALESCE(SUM(CASE WHEN jenis='KELUAR' THEN total_harga ELSE 0 END),0) AS keluar_nilai
      FROM transactions
      ${whereSql}
      GROUP BY kategori_transaksi
      ORDER BY kategori_transaksi ASC
    `).all(...params);
    const perKategori = perKategoriRows.map((r) => ({
      kategori_transaksi: r.kategori_transaksi,
      kategori: r.kategori_transaksi,
      jumlah_transaksi: Number(r.jumlah_transaksi) || 0,
      total_qty: Number(r.total_qty) || 0,
      total_nilai: Number(r.total_nilai) || 0,
      masuk_qty: Number(r.masuk_qty) || 0,
      keluar_qty: Number(r.keluar_qty) || 0,
      masuk_nilai: Number(r.masuk_nilai) || 0,
      keluar_nilai: Number(r.keluar_nilai) || 0
    }));

    const parsedLimit = parseInt(limit, 10);
    const rowLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_TRANSACTION_ROWS)
      : MAX_TRANSACTION_ROWS;

    const txs = db.prepare(
      `SELECT * FROM transactions${whereSql} ORDER BY tanggal DESC, id DESC LIMIT ?`
    ).all(...params, rowLimit);

    const totalTransaksi = Number(agg?.total_transaksi) || 0;
    const totalMasukQty = Number(agg?.total_masuk_qty) || 0;
    const totalMasukNilai = Number(agg?.total_masuk_nilai) || 0;
    const totalKeluarQty = Number(agg?.total_keluar_qty) || 0;
    const totalKeluarNilai = Number(agg?.total_keluar_nilai) || 0;
    const terpotong = totalTransaksi > txs.length;

    res.json({
      success: true,
      data: txs,
      summary: {
        total_transaksi: totalTransaksi,
        ditampilkan: txs.length,
        displayed: txs.length,
        limit: rowLimit,
        terpotong,
        truncated: terpotong,
        total_masuk_qty: totalMasukQty,
        total_masuk_nilai: totalMasukNilai,
        total_keluar_qty: totalKeluarQty,
        total_keluar_nilai: totalKeluarNilai,
        net_qty: totalMasukQty - totalKeluarQty,
        net_nilai: totalMasukNilai - totalKeluarNilai,
        per_kategori: perKategori
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Manual transaction creation (Direct Stock In / Out)
// Konfigurasi divisi yang bisa ditautkan langsung dari transaksi
// (mis. scan barcode stiker di gudang → pilih pelanggan/site → barang langsung
// tercatat terpasang di data tsb, stok gudang berkurang, riwayat tersimpan).
// Nama tabel/kolom HARDCODE (whitelist) — aman dari injeksi SQL.
const LINKED_DIVISI = {
  'PELANGGAN':    { siteTable: 'customers',   itemsTable: 'customer_items', fk: 'customer_id', nameCol: 'nama_pelanggan', label: 'Pelanggan' },
  'DIVISI FO':    { siteTable: 'fo_sites',    itemsTable: 'fo_items',       fk: 'fo_id',       nameCol: 'daerah_lokasi', label: 'Divisi FO' },
  'DIVISI TOWER': { siteTable: 'tower_sites', itemsTable: 'tower_items',    fk: 'tower_id',    nameCol: 'daerah_lokasi', label: 'Divisi Tower' }
};

app.post('/api/transactions', (req, res) => {
  const transaction = db.transaction(() => {
    const {
      jenis, // MASUK | KELUAR
      kategori_transaksi,
      divisi = 'GUDANG',
      lokasi_penerima,
      kode_barang,
      jumlah,
      tanggal,
      keterangan = '',
      tujuan_id,          // opsional: id pelanggan / site FO / site tower (mode tertaut)
      serial_number = '',  // opsional: SN unit (pelacakan di tujuan)
      kondisi               // opsional: Baik | Rusak Ringan | Rusak Berat | Afkir
    } = req.body;

    if (!jenis || !kode_barang || !jumlah) {
      throw new Error('Jenis transaksi, kode barang, dan jumlah wajib diisi');
    }

    // Validasi ketat: nilai tak dikenal tidak boleh lolos menjadi data rusak
    // (dulu jenis "XYZ" tersimpan 201 tanpa dihitung MASUK/KELUAR oleh ringkasan,
    // jumlah "abc" menabrak constraint SQL dengan pesan mentah, dan tanggal
    // sembarang merusak rekap per tahun/bulan).
    const jenisBersih = String(jenis).trim().toUpperCase();
    if (jenisBersih !== 'MASUK' && jenisBersih !== 'KELUAR') {
      throw new Error('Jenis transaksi harus MASUK atau KELUAR');
    }
    const qty = Number(jumlah);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Jumlah harus berupa angka lebih dari 0');
    }
    const tanggalValid = tanggal === undefined || tanggal === null || String(tanggal).trim() === ''
      ? null
      : tanggalOpsional(String(tanggal).trim(), 'Tanggal transaksi');

    const item = getMasterItem(kode_barang);
    if (!item) {
      throw new Error(`Barang dengan kode "${kode_barang}" tidak ditemukan`);
    }

    // Divisi dibatasi ke daftar resmi agar rekap per divisi tidak terpecah
    // oleh nilai ketik-salah (mis. "PELANGGAN " atau "pelanggan").
    const DIVISI_SAH = ['GUDANG', 'PELANGGAN', 'DIVISI FO', 'DIVISI TOWER'];
    const divisiBersih = String(divisi ?? 'GUDANG').trim().toUpperCase() || 'GUDANG';
    if (!DIVISI_SAH.includes(divisiBersih)) {
      throw new Error(`Divisi harus salah satu dari: ${DIVISI_SAH.join(', ')}`);
    }
    const keteranganBersih = teksBody(keterangan, 'Keterangan');
    const kategoriBersih = teksBody(kategori_transaksi, 'Kategori transaksi');
    const lokasiBersih = teksBody(lokasi_penerima, 'Lokasi / penerima / suplayer');
    const kondisiBersih = kondisi !== undefined ? normalizeKondisi(kondisi) : 'Baik';

    const now = new Date();
    const tgl = tanggalValid || todayLocal();
    const waktu = now.toTimeString().split(' ')[0];
    const isMasuk = jenisBersih === 'MASUK';
    const sn = teksBody(serial_number, 'Serial number').slice(0, 100);

    const linkCfg = LINKED_DIVISI[divisiBersih] || null;
    const isLinked = !!linkCfg && !!tujuan_id;

    const insertTrxFull = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, serial_number, keterangan, kondisi)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // ============================================================
    // MODE TERTAUT: barang langsung tercatat terpasang / dikembalikan
    // pada data pelanggan / site FO / site tower yang dipilih.
    // ============================================================
    if (isLinked) {
      const owner = db.prepare(`SELECT * FROM ${linkCfg.siteTable} WHERE id = ?`).get(Number(tujuan_id));
      if (!owner) {
        throw new Error(`Data tujuan ${linkCfg.label} tidak ditemukan`);
      }
      const ownerName = owner[linkCfg.nameCol];

      if (isMasuk) {
        // --- PENGEMBALIAN: kurangi barang terpasang (baris terbaru dulu), stok gudang bertambah ---
        const rows = db.prepare(
          `SELECT * FROM ${linkCfg.itemsTable} WHERE ${linkCfg.fk} = ? AND kode_barang = ? ORDER BY id DESC`
        ).all(owner.id, item.kode_barang);
        const terpasang = rows.reduce((a, r) => a + Number(r.jumlah), 0);
        if (terpasang < qty) {
          throw new Error(`Barang terpasang di ${ownerName} hanya ${terpasang} ${item.satuan}; tidak bisa dikembalikan sebanyak ${qty}`);
        }

        let sisa = qty;
        for (const row of rows) {
          if (sisa <= 0) break;
          const potong = Math.min(Number(row.jumlah), sisa);
          const jumlahBaru = Number(row.jumlah) - potong;
          if (jumlahBaru <= 0) {
            db.prepare(`DELETE FROM ${linkCfg.itemsTable} WHERE id = ?`).run(row.id);
          } else {
            db.prepare(`UPDATE ${linkCfg.itemsTable} SET jumlah = ?, subtotal = ? WHERE id = ?`)
              .run(jumlahBaru, jumlahBaru * Number(row.harga_barang), row.id);
          }
          sisa -= potong;
        }

        const rusak = isKondisiRusak(kondisiBersih);
        if (!rusak) {
          db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);
        }

        const kategoriPengembalian = kategoriBersih || (rusak ? (kondisiBersih === 'Afkir' ? 'Barang Afkir' : 'Barang Rusak') : `Pengembalian ${linkCfg.label}`);
        const trxNo = generateTrxNumber('MASUK', tgl);
        insertTrxFull.run(
          trxNo, tgl, waktu, 'MASUK',
          kategoriPengembalian,
          divisiBersih, owner.id, ownerName,
          item.kode_barang, item.nama_barang, item.satuan, qty,
          item.harga_barang, qty * item.harga_barang, sn,
          keteranganBersih || `Pengembalian dari ${linkCfg.label.toLowerCase()} ${ownerName}${rusak ? ` — ${kondisiBersih}` : ''}`,
          kondisiBersih
        );
        if (rusak) {
          buatDamagedEntry({
            kode_barang: item.kode_barang, nama_barang: item.nama_barang, jenis_barang: item.jenis_barang,
            satuan: item.satuan, harga_barang: item.harga_barang, jumlah: qty, kondisi: kondisiBersih,
            sumber: `Pengembalian ${linkCfg.label}`, sumber_id: owner.id, sumber_nama: ownerName,
            no_transaksi: trxNo, keterangan: keteranganBersih, tanggal: tgl, dibuat_oleh: req.user?.nama_lengkap || req.user?.username || ''
          });
        }
        var hasilTrx = { trxNo, item, qty, isMasuk, terhubung: `${linkCfg.label} — ${ownerName}`, kondisi: kondisiBersih };
      } else {
        // --- PEMASANGAN: stok gudang berkurang, tercatat terpasang di tujuan ---
        if (item.stok < qty) {
          throw new Error(`Stok gudang tidak cukup. Sisa: ${item.stok} ${item.satuan}, diminta: ${qty}`);
        }

        const existing = db.prepare(
          `SELECT * FROM ${linkCfg.itemsTable} WHERE ${linkCfg.fk} = ? AND kode_barang = ? AND COALESCE(serial_number, '') = ?`
        ).get(owner.id, item.kode_barang, sn);

        if (existing) {
          const jumlahBaru = Number(existing.jumlah) + qty;
          db.prepare(`UPDATE ${linkCfg.itemsTable} SET jumlah = ?, subtotal = ? WHERE id = ?`)
            .run(jumlahBaru, jumlahBaru * Number(existing.harga_barang), existing.id);
        } else {
          db.prepare(`
            INSERT INTO ${linkCfg.itemsTable} (${linkCfg.fk}, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            owner.id, item.kode_barang, item.nama_barang, item.jenis_barang, item.satuan,
            qty, item.harga_barang, qty * item.harga_barang, sn, item.referensi_suplayer || '', tgl
          );
        }

        db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);

        const trxNo = generateTrxNumber('KELUAR', tgl);
        insertTrxFull.run(
          trxNo, tgl, waktu, 'KELUAR',
          kategoriBersih || `Pemasangan ${linkCfg.label}`,
          divisiBersih, owner.id, ownerName,
          item.kode_barang, item.nama_barang, item.satuan, qty,
          item.harga_barang, qty * item.harga_barang, sn,
          keteranganBersih || `Pemasangan di ${linkCfg.label.toLowerCase()} ${ownerName}`,
          kondisiBersih
        );
        var hasilTrx = { trxNo, item, qty, isMasuk, terhubung: `${linkCfg.label} — ${ownerName}`, kondisi: kondisiBersih };
      }

      // Sinkronkan total nilai aset pada data induk (selalu = jumlah subtotal barang terpasang)
      db.prepare(`
        UPDATE ${linkCfg.siteTable}
        SET total_harga = (SELECT COALESCE(SUM(subtotal), 0) FROM ${linkCfg.itemsTable} WHERE ${linkCfg.fk} = ?),
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(owner.id, owner.id);

      return hasilTrx;
    }

    // ============================================================
    // MODE MANUAL GUDANG (perilaku lama — tidak berubah)
    // ============================================================
    if (!lokasiBersih) {
      throw new Error('Lokasi / penerima / suplayer wajib diisi');
    }

    if (!isMasuk && item.stok < qty) {
      throw new Error(`Stok gudang tidak cukup. Sisa: ${item.stok} ${item.satuan}, diminta: ${qty}`);
    }

    const rusakManual = isMasuk && isKondisiRusak(kondisiBersih);
    if (rusakManual) {
      // kategori default untuk barang rusak
      if (!kategoriBersih) {
        // keep as Barang Rusak category
      }
    }
    // Update stock — barang rusak MASUK tidak menambah stok siap pakai
    if (isMasuk) {
      if (!isKondisiRusak(kondisiBersih)) {
        db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);
      }
    } else {
      db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);
    }

    const subtotal = qty * item.harga_barang;
    const trxNo = generateTrxNumber(isMasuk ? 'MASUK' : 'KELUAR', tgl);
    const kategoriManual = kategoriBersih || (isMasuk && isKondisiRusak(kondisiBersih) ? (kondisiBersih === 'Afkir' ? 'Barang Afkir' : 'Barang Rusak') : (isMasuk ? 'Pembelian Supplier' : 'Mutasi'));

    insertTrxFull.run(
      trxNo,
      tgl,
      waktu,
      isMasuk ? 'MASUK' : 'KELUAR',
      kategoriManual,
      divisiBersih,
      item.id,
      lokasiBersih,
      item.kode_barang,
      item.nama_barang,
      item.satuan,
      qty,
      item.harga_barang,
      subtotal,
      sn,
      keteranganBersih,
      kondisiBersih
    );
    if (isMasuk && isKondisiRusak(kondisiBersih)) {
      buatDamagedEntry({
        kode_barang: item.kode_barang, nama_barang: item.nama_barang, jenis_barang: item.jenis_barang,
        satuan: item.satuan, harga_barang: item.harga_barang, jumlah: qty, kondisi: kondisiBersih,
        sumber: divisiBersih, sumber_id: item.id, sumber_nama: lokasiBersih,
        no_transaksi: trxNo, keterangan: keteranganBersih, tanggal: tgl, dibuat_oleh: req.user?.nama_lengkap || req.user?.username || ''
      });
    }

    return { trxNo, item, qty, isMasuk };
  });

  try {
    const result = transaction();
    const pesan = result.terhubung
      ? `Transaksi ${result.trxNo} tersimpan & terhubung ke ${result.terhubung}`
      : `Transaksi ${result.trxNo} berhasil disimpan`;
    res.status(201).json({ success: true, data: result, message: pesan });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


// ==========================================
// 5B. BON / BARANG BAWAAN TEKNISI (STOK TRANSIT LAPANGAN)
// ==========================================
// Alur 3 tahap:
//  1. BAWA   — teknisi membawa barang dari gudang: stok gudang BERKURANG (mutasi KELUAR,
//              divisi 'TEKNISI') dan masuk ke "stok dibawa teknisi" (sisa bon).
//  2. PASANG — realisasi dari bon ke Pelanggan / Divisi FO / Divisi Tower beserta SN, lokasi
//              tujuan, dan teknisi pemasang. Stok gudang TIDAK berubah (barang sudah keluar
//              pada tahap 1) — yang berubah hanya sisa bon & barang terpasang di divisi.
//  3. KEMBALI — sisa yang tidak terpakai dikembalikan ke gudang: stok BERTAMBAH (mutasi MASUK).
// Invarian stok tetap terjaga: stok = snapshot + Σ(transactions), karena hanya tahap 1 & 3
// yang menyentuh stok gudang, dan keduanya selalu tercatat di tabel transactions.
// Rincian per bon (termasuk tahap 2) ada di technician_loan_movements.

const TEKNISI_DIVISI = 'TEKNISI';
const LOAN_OPEN_STATUSES = ['AKTIF', 'SEBAGIAN'];
const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const isDateStr = (v) => typeof v === 'string' && isTanggalValid(v.trim());
const loanItemSisa = (li) => round3(Number(li.jumlah_dibawa) - Number(li.jumlah_terpasang) - Number(li.jumlah_kembali));

/** No. Bon berurutan per bulan: BON-YYYYMM-NNNN (dijamin unik). */
function generateBonNumber(tanggal) {
  const ym = (isDateStr(tanggal) ? tanggal : todayLocal()).slice(0, 7).replace('-', '');
  const prefix = `BON-${ym}-`;
  const last = db.prepare('SELECT no_bon FROM technician_loans WHERE no_bon LIKE ? ORDER BY LENGTH(no_bon) DESC, no_bon DESC LIMIT 1').get(`${prefix}%`);
  let seq = last ? parseInt(last.no_bon.slice(prefix.length), 10) || 0 : 0;
  while (true) {
    seq += 1;
    const candidate = `${prefix}${String(seq).padStart(4, '0')}`;
    if (!db.prepare('SELECT 1 FROM technician_loans WHERE no_bon = ?').get(candidate)) return candidate;
  }
}

/** Hitung ulang status bon dari jumlah barangnya (BATAL bersifat permanen). */
function refreshLoanStatus(loanId) {
  const loan = db.prepare('SELECT * FROM technician_loans WHERE id = ?').get(loanId);
  if (!loan || loan.status === 'BATAL') return loan?.status;
  const items = db.prepare('SELECT * FROM technician_loan_items WHERE loan_id = ?').all(loanId);
  const sisa = round3(items.reduce((a, li) => a + Math.max(0, loanItemSisa(li)), 0));
  const adaRealisasi = items.some((li) => Number(li.jumlah_terpasang) + Number(li.jumlah_kembali) > 0);
  const status = sisa <= 0 ? 'SELESAI' : (adaRealisasi ? 'SEBAGIAN' : 'AKTIF');
  db.prepare("UPDATE technician_loans SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(status, loanId);
  return status;
}

/** Ambil satu bon lengkap: barang (+ sisa), riwayat mutasi, dan ringkasan angka. */
function loadLoanDetail(loanId) {
  const loan = db.prepare('SELECT * FROM technician_loans WHERE id = ?').get(loanId);
  if (!loan) return null;
  const items = db.prepare('SELECT * FROM technician_loan_items WHERE loan_id = ? ORDER BY id').all(loanId)
    .map((li) => ({ ...li, jumlah_sisa: loanItemSisa(li), nilai_sisa: round3(loanItemSisa(li) * li.harga_barang) }));
  const movements = db.prepare('SELECT * FROM technician_loan_movements WHERE loan_id = ? ORDER BY id').all(loanId);
  const sum = (f) => round3(items.reduce((a, li) => a + f(li), 0));
  return {
    ...loan,
    items,
    movements,
    summary: {
      jumlah_jenis: items.length,
      total_dibawa: sum((li) => li.jumlah_dibawa),
      total_terpasang: sum((li) => li.jumlah_terpasang),
      total_kembali: sum((li) => li.jumlah_kembali),
      total_sisa: sum((li) => li.jumlah_sisa),
      nilai_dibawa: sum((li) => li.jumlah_dibawa * li.harga_barang),
      nilai_terpasang: sum((li) => li.jumlah_terpasang * li.harga_barang),
      nilai_kembali: sum((li) => li.jumlah_kembali * li.harga_barang),
      nilai_sisa: sum((li) => li.nilai_sisa)
    }
  };
}

/** Daftar bon beserta agregat angka (dipakai daftar & laporan). */
function queryLoans({ status, teknisi, divisi, search, start_date, end_date } = {}) {
  let sql = `
    SELECT l.*,
      COUNT(li.id) AS jumlah_jenis,
      COALESCE(SUM(li.jumlah_dibawa), 0) AS total_dibawa,
      COALESCE(SUM(li.jumlah_terpasang), 0) AS total_terpasang,
      COALESCE(SUM(li.jumlah_kembali), 0) AS total_kembali,
      COALESCE(SUM(li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali), 0) AS total_sisa,
      COALESCE(SUM(li.jumlah_dibawa * li.harga_barang), 0) AS nilai_dibawa,
      COALESCE(SUM(li.jumlah_terpasang * li.harga_barang), 0) AS nilai_terpasang,
      COALESCE(SUM(li.jumlah_kembali * li.harga_barang), 0) AS nilai_kembali,
      COALESCE(SUM((li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) * li.harga_barang), 0) AS nilai_sisa
    FROM technician_loans l
    LEFT JOIN technician_loan_items li ON li.loan_id = l.id
    WHERE 1=1`;
  const params = [];
  if (status === 'BERJALAN') sql += " AND l.status IN ('AKTIF', 'SEBAGIAN')";
  else if (['AKTIF', 'SEBAGIAN', 'SELESAI', 'BATAL'].includes(status)) { sql += ' AND l.status = ?'; params.push(status); }
  if (teknisi) { sql += ' AND UPPER(l.teknisi_nama) = UPPER(?)'; params.push(String(teknisi).trim()); }
  if (divisi && TEKNISI_DIVISI_LIST.includes(String(divisi).toUpperCase())) { sql += ' AND l.divisi = ?'; params.push(String(divisi).toUpperCase()); }
  if (isDateStr(start_date)) { sql += ' AND l.tanggal >= ?'; params.push(start_date); }
  if (isDateStr(end_date)) { sql += ' AND l.tanggal <= ?'; params.push(end_date); }
  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    sql += ` AND (l.no_bon LIKE ? OR l.teknisi_nama LIKE ? OR l.keperluan LIKE ? OR l.divisi LIKE ? OR EXISTS (
      SELECT 1 FROM technician_loan_items x WHERE x.loan_id = l.id AND (x.kode_barang LIKE ? OR x.nama_barang LIKE ?)))`;
    params.push(q, q, q, q, q, q);
  }
  sql += ' GROUP BY l.id ORDER BY l.tanggal DESC, l.id DESC';
  return db.prepare(sql).all(...params).map((r) => ({
    ...r,
    total_dibawa: round3(r.total_dibawa), total_terpasang: round3(r.total_terpasang),
    total_kembali: round3(r.total_kembali), total_sisa: round3(r.total_sisa),
    nilai_dibawa: round3(r.nilai_dibawa), nilai_terpasang: round3(r.nilai_terpasang),
    nilai_kembali: round3(r.nilai_kembali), nilai_sisa: round3(r.nilai_sisa)
  }));
}

function insertLoanMovement(m) {
  const now = new Date();
  const kondisiM = m.kondisi ? normalizeKondisi(m.kondisi) : 'Baik';
  db.prepare(`
    INSERT INTO technician_loan_movements
      (loan_id, loan_item_id, jenis, tanggal, waktu, kode_barang, nama_barang, satuan, harga_barang, jumlah, serial_number,
       divisi, tujuan_id, tujuan_nama, lokasi_tujuan, teknisi_nama, no_transaksi, keterangan, dicatat_oleh, kondisi)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    m.loan_id, m.loan_item_id ?? null, m.jenis, m.tanggal, now.toTimeString().split(' ')[0],
    m.kode_barang, m.nama_barang, m.satuan, m.harga_barang || 0, m.jumlah, m.serial_number || '',
    m.divisi || '', m.tujuan_id ?? null, m.tujuan_nama || '', m.lokasi_tujuan || '',
    m.teknisi_nama || '', m.no_transaksi || '', m.keterangan || '', m.dicatat_oleh || '', kondisiM
  );
}

/** Cari baris barang bon dari { loan_item_id | kode_barang }. */
function findLoanItem(loanId, row) {
  if (row.loan_item_id !== undefined && row.loan_item_id !== null && row.loan_item_id !== '') {
    return db.prepare('SELECT * FROM technician_loan_items WHERE id = ? AND loan_id = ?').get(Number(row.loan_item_id), loanId);
  }
  const kode = String(row.kode_barang || '').trim();
  if (!kode) return null;
  return db.prepare('SELECT * FROM technician_loan_items WHERE loan_id = ? AND UPPER(kode_barang) = UPPER(?)').get(loanId, kode);
}

/** Ambil bon & pastikan masih bisa direalisasikan. */
function getOpenLoan(id) {
  const loan = db.prepare('SELECT * FROM technician_loans WHERE id = ?').get(Number(id));
  if (!loan) {
    const err = new Error('Bon teknisi tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }
  if (loan.status === 'BATAL') throw new Error(`Bon ${loan.no_bon} sudah dibatalkan`);
  if (loan.status === 'SELESAI') throw new Error(`Bon ${loan.no_bon} sudah selesai — tidak ada sisa barang yang dibawa teknisi`);
  return loan;
}

/** Validasi baris { loan_item_id|kode_barang, jumlah } → [{ li, qty, raw }], jumlah kumulatif per barang <= sisa. */
function resolveLoanRows(loan, rows, aksi) {
  const resolved = [];
  const dipakai = new Map(); // loan_item_id → total diminta
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (!raw) continue;
    const mentah = raw.jumlah;
    if (mentah === undefined || mentah === null || mentah === '') continue;
    const qty = Number(mentah);
    if (!Number.isFinite(qty)) throw new Error(`Jumlah harus berupa angka (diterima: "${mentah}")`);
    if (qty < 0) throw new Error(`Jumlah tidak boleh negatif (diterima: ${qty})`);
    if (qty === 0) continue;
    const li = findLoanItem(loan.id, raw);
    if (!li) throw new Error(`Barang "${raw.kode_barang || raw.loan_item_id}" tidak ada di bon ${loan.no_bon}`);
    const total = round3((dipakai.get(li.id) || 0) + qty);
    dipakai.set(li.id, total);
    const sisa = loanItemSisa(li);
    if (total > sisa) {
      throw new Error(
        `Jumlah ${aksi} "${li.nama_barang}" (${total} ${li.satuan}) melebihi sisa yang dibawa teknisi pada bon ${loan.no_bon}: ${sisa} ${li.satuan}.`
      );
    }
    resolved.push({ li, qty: round3(qty), raw });
  }
  if (resolved.length === 0) throw new Error(`Isi minimal satu barang dengan jumlah lebih dari 0 untuk ${aksi}`);
  return resolved;
}

const statusFromError = (err) => err.statusCode || 400;

// Daftar teknisi (akun peran teknisi aktif + nama yang pernah tercatat di bon) — untuk dropdown
app.get('/api/technician-loans/technicians', (req, res) => {
  try {
    const users = db.prepare("SELECT id, nama_lengkap FROM users WHERE role = 'teknisi' AND status = 'aktif' ORDER BY nama_lengkap").all();
    const pernah = db.prepare('SELECT DISTINCT teknisi_nama FROM technician_loans ORDER BY teknisi_nama').all().map((r) => r.teknisi_nama);
    res.json({ success: true, data: { users, nama_pernah_tercatat: pernah } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ----- Data Teknisi (master nama petugas per divisi, dipilih di Bon Teknisi) -----
const TEKNISI_DIVISI_LIST = ['PELANGGAN', 'DIVISI FO', 'DIVISI TOWER'];

function teknisiPemakaian(t) {
  const bon = db.prepare('SELECT COUNT(*) AS n FROM technician_loans WHERE teknisi_ref_id = ? OR UPPER(teknisi_nama) = UPPER(?)').get(t.id, t.nama).n;
  const pasang = db.prepare("SELECT COUNT(*) AS n FROM technician_loan_movements WHERE jenis = 'PASANG' AND UPPER(teknisi_nama) = UPPER(?)").get(t.nama).n;
  return { bon, pasang };
}

function validateTeknisiBody(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.nama !== undefined) {
    const nama = String(body.nama || '').trim().replace(/\s+/g, ' ');
    if (!nama) throw new Error('Nama teknisi wajib diisi');
    if (nama.length > 80) throw new Error('Nama teknisi maksimal 80 karakter');
    out.nama = nama;
  }
  if (!partial || body.divisi !== undefined) {
    const divisi = String(body.divisi || '').trim().toUpperCase();
    if (!TEKNISI_DIVISI_LIST.includes(divisi)) throw new Error('Divisi harus salah satu dari: Pelanggan, Divisi FO, Divisi Tower');
    out.divisi = divisi;
  }
  if (body.no_hp !== undefined) {
    const hp = String(body.no_hp || '').trim();
    if (hp.length > 30) throw new Error('No. HP maksimal 30 karakter');
    out.no_hp = hp;
  }
  if (body.status !== undefined) {
    if (!['aktif', 'nonaktif'].includes(body.status)) throw new Error('Status harus aktif atau nonaktif');
    out.status = body.status;
  }
  return out;
}

app.get('/api/teknisi', (req, res) => {
  try {
    const { divisi, status, search } = req.query;
    let sql = `
      SELECT t.*,
        (SELECT COUNT(*) FROM technician_loans l WHERE (l.teknisi_ref_id = t.id OR UPPER(l.teknisi_nama) = UPPER(t.nama))) AS jumlah_bon,
        (SELECT COUNT(*) FROM technician_loans l WHERE (l.teknisi_ref_id = t.id OR UPPER(l.teknisi_nama) = UPPER(t.nama)) AND l.status IN ('AKTIF', 'SEBAGIAN')) AS bon_berjalan
      FROM technicians t WHERE 1=1`;
    const params = [];
    if (TEKNISI_DIVISI_LIST.includes(String(divisi || '').toUpperCase())) { sql += ' AND t.divisi = ?'; params.push(String(divisi).toUpperCase()); }
    if (['aktif', 'nonaktif'].includes(status)) { sql += ' AND t.status = ?'; params.push(status); }
    if (search && String(search).trim()) { sql += ' AND (t.nama LIKE ? OR t.no_hp LIKE ?)'; params.push(`%${String(search).trim()}%`, `%${String(search).trim()}%`); }
    sql += ' ORDER BY t.divisi, t.nama COLLATE NOCASE';
    res.json({ success: true, data: db.prepare(sql).all(...params) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/teknisi', (req, res) => {
  try {
    const v = validateTeknisiBody(req.body || {});
    if (db.prepare('SELECT 1 FROM technicians WHERE UPPER(nama) = UPPER(?)').get(v.nama)) {
      throw new Error(`Teknisi "${v.nama}" sudah ada di Data Teknisi`);
    }
    const r = db.prepare('INSERT INTO technicians (nama, divisi, no_hp, status) VALUES (?, ?, ?, ?)').run(v.nama, v.divisi, v.no_hp || '', v.status || 'aktif');
    const data = db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(r.lastInsertRowid));
    res.status(201).json({ success: true, data, message: `Teknisi ${data.nama} (${data.divisi}) ditambahkan` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/teknisi/:id', (req, res) => {
  const tx = db.transaction(() => {
    const cur = db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(req.params.id));
    if (!cur) { const e = new Error('Teknisi tidak ditemukan'); e.statusCode = 404; throw e; }
    const v = validateTeknisiBody(req.body || {}, { partial: true });
    if (v.nama && v.nama.toUpperCase() !== cur.nama.toUpperCase()) {
      if (db.prepare('SELECT 1 FROM technicians WHERE UPPER(nama) = UPPER(?) AND id != ?').get(v.nama, cur.id)) {
        throw new Error(`Teknisi "${v.nama}" sudah ada di Data Teknisi`);
      }
    }
    const baru = { ...cur, ...v };
    db.prepare("UPDATE technicians SET nama = ?, divisi = ?, no_hp = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(baru.nama, baru.divisi, baru.no_hp || '', baru.status, cur.id);
    // Ganti nama → catatan lama ikut diperbarui supaya laporan tidak terpecah dua nama
    if (baru.nama !== cur.nama) {
      db.prepare('UPDATE technician_loans SET teknisi_nama = ? WHERE teknisi_ref_id = ? OR UPPER(teknisi_nama) = UPPER(?)').run(baru.nama, cur.id, cur.nama);
      db.prepare('UPDATE technician_loan_movements SET teknisi_nama = ? WHERE UPPER(teknisi_nama) = UPPER(?)').run(baru.nama, cur.nama);
      for (const tbl of ['customer_items', 'fo_items', 'tower_items']) {
        db.prepare(`UPDATE ${tbl} SET dipasang_oleh = ? WHERE UPPER(dipasang_oleh) = UPPER(?)`).run(baru.nama, cur.nama);
      }
    }
    return db.prepare('SELECT * FROM technicians WHERE id = ?').get(cur.id);
  });
  try {
    res.json({ success: true, data: tx(), message: 'Data teknisi diperbarui' });
  } catch (err) {
    res.status(statusFromError(err)).json({ success: false, error: err.message });
  }
});

app.delete('/api/teknisi/:id', (req, res) => {
  try {
    const cur = db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(req.params.id));
    if (!cur) return res.status(404).json({ success: false, error: 'Teknisi tidak ditemukan' });
    const u = teknisiPemakaian(cur);
    if (u.bon + u.pasang > 0) {
      return res.status(400).json({ success: false, error: `Teknisi "${cur.nama}" sudah tercatat di ${u.bon} bon / ${u.pasang} realisasi — tidak bisa dihapus. Ubah statusnya menjadi nonaktif.` });
    }
    db.prepare('DELETE FROM technicians WHERE id = ?').run(cur.id);
    res.json({ success: true, message: `Teknisi ${cur.nama} dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Stok yang SEDANG dibawa teknisi (bon berjalan): per teknisi dan per barang
app.get('/api/technician-loans/stock', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT l.id AS loan_id, l.no_bon, l.tanggal, l.teknisi_nama, l.divisi, l.status,
             li.id AS loan_item_id, li.kode_barang, li.nama_barang, li.satuan, li.harga_barang,
             li.jumlah_dibawa, li.jumlah_terpasang, li.jumlah_kembali,
             (li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) AS jumlah_sisa
      FROM technician_loan_items li JOIN technician_loans l ON l.id = li.loan_id
      WHERE l.status IN ('AKTIF', 'SEBAGIAN') AND (li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) > 0
      ORDER BY l.teknisi_nama, l.id, li.id
    `).all().map((r) => ({ ...r, jumlah_sisa: round3(r.jumlah_sisa), nilai_sisa: round3(r.jumlah_sisa * r.harga_barang) }));

    const perBarang = new Map();
    const perTeknisi = new Map();
    for (const r of rows) {
      const b = perBarang.get(r.kode_barang) || { kode_barang: r.kode_barang, nama_barang: r.nama_barang, satuan: r.satuan, jumlah_sisa: 0, nilai_sisa: 0 };
      b.jumlah_sisa = round3(b.jumlah_sisa + r.jumlah_sisa);
      b.nilai_sisa = round3(b.nilai_sisa + r.nilai_sisa);
      perBarang.set(r.kode_barang, b);
      const t = perTeknisi.get(r.teknisi_nama) || { teknisi_nama: r.teknisi_nama, divisi: r.divisi || '', bon: new Set(), nilai_sisa: 0 };
      t.bon.add(r.no_bon);
      t.nilai_sisa = round3(t.nilai_sisa + r.nilai_sisa);
      perTeknisi.set(r.teknisi_nama, t);
    }
    res.json({
      success: true,
      data: {
        rows,
        per_barang: [...perBarang.values()],
        per_teknisi: [...perTeknisi.values()].map((t) => ({ teknisi_nama: t.teknisi_nama, divisi: t.divisi, jumlah_bon: t.bon.size, nilai_sisa: t.nilai_sisa })),
        total_nilai_sisa: round3(rows.reduce((a, r) => a + r.nilai_sisa, 0))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Riwayat mutasi bon (BAWA / PASANG / KEMBALI / BATAL) lintas bon
app.get('/api/technician-loans/movements', (req, res) => {
  try {
    const { start_date, end_date, jenis, teknisi, search, loan_id } = req.query;
    let sql = `
      SELECT m.*, l.no_bon, l.teknisi_nama AS teknisi_bon
      FROM technician_loan_movements m JOIN technician_loans l ON l.id = m.loan_id
      WHERE 1=1`;
    const params = [];
    if (loan_id) { sql += ' AND m.loan_id = ?'; params.push(Number(loan_id)); }
    if (isDateStr(start_date)) { sql += ' AND m.tanggal >= ?'; params.push(start_date); }
    if (isDateStr(end_date)) { sql += ' AND m.tanggal <= ?'; params.push(end_date); }
    if (['BAWA', 'PASANG', 'KEMBALI', 'BATAL'].includes(jenis)) { sql += ' AND m.jenis = ?'; params.push(jenis); }
    if (teknisi) { sql += ' AND (UPPER(m.teknisi_nama) = UPPER(?) OR UPPER(l.teknisi_nama) = UPPER(?))'; params.push(String(teknisi).trim(), String(teknisi).trim()); }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      sql += ' AND (l.no_bon LIKE ? OR m.kode_barang LIKE ? OR m.nama_barang LIKE ? OR m.serial_number LIKE ? OR m.tujuan_nama LIKE ? OR m.lokasi_tujuan LIKE ? OR m.teknisi_nama LIKE ?)';
      params.push(q, q, q, q, q, q, q);
    }
    sql += ' ORDER BY m.tanggal DESC, m.id DESC';
    res.json({ success: true, data: db.prepare(sql).all(...params) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Laporan Bon Teknisi: ringkasan, rekap per teknisi / barang / divisi tujuan, dan daftar bon
app.get('/api/technician-loans/report', (req, res) => {
  try {
    const loans = queryLoans(req.query);
    const ids = loans.map((l) => l.id);
    const summary = {
      total_bon: loans.length,
      bon_berjalan: loans.filter((l) => LOAN_OPEN_STATUSES.includes(l.status)).length,
      bon_selesai: loans.filter((l) => l.status === 'SELESAI').length,
      bon_batal: loans.filter((l) => l.status === 'BATAL').length,
      nilai_dibawa: round3(loans.reduce((a, l) => a + l.nilai_dibawa, 0)),
      nilai_terpasang: round3(loans.reduce((a, l) => a + l.nilai_terpasang, 0)),
      nilai_kembali: round3(loans.reduce((a, l) => a + l.nilai_kembali, 0)),
      nilai_sisa: round3(loans.filter((l) => LOAN_OPEN_STATUSES.includes(l.status)).reduce((a, l) => a + l.nilai_sisa, 0))
    };

    const perTeknisiMap = new Map();
    for (const l of loans) {
      const t = perTeknisiMap.get(l.teknisi_nama) || {
        teknisi_nama: l.teknisi_nama, divisi: l.divisi || '', jumlah_bon: 0, bon_berjalan: 0,
        nilai_dibawa: 0, nilai_terpasang: 0, nilai_kembali: 0, nilai_sisa: 0
      };
      t.jumlah_bon += 1;
      if (LOAN_OPEN_STATUSES.includes(l.status)) { t.bon_berjalan += 1; t.nilai_sisa = round3(t.nilai_sisa + l.nilai_sisa); }
      t.nilai_dibawa = round3(t.nilai_dibawa + l.nilai_dibawa);
      t.nilai_terpasang = round3(t.nilai_terpasang + l.nilai_terpasang);
      t.nilai_kembali = round3(t.nilai_kembali + l.nilai_kembali);
      perTeknisiMap.set(l.teknisi_nama, t);
    }

    // Rekap per divisi pembawa (divisi teknisi yang membuat bon)
    const perDivisiBonMap = new Map();
    for (const l of loans) {
      const key = l.divisi || '';
      const d = perDivisiBonMap.get(key) || { divisi: key, jumlah_bon: 0, bon_berjalan: 0, nilai_dibawa: 0, nilai_terpasang: 0, nilai_kembali: 0, nilai_sisa: 0, teknisi: new Set() };
      d.jumlah_bon += 1;
      d.teknisi.add(l.teknisi_nama);
      if (LOAN_OPEN_STATUSES.includes(l.status)) { d.bon_berjalan += 1; d.nilai_sisa = round3(d.nilai_sisa + l.nilai_sisa); }
      d.nilai_dibawa = round3(d.nilai_dibawa + l.nilai_dibawa);
      d.nilai_terpasang = round3(d.nilai_terpasang + l.nilai_terpasang);
      d.nilai_kembali = round3(d.nilai_kembali + l.nilai_kembali);
      perDivisiBonMap.set(key, d);
    }

    const perBarangMap = new Map();
    const perDivisiMap = new Map();
    const perPemasangMap = new Map();
    if (ids.length > 0) {
      const ph = ids.map(() => '?').join(',');
      const statusById = new Map(loans.map((l) => [l.id, l.status]));
      for (const li of db.prepare(`SELECT * FROM technician_loan_items WHERE loan_id IN (${ph})`).all(...ids)) {
        const b = perBarangMap.get(li.kode_barang) || {
          kode_barang: li.kode_barang, nama_barang: li.nama_barang, satuan: li.satuan,
          jumlah_dibawa: 0, jumlah_terpasang: 0, jumlah_kembali: 0, jumlah_sisa: 0, nilai_dibawa: 0
        };
        b.jumlah_dibawa = round3(b.jumlah_dibawa + li.jumlah_dibawa);
        b.jumlah_terpasang = round3(b.jumlah_terpasang + li.jumlah_terpasang);
        b.jumlah_kembali = round3(b.jumlah_kembali + li.jumlah_kembali);
        if (LOAN_OPEN_STATUSES.includes(statusById.get(li.loan_id))) b.jumlah_sisa = round3(b.jumlah_sisa + loanItemSisa(li));
        b.nilai_dibawa = round3(b.nilai_dibawa + li.jumlah_dibawa * li.harga_barang);
        perBarangMap.set(li.kode_barang, b);
      }
      for (const m of db.prepare(`SELECT * FROM technician_loan_movements WHERE jenis = 'PASANG' AND loan_id IN (${ph})`).all(...ids)) {
        const d = perDivisiMap.get(m.divisi) || { divisi: m.divisi, jumlah_realisasi: 0, nilai: 0, tujuan: new Set() };
        d.jumlah_realisasi += 1;
        d.nilai = round3(d.nilai + m.jumlah * m.harga_barang);
        d.tujuan.add(`${m.tujuan_id}`);
        perDivisiMap.set(m.divisi, d);
        const p = perPemasangMap.get(m.teknisi_nama) || { teknisi_nama: m.teknisi_nama, jumlah_realisasi: 0, nilai: 0 };
        p.jumlah_realisasi += 1;
        p.nilai = round3(p.nilai + m.jumlah * m.harga_barang);
        perPemasangMap.set(m.teknisi_nama, p);
      }
    }

    res.json({
      success: true,
      data: {
        summary,
        per_teknisi: [...perTeknisiMap.values()].sort((a, b) => b.nilai_dibawa - a.nilai_dibawa),
        per_divisi_bon: [...perDivisiBonMap.values()].map((d) => ({ ...d, jumlah_teknisi: d.teknisi.size, teknisi: undefined })).sort((a, b) => b.nilai_dibawa - a.nilai_dibawa),
        per_barang: [...perBarangMap.values()].sort((a, b) => b.nilai_dibawa - a.nilai_dibawa),
        per_divisi: [...perDivisiMap.values()].map((d) => ({ divisi: d.divisi, jumlah_realisasi: d.jumlah_realisasi, jumlah_tujuan: d.tujuan.size, nilai: d.nilai })),
        per_pemasang: [...perPemasangMap.values()].sort((a, b) => b.nilai - a.nilai),
        loans
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Daftar bon
app.get('/api/technician-loans', (req, res) => {
  try {
    res.json({ success: true, data: queryLoans(req.query) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Detail satu bon (barang, sisa, riwayat mutasi)
app.get('/api/technician-loans/:id', (req, res) => {
  try {
    const detail = loadLoanDetail(Number(req.params.id));
    if (!detail) return res.status(404).json({ success: false, error: 'Bon teknisi tidak ditemukan' });
    res.json({ success: true, data: detail });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TAHAP 1 — Catat bon: teknisi membawa barang dari gudang (stok gudang berkurang)
app.post('/api/technician-loans', (req, res) => {
  const transaction = db.transaction(() => {
    const { no_bon, tanggal, teknisi_id, teknisi_ref_id, divisi, teknisi_nama, keperluan = '', catatan = '', items } = req.body || {};

    if (tanggal !== undefined && tanggal !== '' && !isDateStr(tanggal)) {
      throw new Error('Format tanggal harus YYYY-MM-DD');
    }
    const tgl = tanggal || todayLocal();

    // Nama teknisi: dari akun teknisi (bila dipilih) atau diketik bebas
    let teknisiNama = String(teknisi_nama || '').trim();
    let teknisiId = null;
    if (teknisi_id) {
      const u = db.prepare("SELECT id, nama_lengkap FROM users WHERE id = ? AND role = 'teknisi'").get(Number(teknisi_id));
      if (!u) throw new Error('Akun teknisi yang dipilih tidak ditemukan');
      teknisiId = u.id;
      if (!teknisiNama) teknisiNama = u.nama_lengkap;
    }

    // Teknisi dari Data Teknisi (dropdown): nama & divisi mengikuti data master
    let refId = null;
    let divisiBon = String(divisi || '').trim().toUpperCase();
    if (teknisi_ref_id) {
      const ref = db.prepare('SELECT * FROM technicians WHERE id = ?').get(Number(teknisi_ref_id));
      if (!ref) throw new Error('Teknisi yang dipilih tidak ditemukan di Data Teknisi');
      if (ref.status !== 'aktif') throw new Error(`Teknisi \"${ref.nama}\" berstatus nonaktif — aktifkan dulu di Data Teknisi`);
      refId = ref.id;
      teknisiNama = ref.nama;
      if (!divisiBon) divisiBon = ref.divisi;
    }
    if (!teknisiNama) throw new Error('Nama teknisi yang membawa barang wajib diisi');
    if (!divisiBon) throw new Error('Divisi wajib dipilih (Pelanggan / Divisi FO / Divisi Tower)');
    if (!TEKNISI_DIVISI_LIST.includes(divisiBon)) throw new Error('Divisi harus salah satu dari: Pelanggan, Divisi FO, Divisi Tower');

    // Gabungkan kode barang yang sama & validasi terhadap master
    const { validated } = validateInstalledItems(items, tgl);
    if (validated.length === 0) throw new Error('Daftar barang bon kosong — tambahkan minimal satu barang dengan jumlah lebih dari 0');
    const perKode = new Map();
    for (const v of validated) {
      const ada = perKode.get(v.kode_barang);
      if (ada) ada.jumlah = round3(ada.jumlah + v.jumlah);
      else perKode.set(v.kode_barang, { ...v });
    }
    const baris = [...perKode.values()];
    assertStockAvailable(sumQtyByCode(baris));

    let noBon = String(no_bon || '').trim().toUpperCase();
    if (noBon) {
      if (noBon.length > 40) throw new Error('No. Bon maksimal 40 karakter');
      if (db.prepare('SELECT 1 FROM technician_loans WHERE no_bon = ?').get(noBon)) {
        throw new Error(`No. Bon "${noBon}" sudah digunakan`);
      }
    } else {
      noBon = generateBonNumber(tgl);
    }

    const now = new Date();
    const dicatatOleh = req.user?.nama_lengkap || req.user?.username || '';
    const ins = db.prepare(`
      INSERT INTO technician_loans (no_bon, tanggal, waktu, teknisi_id, teknisi_ref_id, divisi, teknisi_nama, keperluan, catatan, status, dibuat_oleh)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'AKTIF', ?)
    `).run(noBon, tgl, now.toTimeString().split(' ')[0], teknisiId, refId, divisiBon, teknisiNama, String(keperluan).trim(), String(catatan).trim(), dicatatOleh);
    const loanId = Number(ins.lastInsertRowid);

    for (const b of baris) {
      const li = db.prepare(`
        INSERT INTO technician_loan_items (loan_id, kode_barang, nama_barang, jenis_barang, satuan, harga_barang, jumlah_dibawa)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(loanId, b.kode_barang, b.nama_barang, b.jenis_barang, b.satuan, b.harga_barang, b.jumlah);

      // Stok gudang berkurang → masuk stok dibawa teknisi
      db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now','localtime') WHERE kode_barang = ?").run(b.jumlah, b.kode_barang);
      const master = getMasterItem(b.kode_barang);
      const trxNo = logStockMutation({
        jenis: 'KELUAR',
        kategori: 'Bon Teknisi (Dibawa)',
        divisi: TEKNISI_DIVISI,
        refId: loanId,
        lokasi: `Teknisi ${teknisiNama} — ${divisiBon} (${noBon})`,
        item: master,
        jumlah: b.jumlah,
        harga_satuan: master.harga_barang,
        keterangan: `Bon ${noBon} — dibawa teknisi ${teknisiNama}${keperluan ? ` untuk ${String(keperluan).trim()}` : ''}`,
        tanggal: tgl
      });
      insertLoanMovement({
        loan_id: loanId, loan_item_id: Number(li.lastInsertRowid), jenis: 'BAWA', tanggal: tgl,
        kode_barang: b.kode_barang, nama_barang: b.nama_barang, satuan: b.satuan, harga_barang: b.harga_barang,
        jumlah: b.jumlah, teknisi_nama: teknisiNama, no_transaksi: trxNo,
        keterangan: 'Dibawa dari gudang', dicatat_oleh: dicatatOleh
      });
    }
    return loadLoanDetail(loanId);
  });

  try {
    const data = transaction();
    res.status(201).json({ success: true, data, message: `Bon ${data.no_bon} tersimpan — stok gudang dipindahkan ke stok dibawa teknisi ${data.teknisi_nama}` });
  } catch (err) {
    res.status(statusFromError(err)).json({ success: false, error: err.message });
  }
});

// TAHAP 2 — Realisasi pemasangan dari bon ke Pelanggan / Divisi FO / Divisi Tower
app.post('/api/technician-loans/:id/install', (req, res) => {
  const transaction = db.transaction(() => {
    const loan = getOpenLoan(req.params.id);
    const {
      divisi, tujuan_id, lokasi_tujuan = '', teknisi_pemasang, tanggal,
      keterangan = '', items
    } = req.body || {};

    const cfg = LINKED_DIVISI[divisi];
    if (!cfg) throw new Error('Divisi tujuan harus salah satu dari: Pelanggan, Divisi FO, Divisi Tower');
    if (!tujuan_id) throw new Error(`Pilih data tujuan ${cfg.label} tempat barang dipasang`);
    const owner = db.prepare(`SELECT * FROM ${cfg.siteTable} WHERE id = ?`).get(Number(tujuan_id));
    if (!owner) throw new Error(`Data tujuan ${cfg.label} tidak ditemukan`);
    const ownerName = owner[cfg.nameCol];

    if (tanggal !== undefined && tanggal !== '' && !isDateStr(tanggal)) throw new Error('Format tanggal harus YYYY-MM-DD');
    const tgl = tanggal || todayLocal();
    const pemasang = String(teknisi_pemasang || '').trim() || loan.teknisi_nama;
    const lokasi = String(lokasi_tujuan || '').trim() ||
      (divisi === 'PELANGGAN' ? [ownerName, owner.alamat].filter(Boolean).join(' — ') : ownerName);
    const dicatatOleh = req.user?.nama_lengkap || req.user?.username || '';

    const rows = resolveLoanRows(loan, items, 'pemasangan');

    // SN: hanya untuk 1 unit per baris, tidak boleh dobel di permintaan ini maupun yang sudah terpasang
    const snDalamPermintaan = new Set();
    for (const r of rows) {
      const sn = String(r.raw.serial_number || '').trim();
      r.sn = sn;
      if (!sn) continue;
      if (r.qty !== 1) throw new Error(`Barang bernomor seri (SN "${sn}") harus dipasang 1 unit per baris`);
      const key = `${r.li.kode_barang}|${sn.toUpperCase()}`;
      if (snDalamPermintaan.has(key)) throw new Error(`SN "${sn}" diisi lebih dari satu kali`);
      snDalamPermintaan.add(key);
      for (const [tbl, label] of [['customer_items', 'pelanggan'], ['fo_items', 'titik FO'], ['tower_items', 'site tower']]) {
        const dup = db.prepare(`SELECT 1 FROM ${tbl} WHERE UPPER(kode_barang) = UPPER(?) AND UPPER(serial_number) = UPPER(?)`).get(r.li.kode_barang, sn);
        if (dup) throw new Error(`SN "${sn}" untuk ${r.li.nama_barang} sudah tercatat terpasang di ${label}`);
      }
    }

    for (const r of rows) {
      const { li, qty, sn } = r;
      const existing = db.prepare(
        `SELECT * FROM ${cfg.itemsTable} WHERE ${cfg.fk} = ? AND kode_barang = ? AND COALESCE(serial_number, '') = ?`
      ).get(owner.id, li.kode_barang, sn);
      if (existing) {
        const jumlahBaru = round3(Number(existing.jumlah) + qty);
        db.prepare(`UPDATE ${cfg.itemsTable} SET jumlah = ?, subtotal = ?, dipasang_oleh = ?, no_bon = ? WHERE id = ?`)
          .run(jumlahBaru, jumlahBaru * Number(existing.harga_barang), pemasang, loan.no_bon, existing.id);
      } else {
        const master = getMasterItem(li.kode_barang);
        db.prepare(`
          INSERT INTO ${cfg.itemsTable} (${cfg.fk}, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang, dipasang_oleh, no_bon)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          owner.id, li.kode_barang, li.nama_barang, li.jenis_barang, li.satuan, qty, li.harga_barang,
          qty * li.harga_barang, sn, master?.referensi_suplayer || '', tgl, pemasang, loan.no_bon
        );
      }

      db.prepare('UPDATE technician_loan_items SET jumlah_terpasang = ? WHERE id = ?').run(round3(li.jumlah_terpasang + qty), li.id);
      insertLoanMovement({
        loan_id: loan.id, loan_item_id: li.id, jenis: 'PASANG', tanggal: tgl,
        kode_barang: li.kode_barang, nama_barang: li.nama_barang, satuan: li.satuan, harga_barang: li.harga_barang,
        jumlah: qty, serial_number: sn, divisi, tujuan_id: owner.id, tujuan_nama: ownerName, lokasi_tujuan: lokasi,
        teknisi_nama: pemasang, keterangan: String(keterangan).trim() || `Dipasang di ${cfg.label} ${ownerName}`, dicatat_oleh: dicatatOleh
      });
    }

    // Nilai aset tujuan selalu = jumlah subtotal barang terpasang
    db.prepare(`
      UPDATE ${cfg.siteTable}
      SET total_harga = (SELECT COALESCE(SUM(subtotal), 0) FROM ${cfg.itemsTable} WHERE ${cfg.fk} = ?),
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(owner.id, owner.id);

    refreshLoanStatus(loan.id);
    return { detail: loadLoanDetail(loan.id), tujuan: `${cfg.label} — ${ownerName}`, jumlahBaris: rows.length };
  });

  try {
    const r = transaction();
    res.status(201).json({
      success: true, data: r.detail,
      message: `${r.jumlahBaris} barang dari bon ${r.detail.no_bon} tercatat terpasang di ${r.tujuan}`
    });
  } catch (err) {
    res.status(statusFromError(err)).json({ success: false, error: err.message });
  }
});

// TAHAP 3 — Pengembalian sisa barang (mendukung kondisi Baik / Rusak ... — barang rusak tidak menambah stok siap pakai)
app.post('/api/technician-loans/:id/return', (req, res) => {
  const transaction = db.transaction(() => {
    const loan = getOpenLoan(req.params.id);
    const { tanggal, keterangan = '', items, semua_sisa, dikembalikan_oleh, kondisi } = req.body || {};

    if (tanggal !== undefined && tanggal !== '' && !isDateStr(tanggal)) throw new Error('Format tanggal harus YYYY-MM-DD');
    const tgl = tanggal || todayLocal();
    const dicatatOleh = req.user?.nama_lengkap || req.user?.username || '';
    const pengembali = String(dikembalikan_oleh || '').trim() || loan.teknisi_nama;
    const kondisiGlobal = kondisi !== undefined ? normalizeKondisi(kondisi) : null;

    // semua_sisa = true → kembalikan seluruh sisa semua barang pada bon
    const rows = semua_sisa
      ? db.prepare('SELECT * FROM technician_loan_items WHERE loan_id = ?').all(loan.id)
          .filter((li) => loanItemSisa(li) > 0)
          .map((li) => ({ loan_item_id: li.id, jumlah: loanItemSisa(li), kondisi: kondisiGlobal || 'Baik' }))
      : items;
    const resolved = resolveLoanRows(loan, rows, 'pengembalian');

    for (const { li, qty, raw } of resolved) {
      const master = getMasterItem(li.kode_barang);
      if (!master) throw new Error(`Barang "${li.nama_barang}" (${li.kode_barang}) sudah tidak ada di master data — tidak bisa dikembalikan ke gudang`);
      const kondisiItem = raw && raw.kondisi !== undefined ? normalizeKondisi(raw.kondisi) : (kondisiGlobal || 'Baik');
      const rusak = isKondisiRusak(kondisiItem);
      if (!rusak) {
        db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE id = ?").run(qty, master.id);
      }
      db.prepare('UPDATE technician_loan_items SET jumlah_kembali = ? WHERE id = ?').run(round3(li.jumlah_kembali + qty), li.id);
      const kategoriReturn = rusak ? (kondisiItem === 'Afkir' ? 'Barang Afkir' : 'Barang Rusak') : 'Pengembalian Bon Teknisi';
      const trxNo = logStockMutation({
        jenis: 'MASUK',
        kategori: kategoriReturn,
        divisi: TEKNISI_DIVISI,
        refId: loan.id,
        lokasi: `Teknisi ${loan.teknisi_nama} (${loan.no_bon})`,
        item: master,
        jumlah: qty,
        harga_satuan: li.harga_barang,
        keterangan: String(keterangan).trim() || `Bon ${loan.no_bon} — sisa ${rusak ? `kondisi ${kondisiItem.toLowerCase()} masuk gudang rusak` : 'tidak terpakai dikembalikan oleh ' + pengembali + ' ke gudang'}`,
        tanggal: tgl,
        kondisi: kondisiItem
      });
      insertLoanMovement({
        loan_id: loan.id, loan_item_id: li.id, jenis: 'KEMBALI', tanggal: tgl,
        kode_barang: li.kode_barang, nama_barang: li.nama_barang, satuan: li.satuan, harga_barang: li.harga_barang,
        jumlah: qty, teknisi_nama: pengembali, no_transaksi: trxNo,
        keterangan: String(keterangan).trim() || (rusak ? `Kondisi ${kondisiItem}` : 'Sisa tidak terpakai dikembalikan ke gudang'), dicatat_oleh: dicatatOleh,
        kondisi: kondisiItem
      });
      if (rusak) {
        buatDamagedEntry({
          kode_barang: master.kode_barang, nama_barang: master.nama_barang, jenis_barang: master.jenis_barang,
          satuan: master.satuan, harga_barang: master.harga_barang, jumlah: qty, kondisi: kondisiItem,
          sumber: 'Pengembalian Bon Teknisi', sumber_id: loan.id, sumber_nama: `${loan.teknisi_nama} (${loan.no_bon})`,
          no_transaksi: trxNo, keterangan: String(keterangan).trim(), tanggal: tgl, dibuat_oleh: dicatatOleh
        });
      }
    }

    refreshLoanStatus(loan.id);
    return loadLoanDetail(loan.id);
  });

  try {
    const data = transaction();
    res.status(201).json({
      success: true, data,
      message: data.status === 'SELESAI'
        ? `Pengembalian dicatat — bon ${data.no_bon} SELESAI`
        : `Pengembalian dicatat — bon ${data.no_bon} masih menyisakan barang di teknisi`
    });
  } catch (err) {
    res.status(statusFromError(err)).json({ success: false, error: err.message });
  }
});

// Batalkan bon (hanya bila belum ada realisasi pemasangan): seluruh sisa kembali ke gudang
app.post('/api/technician-loans/:id/cancel', (req, res) => {
  const transaction = db.transaction(() => {
    const loan = getOpenLoan(req.params.id);
    const alasan = String(req.body?.alasan || '').trim();
    const dicatatOleh = req.user?.nama_lengkap || req.user?.username || '';
    const sudahPasang = db.prepare("SELECT COUNT(*) AS c FROM technician_loan_movements WHERE loan_id = ? AND jenis = 'PASANG'").get(loan.id).c;
    if (sudahPasang > 0) {
      throw new Error(`Bon ${loan.no_bon} tidak bisa dibatalkan karena sudah ada realisasi pemasangan. Kembalikan sisa barang lewat Pengembalian.`);
    }
    const tgl = todayLocal();
    for (const li of db.prepare('SELECT * FROM technician_loan_items WHERE loan_id = ?').all(loan.id)) {
      const sisa = loanItemSisa(li);
      if (sisa <= 0) continue;
      const master = getMasterItem(li.kode_barang);
      if (!master) throw new Error(`Barang "${li.nama_barang}" (${li.kode_barang}) sudah tidak ada di master data`);
      db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE id = ?").run(sisa, master.id);
      db.prepare('UPDATE technician_loan_items SET jumlah_kembali = ? WHERE id = ?').run(round3(li.jumlah_kembali + sisa), li.id);
      const trxNo = logStockMutation({
        jenis: 'MASUK', kategori: 'Pembatalan Bon Teknisi', divisi: TEKNISI_DIVISI, refId: loan.id,
        lokasi: `Teknisi ${loan.teknisi_nama} (${loan.no_bon})`, item: master, jumlah: sisa, harga_satuan: li.harga_barang,
        keterangan: `Bon ${loan.no_bon} dibatalkan${alasan ? ` — ${alasan}` : ''}; barang kembali ke stok gudang`, tanggal: tgl
      });
      insertLoanMovement({
        loan_id: loan.id, loan_item_id: li.id, jenis: 'BATAL', tanggal: tgl,
        kode_barang: li.kode_barang, nama_barang: li.nama_barang, satuan: li.satuan, harga_barang: li.harga_barang,
        jumlah: sisa, teknisi_nama: loan.teknisi_nama, no_transaksi: trxNo,
        keterangan: alasan || 'Bon dibatalkan', dicatat_oleh: dicatatOleh
      });
    }
    db.prepare("UPDATE technician_loans SET status = 'BATAL', updated_at = datetime('now','localtime') WHERE id = ?").run(loan.id);
    return loadLoanDetail(loan.id);
  });

  try {
    const data = transaction();
    res.json({ success: true, data, message: `Bon ${data.no_bon} dibatalkan — seluruh barang kembali ke stok gudang` });
  } catch (err) {
    res.status(statusFromError(err)).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. GUDANG BARANG RUSAK / AFKIR (DAMAGED ITEMS)
// Ledger terpisah — barang tidak masuk stok siap pakai.
// Status: DITAMPUNG -> DIPERBAIKI (kembali ke stok) atau DIMUSNAHKAN
// ==========================================

function getDamagedOr404(id) {
  const row = db.prepare('SELECT * FROM damaged_items WHERE id = ?').get(Number(id));
  if (!row) {
    const e = new Error('Data barang rusak tidak ditemukan');
    e.statusCode = 404;
    throw e;
  }
  return row;
}

// GET /api/damaged-items — listing dengan filter
app.get('/api/damaged-items', (req, res) => {
  try {
    const { status, kondisi, search, sumber, kode_barang, page = 1, limit = 50 } = req.query;
    let where = [];
    let params = [];
    if (status && DAMAGED_STATUS.includes(String(status).toUpperCase())) {
      where.push('status = ?');
      params.push(String(status).toUpperCase());
    }
    if (kondisi) {
      try {
        const k = normalizeKondisi(kondisi);
        where.push('kondisi = ?');
        params.push(k);
      } catch {}
    }
    if (sumber && String(sumber).trim()) {
      where.push('sumber LIKE ?');
      params.push(`%${String(sumber).trim()}%`);
    }
    if (kode_barang && String(kode_barang).trim()) {
      where.push('UPPER(kode_barang) = UPPER(?)');
      params.push(String(kode_barang).trim());
    }
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where.push('(kode_barang LIKE ? OR nama_barang LIKE ? OR jenis_barang LIKE ? OR kondisi LIKE ? OR status LIKE ? OR sumber LIKE ? OR sumber_nama LIKE ? OR no_transaksi LIKE ? OR keterangan LIKE ?)');
      params.push(q, q, q, q, q, q, q, q, q);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const off = (pg - 1) * lim;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM damaged_items ${whereSql}`).get(...params).c;
    const rows = db.prepare(`SELECT * FROM damaged_items ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, lim, off);
    const summary = db.prepare(`SELECT status, COUNT(*) AS jumlah_entri, COALESCE(SUM(jumlah),0) AS total_qty, COALESCE(SUM(jumlah * harga_barang),0) AS total_nilai FROM damaged_items ${whereSql} GROUP BY status`).all(...params);
    const summaryKondisi = db.prepare(`SELECT kondisi, COUNT(*) AS jumlah_entri, COALESCE(SUM(jumlah),0) AS total_qty FROM damaged_items ${whereSql} GROUP BY kondisi`).all(...params);
    res.json({ success: true, data: rows, pagination: { page: pg, limit: lim, total, total_pages: Math.ceil(total / lim) }, summary, summary_kondisi: summaryKondisi });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single
app.get('/api/damaged-items/:id', (req, res) => {
  try {
    const row = getDamagedOr404(req.params.id);
    res.json({ success: true, data: row });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// POST create manual
app.post('/api/damaged-items', (req, res) => {
  try {
    const { kode_barang, nama_barang, jenis_barang, satuan, harga_barang, jumlah, kondisi, keterangan, sumber, sumber_nama, tanggal } = req.body || {};
    if (!kode_barang || !String(kode_barang).trim()) throw new Error('kode_barang wajib diisi');
    const kondisiBersih = normalizeKondisi(kondisi || 'Rusak Ringan');
    if (!isKondisiRusak(kondisiBersih)) throw new Error('kondisi untuk gudang rusak harus salah satu dari: Rusak Ringan, Rusak Berat, Afkir');
    const qty = Number(jumlah);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('jumlah harus lebih dari 0');
    const master = getMasterItem(kode_barang);
    const nama = String(nama_barang || master?.nama_barang || '').trim() || String(kode_barang).trim();
    const jenis = String(jenis_barang || master?.jenis_barang || '').trim();
    const sat = String(satuan || master?.satuan || 'pcs').trim();
    const harga = harga_barang !== undefined ? Number(harga_barang) : (master?.harga_barang || 0);
    if (!Number.isFinite(harga) || harga < 0) throw new Error('harga_barang tidak valid');
    const tgl = (tanggal && isDateStr(tanggal)) ? tanggal : todayLocal();
    const dibuat = req.user?.nama_lengkap || req.user?.username || '';
    // Jika barang ada di stok, kurangi stok gudang (barang dipindahkan ke gudang rusak)
    if (master) {
      if (master.stok < qty) throw new Error(`Stok gudang tidak cukup. Sisa: ${master.stok} ${master.satuan}, diminta: ${qty}`);
      db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now','localtime') WHERE id = ?").run(qty, master.id);
    }
    const trxNo = logStockMutation({
      jenis: 'KELUAR',
      kategori: kondisiBersih === 'Afkir' ? 'Barang Afkir' : 'Barang Rusak',
      divisi: 'GUDANG',
      refId: master ? master.id : null,
      lokasi: String(sumber_nama || sumber || 'Gudang Rusak'),
      item: { kode_barang: String(kode_barang).toUpperCase().trim(), nama_barang: nama, jenis_barang: jenis, satuan: sat, harga_barang: harga },
      jumlah: qty,
      harga_satuan: harga,
      keterangan: keterangan ? `${keterangan} — ${kondisiBersih}` : `Masuk gudang rusak — ${kondisiBersih}`,
      tanggal: tgl,
      kondisi: kondisiBersih
    });
    const entry = buatDamagedEntry({
      kode_barang: String(kode_barang).toUpperCase().trim(), nama_barang: nama, jenis_barang: jenis,
      satuan: sat, harga_barang: harga, jumlah: qty, kondisi: kondisiBersih,
      sumber: sumber ? String(sumber).trim() : 'MANUAL', sumber_nama: sumber_nama ? String(sumber_nama).trim() : '',
      no_transaksi: trxNo, keterangan: keterangan || '', tanggal: tgl, dibuat_oleh: dibuat
    });
    res.status(201).json({ success: true, data: entry, message: `Barang rusak ${entry.kode_barang} berhasil ditampung (${kondisiBersih})` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// PUT update catatan (hanya DITAMPUNG — sudah diperbaiki/dimusnahkan tidak boleh diubah)
app.put('/api/damaged-items/:id', (req, res) => {
  try {
    const row = getDamagedOr404(req.params.id);
    if (row.status !== 'DITAMPUNG') throw new Error('Hanya barang berstatus DITAMPUNG yang bisa diubah');
    const { jumlah, kondisi, keterangan, sumber, sumber_nama } = req.body || {};
    let qty = Number(row.jumlah);
    let kondisiBersih = row.kondisi;
    let ket = row.keterangan;
    let src = row.sumber;
    let srcNama = row.sumber_nama;
    let harga = row.harga_barang;
    // Validasi perubahan jumlah: selisih harus ada stok jika menambah
    if (jumlah !== undefined && jumlah !== '') {
      const q = Number(jumlah);
      if (!Number.isFinite(q) || q <= 0) throw new Error('jumlah harus lebih dari 0');
      const delta = round3(q - Number(row.jumlah));
      if (delta > 0) {
        // butuh kunci? Actually manual: if originally from stok, delta means extra? For ledger-only (rusak), we don't have stok to deduct? But original qty already deducted? For entries from pengembalian rusak, stok tidak dikurangi? Actually those came from installed, not from stok. So we keep simple: only allow smaller or equal? Let's allow but validate stok if master exists
        const master = getMasterItem(row.kode_barang);
        if (master && master.stok < delta) throw new Error(`Stok gudang tidak cukup untuk menambah jumlah. Sisa: ${master.stok}`);
        if (master && delta > 0) db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now','localtime') WHERE id = ?").run(delta, master.id);
      } else if (delta < 0) {
        const master = getMasterItem(row.kode_barang);
        if (master) db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE id = ?").run(-delta, master.id);
      }
      qty = round3(q);
    }
    if (kondisi !== undefined && kondisi !== '') {
      kondisiBersih = normalizeKondisi(kondisi);
      if (!isKondisiRusak(kondisiBersih)) throw new Error('kondisi gudang rusak harus Rusak Ringan / Rusak Berat / Afkir');
    }
    if (keterangan !== undefined) ket = String(keterangan);
    if (sumber !== undefined) src = String(sumber);
    if (sumber_nama !== undefined) srcNama = String(sumber_nama);
    db.prepare("UPDATE damaged_items SET jumlah = ?, kondisi = ?, keterangan = ?, sumber = ?, sumber_nama = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(qty, kondisiBersih, ket, src, srcNama, row.id);
    const updated = db.prepare('SELECT * FROM damaged_items WHERE id = ?').get(row.id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST perbaikan — DITAMPUNG -> DIPERBAIKI (sebagian atau seluruh qty kembali ke stok siap pakai)
app.post('/api/damaged-items/:id/repair', (req, res) => {
  const transaction = db.transaction(() => {
    const row = getDamagedOr404(req.params.id);
    if (row.status !== 'DITAMPUNG') throw new Error('Hanya barang DITAMPUNG yang bisa diperbaiki');
    let qty = req.body?.jumlah !== undefined && req.body?.jumlah !== '' ? Number(req.body.jumlah) : Number(row.jumlah);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('jumlah perbaikan harus lebih dari 0');
    if (qty > Number(row.jumlah)) throw new Error(`Jumlah perbaikan melebihi stok rusak. Tersedia: ${row.jumlah}`);
    const tgl = (req.body?.tanggal && isDateStr(req.body.tanggal)) ? req.body.tanggal : todayLocal();
    const keterangan = String(req.body?.keterangan || '').trim();
    const diperbaikiOleh = String(req.body?.diperbaiki_oleh || req.user?.nama_lengkap || req.user?.username || '').trim();
    const master = getMasterItem(row.kode_barang);
    // Tambah kembali ke stok siap pakai
    if (master) {
      db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE id = ?").run(qty, master.id);
    } else {
      // Jika master hilang, buat entri baru? Tetap log transaksi tanpa master — buat item baru minimal
      // Lewati penambahan stok, cukup ledger
    }
    const harga = row.harga_barang;
    const itemForTrx = master || { kode_barang: row.kode_barang, nama_barang: row.nama_barang, jenis_barang: row.jenis_barang, satuan: row.satuan, harga_barang: harga };
    const trxNo = logStockMutation({
      jenis: 'MASUK',
      kategori: 'Perbaikan Barang Rusak',
      divisi: 'GUDANG',
      refId: row.id,
      lokasi: 'Gudang Rusak',
      item: itemForTrx,
      jumlah: qty,
      harga_satuan: harga,
      keterangan: keterangan || `Perbaikan ${row.kode_barang} — ${row.kondisi} kembali ke stok siap pakai`,
      tanggal: tgl,
      kondisi: 'Baik'
    });
    if (qty >= Number(row.jumlah)) {
      db.prepare("UPDATE damaged_items SET status = 'DIPERBAIKI', jumlah = 0, diperbaiki_oleh = ?, keterangan = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(diperbaikiOleh, keterangan || row.keterangan, row.id);
    } else {
      const sisa = round3(Number(row.jumlah) - qty);
      db.prepare("UPDATE damaged_items SET jumlah = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(sisa, row.id);
      // Buat entri DIPERBAIKI terpisah untuk audit trail (opsional)
      // Tidak perlu, cukup mutasi transaksi dan pengurangan qty
    }
    const updated = db.prepare('SELECT * FROM damaged_items WHERE id = ?').get(row.id);
    return { updated, trxNo, qty };
  });
  try {
    const r = transaction();
    res.json({ success: true, data: r.updated, message: `Perbaikan ${r.qty} unit berhasil — kembali ke stok siap pakai (${r.trxNo})` });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }
});

// POST pemusnahan — DITAMPUNG -> DIMUSNAHKAN (tidak kembali ke stok)
app.post('/api/damaged-items/:id/destroy', (req, res) => {
  const transaction = db.transaction(() => {
    const row = getDamagedOr404(req.params.id);
    if (row.status !== 'DITAMPUNG') throw new Error('Hanya barang DITAMPUNG yang bisa dimusnahkan');
    let qty = req.body?.jumlah !== undefined && req.body?.jumlah !== '' ? Number(req.body.jumlah) : Number(row.jumlah);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('jumlah pemusnahan harus lebih dari 0');
    if (qty > Number(row.jumlah)) throw new Error(`Jumlah pemusnahan melebihi stok rusak. Tersedia: ${row.jumlah}`);
    const tgl = (req.body?.tanggal && isDateStr(req.body.tanggal)) ? req.body.tanggal : todayLocal();
    const keterangan = String(req.body?.keterangan || '').trim();
    if (!keterangan) throw new Error('Keterangan / berita acara pemusnahan wajib diisi');
    const dimusnahkanOleh = String(req.body?.dimusnahkan_oleh || req.user?.nama_lengkap || req.user?.username || '').trim();
    const trxNo = logStockMutation({
      jenis: 'KELUAR',
      kategori: 'Pemusnahan Barang Afkir',
      divisi: 'GUDANG',
      refId: row.id,
      lokasi: 'Gudang Rusak',
      item: { kode_barang: row.kode_barang, nama_barang: row.nama_barang, jenis_barang: row.jenis_barang, satuan: row.satuan, harga_barang: row.harga_barang },
      jumlah: qty,
      harga_satuan: row.harga_barang,
      keterangan: `Pemusnahan ${row.kode_barang} — ${keterangan}`,
      tanggal: tgl,
      kondisi: 'Afkir'
    });
    // Ledger: tanpa menambah stok
    if (qty >= Number(row.jumlah)) {
      db.prepare("UPDATE damaged_items SET status = 'DIMUSNAHKAN', jumlah = 0, dimusnahkan_oleh = ?, keterangan = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(dimusnahkanOleh, keterangan, row.id);
    } else {
      const sisa = round3(Number(row.jumlah) - qty);
      db.prepare("UPDATE damaged_items SET jumlah = ?, updated_at = datetime('now','localtime') WHERE id = ?").run(sisa, row.id);
      // Buat entri terpisah untuk jejak pemusnahan sebagian
      const waktu = new Date().toTimeString().split(' ')[0];
      db.prepare(`
        INSERT INTO damaged_items (kode_barang, nama_barang, jenis_barang, satuan, harga_barang, jumlah, jumlah_awal, kondisi, status, sumber, sumber_id, sumber_nama, no_transaksi, keterangan, tanggal, waktu, dimusnahkan_oleh, dibuat_oleh)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DIMUSNAHKAN', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.kode_barang, row.nama_barang, row.jenis_barang, row.satuan, row.harga_barang, qty, qty, row.kondisi, row.sumber, row.sumber_id, row.sumber_nama, trxNo, keterangan, tgl, waktu, dimusnahkanOleh, dimusnahkanOleh);
    }
    const updated = db.prepare('SELECT * FROM damaged_items WHERE id = ?').get(row.id);
    return { updated, trxNo, qty };
  });
  try {
    const r = transaction();
    res.json({ success: true, data: r.updated, message: `Pemusnahan ${r.qty} unit dicatat (${r.trxNo}) — tidak kembali ke stok` });
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }
});

// ==========================================
// 6. BARCODE SCANNER & ASSET LOOKUP
// ==========================================

// Lookup scanned barcode / item code / serial number
app.get('/api/scanner/lookup/:code', (req, res) => {
  try {
    const rawCode = req.params.code.trim();
    // Search exact code or case-insensitive
    let item = db.prepare('SELECT * FROM items WHERE UPPER(kode_barang) = UPPER(?)').get(rawCode);
    let matchedBySN = false;

    if (!item) {
      // Check if rawCode matches a serial_number in customer_items, fo_items, or tower_items
      const ciMatch = db.prepare('SELECT kode_barang FROM customer_items WHERE UPPER(serial_number) = UPPER(?)').get(rawCode);
      const foMatch = !ciMatch && db.prepare('SELECT kode_barang FROM fo_items WHERE UPPER(serial_number) = UPPER(?)').get(rawCode);
      const twrMatch = !ciMatch && !foMatch && db.prepare('SELECT kode_barang FROM tower_items WHERE UPPER(serial_number) = UPPER(?)').get(rawCode);

      const matchedCode = ciMatch?.kode_barang || foMatch?.kode_barang || twrMatch?.kode_barang;
      if (matchedCode) {
        item = db.prepare('SELECT * FROM items WHERE UPPER(kode_barang) = UPPER(?)').get(matchedCode);
        matchedBySN = true;
      }
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        error: `Barang atau Nomor Seri (SN) "${rawCode}" tidak ditemukan di database`
      });
    }

    // 1. Where is it installed in Pelanggan?
    const inCustomers = db.prepare(`
      SELECT 
        c.id, c.id_pelanggan, c.nama_pelanggan, c.infrastruktur, c.paket, c.status, c.alamat, c.telepon,
        ci.jumlah, ci.satuan, ci.harga_barang, ci.subtotal, ci.serial_number, ci.tanggal_pasang
      FROM customer_items ci
      JOIN customers c ON ci.customer_id = c.id
      WHERE UPPER(ci.kode_barang) = UPPER(?)
      ORDER BY ci.id DESC
    `).all(item.kode_barang);

    // 2. Where is it installed in FO Sites?
    const inFO = db.prepare(`
      SELECT 
        f.id, f.daerah_lokasi, f.tipe_lokasi, f.pic_teknisi,
        fi.jumlah, fi.satuan, fi.harga_barang, fi.subtotal, fi.serial_number, fi.tanggal_pasang
      FROM fo_items fi
      JOIN fo_sites f ON fi.fo_id = f.id
      WHERE UPPER(fi.kode_barang) = UPPER(?)
      ORDER BY fi.id DESC
    `).all(item.kode_barang);

    // 3. Where is it installed in Tower Sites?
    const inTower = db.prepare(`
      SELECT 
        t.id, t.daerah_lokasi, t.jenis, t.type, t.ketinggian, t.kepemilikan, t.pic_teknisi,
        ti.jumlah, ti.satuan, ti.harga_barang, ti.subtotal, ti.serial_number, ti.tanggal_pasang
      FROM tower_items ti
      JOIN tower_sites t ON ti.tower_id = t.id
      WHERE UPPER(ti.kode_barang) = UPPER(?)
      ORDER BY ti.id DESC
    `).all(item.kode_barang);

    // 4. Recent transaction history for this item
    const recentTransactions = db.prepare(`
      SELECT * FROM transactions
      WHERE UPPER(kode_barang) = UPPER(?)
      ORDER BY tanggal DESC, id DESC
      LIMIT 15
    `).all(item.kode_barang);

    // Aggregates
    const totalInstalledCust = inCustomers.reduce((acc, cur) => acc + cur.jumlah, 0);
    const totalInstalledFO = inFO.reduce((acc, cur) => acc + cur.jumlah, 0);
    const totalInstalledTower = inTower.reduce((acc, cur) => acc + cur.jumlah, 0);
    const totalInstalled = totalInstalledCust + totalInstalledFO + totalInstalledTower;
    // Barang yang sedang dibawa teknisi (bon aktif) — masih aset perusahaan, bukan stok gudang
    const dibawaTeknisi = db.prepare(`
      SELECT l.id AS loan_id, l.no_bon, l.teknisi_nama, l.tanggal, l.status,
             (li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) AS sisa, li.satuan
      FROM technician_loan_items li JOIN technician_loans l ON l.id = li.loan_id
      WHERE li.kode_barang = ? AND l.status IN ('AKTIF', 'SEBAGIAN')
        AND (li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) > 0
      ORDER BY l.id DESC
    `).all(item.kode_barang);
    const totalTransit = dibawaTeknisi.reduce((acc, cur) => acc + cur.sisa, 0);
    const totalAssetStock = item.stok + totalInstalled + totalTransit;

    res.json({
      success: true,
      data: {
        item,
        matchedBySN,
        scannedCode: rawCode,
        distribution: {
          gudang_stock: item.stok,
          installed_pelanggan: totalInstalledCust,
          installed_fo: totalInstalledFO,
          installed_tower: totalInstalledTower,
          total_installed: totalInstalled,
          transit_teknisi: totalTransit,
          total_keseluruhan: totalAssetStock,
          total_nilai_aset: totalAssetStock * item.harga_barang
        },
        locations: {
          pelanggan: inCustomers,
          fo: inFO,
          tower: inTower,
          teknisi: dibawaTeknisi
        },
        transactions: recentTransactions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ==========================================
// 7. LAPORAN & REPORT ENGINE
// ==========================================

// Report Barang Terpasang (Installed Assets Matrix)
app.get('/api/reports/installed-assets', (req, res) => {
  try {
    const { divisi, search } = req.query;

    let items = db.prepare('SELECT * FROM items ORDER BY nama_barang ASC').all();

    if (search) {
      const s = search.toLowerCase();
      items = items.filter(it => 
        it.kode_barang.toLowerCase().includes(s) || 
        it.nama_barang.toLowerCase().includes(s) ||
        it.jenis_barang.toLowerCase().includes(s)
      );
    }

    const getCustItems = db.prepare(`
      SELECT c.id_pelanggan, c.nama_pelanggan, c.status, ci.jumlah, ci.satuan, ci.tanggal_pasang
      FROM customer_items ci
      JOIN customers c ON ci.customer_id = c.id
      WHERE UPPER(ci.kode_barang) = UPPER(?)
    `);

    const getFOItems = db.prepare(`
      SELECT f.daerah_lokasi, f.tipe_lokasi, fi.jumlah, fi.satuan, fi.tanggal_pasang
      FROM fo_items fi
      JOIN fo_sites f ON fi.fo_id = f.id
      WHERE UPPER(fi.kode_barang) = UPPER(?)
    `);

    const getTowerItems = db.prepare(`
      SELECT t.daerah_lokasi, t.jenis, t.type, ti.jumlah, ti.satuan, ti.tanggal_pasang
      FROM tower_items ti
      JOIN tower_sites t ON ti.tower_id = t.id
      WHERE UPPER(ti.kode_barang) = UPPER(?)
    `);

    const result = items.map(it => {
      const custs = getCustItems.all(it.kode_barang);
      const fos = getFOItems.all(it.kode_barang);
      const twrs = getTowerItems.all(it.kode_barang);

      const qtyPelanggan = custs.reduce((a, b) => a + b.jumlah, 0);
      const qtyFO = fos.reduce((a, b) => a + b.jumlah, 0);
      const qtyTower = twrs.reduce((a, b) => a + b.jumlah, 0);
      const totalTerpasang = qtyPelanggan + qtyFO + qtyTower;

      return {
        id: it.id,
        kode_barang: it.kode_barang,
        nama_barang: it.nama_barang,
        satuan: it.satuan,
        jenis_barang: it.jenis_barang,
        harga_barang: it.harga_barang,
        referensi_suplayer: it.referensi_suplayer,
        stok_gudang: it.stok,
        min_stok: it.min_stok,
        qty_pelanggan: qtyPelanggan,
        qty_fo: qtyFO,
        qty_tower: qtyTower,
        total_terpasang: totalTerpasang,
        total_semua: it.stok + totalTerpasang,
        nilai_gudang: it.stok * it.harga_barang,
        nilai_terpasang: totalTerpasang * it.harga_barang,
        nilai_total: (it.stok + totalTerpasang) * it.harga_barang,
        detail_pelanggan: custs,
        detail_fo: fos,
        detail_tower: twrs
      };
    });

    // Optional division filter: only items installed in that division
    let filteredResult = result;
    if (divisi === 'PELANGGAN') {
      filteredResult = result.filter(r => r.qty_pelanggan > 0);
    } else if (divisi === 'DIVISI FO') {
      filteredResult = result.filter(r => r.qty_fo > 0);
    } else if (divisi === 'DIVISI TOWER') {
      filteredResult = result.filter(r => r.qty_tower > 0);
    } else if (divisi === 'GUDANG') {
      filteredResult = result.filter(r => r.stok_gudang > 0);
    } else if (divisi === 'STOK_MENIPIS') {
      filteredResult = result.filter(r => r.stok_gudang <= r.min_stok);
    }

    res.json({ success: true, data: filteredResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Report Stok Gudang Logistik (Stok Gudang Keseluruhan yang Tersedia & Barang Stok Menipis)
app.get('/api/reports/warehouse-stock', (req, res) => {
  try {
    const { filter = 'tersedia', kategori, search } = req.query;

    const allItems = db.prepare('SELECT * FROM items ORDER BY nama_barang ASC').all();

    const custQtyRows = db.prepare('SELECT UPPER(kode_barang) as kode, COALESCE(SUM(jumlah), 0) as qty FROM customer_items GROUP BY UPPER(kode_barang)').all();
    const foQtyRows = db.prepare('SELECT UPPER(kode_barang) as kode, COALESCE(SUM(jumlah), 0) as qty FROM fo_items GROUP BY UPPER(kode_barang)').all();
    const towerQtyRows = db.prepare('SELECT UPPER(kode_barang) as kode, COALESCE(SUM(jumlah), 0) as qty FROM tower_items GROUP BY UPPER(kode_barang)').all();

    const custMap = new Map(custQtyRows.map(r => [r.kode, Number(r.qty) || 0]));
    const foMap = new Map(foQtyRows.map(r => [r.kode, Number(r.qty) || 0]));
    const towerMap = new Map(towerQtyRows.map(r => [r.kode, Number(r.qty) || 0]));

    const enriched = allItems.map(it => {
      const stok = Number(it.stok) || 0;
      const minStok = Number(it.min_stok) || 0;
      const harga = Number(it.harga_barang) || 0;
      const kodeKey = (it.kode_barang || '').toUpperCase();
      const qtyTerpasang = (custMap.get(kodeKey) || 0) + (foMap.get(kodeKey) || 0) + (towerMap.get(kodeKey) || 0);
      const statusStok = stok <= 0 ? 'HABIS' : (stok <= minStok ? 'MENIPIS' : 'AMAN');

      return {
        ...it,
        stok,
        min_stok: minStok,
        harga_barang: harga,
        nilai_stok: stok * harga,
        qty_terpasang: qtyTerpasang,
        total_aset: stok + qtyTerpasang,
        status_stok: statusStok,
        selisih_min: stok - minStok,
        kekurangan_stok: Math.max(0, minStok - stok)
      };
    });

    const summary = {
      total_sku: enriched.length,
      sku_tersedia: enriched.filter(i => i.stok > 0).length,
      total_stok_tersedia: enriched.filter(i => i.stok > 0).reduce((a, b) => a + b.stok, 0),
      total_nilai_gudang: enriched.reduce((a, b) => a + b.nilai_stok, 0),
      low_stock_count: enriched.filter(i => i.stok <= i.min_stok).length,
      out_of_stock_count: enriched.filter(i => i.stok <= 0).length,
      total_nilai_menipis: enriched.filter(i => i.stok <= i.min_stok).reduce((a, b) => a + b.nilai_stok, 0)
    };

    let filtered = enriched;

    if (filter === 'menipis') {
      filtered = filtered.filter(i => i.stok <= i.min_stok);
      filtered.sort((a, b) => a.stok - b.stok || a.nama_barang.localeCompare(b.nama_barang));
    } else if (filter === 'tersedia') {
      filtered = filtered.filter(i => i.stok > 0);
    }

    if (kategori) {
      const katLower = String(kategori).toLowerCase();
      filtered = filtered.filter(i => (i.jenis_barang || '').toLowerCase() === katLower);
    }

    if (search) {
      const s = String(search).toLowerCase();
      filtered = filtered.filter(i =>
        (i.kode_barang || '').toLowerCase().includes(s) ||
        (i.nama_barang || '').toLowerCase().includes(s) ||
        (i.jenis_barang || '').toLowerCase().includes(s) ||
        (i.referensi_suplayer || '').toLowerCase().includes(s) ||
        (i.catatan || '').toLowerCase().includes(s)
      );
    }

    const categories = [...new Set(allItems.map(i => i.jenis_barang).filter(Boolean))].sort();

    res.json({
      success: true,
      data: filtered,
      summary,
      categories
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Executive Dashboard & Valuation Summary
app.get('/api/reports/dashboard-summary', (req, res) => {
  try {
    const totalItems = db.prepare('SELECT COUNT(*) as c, SUM(stok) as total_stok, SUM(stok * harga_barang) as total_nilai_gudang FROM items').get();
    const lowStockItems = db.prepare('SELECT * FROM items WHERE stok <= min_stok ORDER BY stok ASC').all();

    const totalCust = db.prepare('SELECT COUNT(*) as c, SUM(total_harga) as total_nilai FROM customers').get();
    const totalFO = db.prepare('SELECT COUNT(*) as c, SUM(total_harga) as total_nilai FROM fo_sites').get();
    const totalTower = db.prepare('SELECT COUNT(*) as c, SUM(total_harga) as total_nilai FROM tower_sites').get();

    const custStatus = db.prepare(`
      SELECT status, COUNT(*) as count FROM customers GROUP BY status
    `).all();

    const infraBreakdown = db.prepare(`
      SELECT infrastruktur, COUNT(*) as count FROM customers GROUP BY infrastruktur
    `).all();

    // Recent 10 transactions
    const recentTx = db.prepare('SELECT * FROM transactions ORDER BY tanggal DESC, id DESC LIMIT 10').all();

    // Monthly transactions trend (last 6 months)
    const monthlyTrend = db.prepare(`
      SELECT 
        strftime('%Y-%m', tanggal) as bulan,
        SUM(CASE WHEN jenis = 'MASUK' THEN total_harga ELSE 0 END) as nilai_masuk,
        SUM(CASE WHEN jenis = 'KELUAR' THEN total_harga ELSE 0 END) as nilai_keluar,
        SUM(CASE WHEN jenis = 'MASUK' THEN jumlah ELSE 0 END) as qty_masuk,
        SUM(CASE WHEN jenis = 'KELUAR' THEN jumlah ELSE 0 END) as qty_keluar
      FROM transactions
      GROUP BY strftime('%Y-%m', tanggal)
      ORDER BY bulan DESC
      LIMIT 6
    `).all().reverse();

    // Barang yang sedang dibawa teknisi (bon berjalan) — masih aset, tapi di luar gudang
    const transit = db.prepare(`
      SELECT COUNT(DISTINCT l.id) AS bon_berjalan,
             COALESCE(SUM((li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) * li.harga_barang), 0) AS nilai_transit,
             COUNT(DISTINCT CASE WHEN (li.jumlah_dibawa - li.jumlah_terpasang - li.jumlah_kembali) > 0 THEN li.kode_barang END) AS jenis_barang
      FROM technician_loans l JOIN technician_loan_items li ON li.loan_id = l.id
      WHERE l.status IN ('AKTIF', 'SEBAGIAN')
    `).get();

    const damagedSummary = db.prepare(`
      SELECT status, COUNT(*) AS jumlah_entri, COALESCE(SUM(jumlah),0) AS total_qty, COALESCE(SUM(jumlah * harga_barang),0) AS total_nilai
      FROM damaged_items GROUP BY status
    `).all();
    const damagedTotal = db.prepare('SELECT COUNT(*) AS total_entri, COALESCE(SUM(jumlah),0) AS total_qty, COALESCE(SUM(jumlah * harga_barang),0) AS total_nilai FROM damaged_items').get();
    const damagedByKondisi = db.prepare(`
      SELECT kondisi, COUNT(*) AS jumlah_entri, COALESCE(SUM(jumlah),0) AS total_qty FROM damaged_items GROUP BY kondisi
    `).all();
    const grandTotalValuation = (transit.nilai_transit || 0) + (totalItems.total_nilai_gudang || 0) + 
                                (totalCust.total_nilai || 0) + 
                                (totalFO.total_nilai || 0) + 
                                (totalTower.total_nilai || 0);

    res.json({
      success: true,
      data: {
        damaged: {
          total_entri: damagedTotal.total_entri || 0,
          total_qty: damagedTotal.total_qty || 0,
          total_nilai: damagedTotal.total_nilai || 0,
          per_status: damagedSummary,
          per_kondisi: damagedByKondisi
        },
        warehouse: {
          total_skus: totalItems.c,
          total_stok: totalItems.total_stok || 0,
          total_nilai: totalItems.total_nilai_gudang || 0,
          low_stock_count: lowStockItems.length,
          low_stock_list: lowStockItems
        },
        pelanggan: {
          total_pelanggan: totalCust.c,
          total_nilai: totalCust.total_nilai || 0,
          status_breakdown: custStatus,
          infra_breakdown: infraBreakdown
        },
        fo: {
          total_sites: totalFO.c,
          total_nilai: totalFO.total_nilai || 0
        },
        tower: {
          total_sites: totalTower.c,
          total_nilai: totalTower.total_nilai || 0
        },
        teknisi: {
          bon_berjalan: transit.bon_berjalan || 0,
          jenis_barang: transit.jenis_barang || 0,
          nilai_transit: transit.nilai_transit || 0
        },
        grand_total_valuation: grandTotalValuation,
        recent_transactions: recentTx,
        monthly_trend: monthlyTrend
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reseed demo data endpoint
app.post('/api/reset-seed', (req, res) => {
  try {
    const resetTx = db.transaction(() => {
      db.exec(`
        DELETE FROM technician_loan_movements;
        DELETE FROM technician_loan_items;
        DELETE FROM technician_loans;
        DELETE FROM customer_items;
        DELETE FROM customers;
        DELETE FROM fo_items;
        DELETE FROM fo_sites;
        DELETE FROM tower_items;
        DELETE FROM tower_sites;
        DELETE FROM transactions;
        DELETE FROM damaged_items;
        DELETE FROM items;
      `);
      seedData();
    });
    resetTx();
    // Reset seed adalah tindakan eksplisit untuk mengembalikan data contoh,
    // jadi marker pengosongan harus ikut dihapus agar restart berikutnya normal.
    fs.rmSync(CLEARED_MARKER_PATH, { force: true });
    res.json({ success: true, message: 'Data berhasil direset dan diisi ulang dengan data simulasi ISP' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// CADANGAN & PEMULIHAN DATABASE (khusus Administrator)
// ==========================================
// - GET  /api/admin/database/info     → ukuran DB, jumlah data per tabel, daftar cadangan, deteksi systemd
// - GET  /api/admin/database/backup   → unduh salinan konsisten (VACUUM INTO + integrity_check)
// - POST /api/admin/database/restore  → unggah berkas .db pengganti; DB lama dicadangkan dulu,
//                                       lalu proses keluar agar systemd (Restart=always) memuat DB baru.
//
// Semua akses non-GET ke /api/admin/* sudah dibatasi WRITE_RULES ke peran admin;
// endpoint GET di sini juga dicek eksplisit karena mengekspos seluruh isi database.

const RESTORE_CONFIRM_WORD = 'PULIHKAN';
const CLEAR_CONFIRM_WORD = 'KOSONGKAN';
const RESTORE_MAX_BYTES = 512 * 1024 * 1024; // 512 MB
const CLEAR_DATA_TABLES = [
  'technician_loan_movements',
  'technician_loan_items',
  'technician_loans',
  'technicians',
  'customer_items',
  'customers',
  'fo_items',
  'fo_sites',
  'tower_items',
  'tower_sites',
  'transactions',
  'damaged_items',
  'items',
  'categories'
];
// Tabel inti yang wajib ada pada berkas yang dipulihkan (tabel baru seperti Bon
// Teknisi akan dibuat otomatis oleh initDb() saat server menyala kembali).
const RESTORE_REQUIRED_TABLES = ['categories', 'items', 'customers', 'customer_items', 'fo_sites', 'fo_items', 'tower_sites', 'tower_items', 'transactions', 'users'];
const SQLITE_MAGIC = 'SQLite format 3\u0000';

function requireAdmin(req, res) {
  if (req.user?.role === 'admin') return true;
  res.status(403).json({ success: false, error: 'Akses ditolak: hanya Administrator yang boleh mengelola cadangan database.' });
  return false;
}

/** Tulis marker secara atomik agar server tidak pernah melihat berkas setengah jadi. */
function writeClearedMarker(contents) {
  const temporary = `${CLEARED_MARKER_PATH}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, 'utf8');
    fs.renameSync(temporary, CLEARED_MARKER_PATH);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function stampForFile(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** Hapus berkas beserta pendamping SQLite-nya (-wal/-shm/-journal yang bisa muncul saat berkas dibuka). */
function hapusBerkasSqlite(file) {
  for (const ext of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${file}${ext}`, { force: true });
}

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** Buat salinan konsisten DB aktif ke `target` (aman walau mode WAL), wajib lolos integrity_check. */
function snapshotDatabase(target) {
  if (fs.existsSync(target)) fs.unlinkSync(target);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  const check = new DatabaseSync(target, { readOnly: true });
  try {
    const row = check.prepare('PRAGMA integrity_check').get();
    const hasil = row ? Object.values(row)[0] : null;
    if (hasil !== 'ok') throw new Error(`Salinan cadangan tidak lolos integrity_check: ${hasil}`);
  } finally {
    check.close();
    for (const ext of ['-wal', '-shm', '-journal']) fs.rmSync(`${target}${ext}`, { force: true });
  }
  return fs.statSync(target).size;
}

/** Daftar berkas cadangan di data/backups (terbaru dulu). */
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { nama: f, ukuran: st.size, dibuat: localStamp(st.mtime) };
    })
    .sort((a, b) => (a.dibuat < b.dibuat ? 1 : -1))
    .slice(0, 20);
}

function countTables(conn) {
  const counts = {};
  for (const t of ['items', 'categories', 'customers', 'fo_sites', 'tower_sites', 'transactions', 'users', 'technicians', 'technician_loans']) {
    try {
      counts[t] = conn.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    } catch {
      counts[t] = null; // tabel belum ada (cadangan versi lama)
    }
  }
  return counts;
}

app.post('/api/admin/database/clear', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const konfirmasi = String(req.body?.konfirmasi || req.query?.konfirmasi || req.headers['x-konfirmasi'] || '');
  if (konfirmasi !== CLEAR_CONFIRM_WORD) {
    return res.status(400).json({
      success: false,
      error: `Pengosongan database harus dikonfirmasi dengan kata ${CLEAR_CONFIRM_WORD}.`
    });
  }

  let markerSebelumnya = null;
  let markerAdaSebelumnya = false;
  let backupPath = '';
  try {
    // Backup konsisten harus selesai sebelum ada data yang dihapus (DB memakai WAL).
    ensureBackupDir();
    const stem = `sebelum-kosongkan-${stampForFile()}`;
    backupPath = path.join(BACKUP_DIR, `${stem}.db`);
    let suffix = 1;
    while (fs.existsSync(backupPath)) {
      backupPath = path.join(BACKUP_DIR, `${stem}-${suffix}.db`);
      suffix++;
    }
    const ukuranBackup = snapshotDatabase(backupPath);

    markerAdaSebelumnya = fs.existsSync(CLEARED_MARKER_PATH);
    if (markerAdaSebelumnya) markerSebelumnya = fs.readFileSync(CLEARED_MARKER_PATH);
    const markerIsi = `${JSON.stringify({
      clearedAt: localStamp(new Date()),
      clearedBy: req.user.username,
      backup: path.basename(backupPath)
    }, null, 2)}\n`;

    // Pasang marker SEBELUM transaksi hapus. Bila proses mati sesudah commit tetapi
    // sebelum restart, seed tidak akan mengisi ulang database yang sengaja dikosongkan.
    writeClearedMarker(markerIsi);

    try {
      const clear = db.transaction(() => {
        for (const table of CLEAR_DATA_TABLES) {
          db.prepare(`DELETE FROM ${table}`).run();
        }
      });
      clear();
    } catch (clearError) {
      // Jika transaksi gagal, pulihkan keadaan marker sebelumnya bersama database.
      try {
        if (markerAdaSebelumnya) writeClearedMarker(markerSebelumnya);
        else fs.rmSync(CLEARED_MARKER_PATH, { force: true });
      } catch (markerError) {
        console.error('[clear] Gagal memulihkan marker pengosongan:', markerError.message);
      }
      throw clearError;
    }

    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* WAL tetap aman bila checkpoint tertunda */ }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      message: 'Semua data operasional berhasil dikosongkan. Akun pengguna tetap dipertahankan.',
      data: {
        backup: path.basename(backupPath),
        ukuranBackup,
        counts: countTables(db),
        usersDipertahankan: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
        marker: path.basename(CLEARED_MARKER_PATH)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: `Gagal mengosongkan database: ${err.message}` });
  }
});

/**
 * Validasi berkas kandidat pemulihan. Mengembalikan { counts, adminAktif } bila sah,
 * melempar Error berpesan Bahasa Indonesia bila tidak.
 */
function validateRestoreCandidate(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(16);
  try {
    fs.readSync(fd, head, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (head.toString('latin1') !== SQLITE_MAGIC) {
    throw new Error('Berkas yang diunggah bukan database SQLite (header tidak dikenali).');
  }
  const conn = new DatabaseSync(filePath, { readOnly: true });
  try {
    const row = conn.prepare('PRAGMA integrity_check').get();
    const hasil = row ? Object.values(row)[0] : null;
    if (hasil !== 'ok') throw new Error(`Berkas database rusak (integrity_check: ${hasil}).`);

    const ada = new Set(conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
    const hilang = RESTORE_REQUIRED_TABLES.filter((t) => !ada.has(t));
    if (hilang.length) {
      throw new Error(`Berkas bukan database SIM-ASET: tabel wajib tidak ditemukan (${hilang.join(', ')}).`);
    }
    const adminAktif = conn.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND status = 'aktif'").get().c;
    if (!adminAktif) {
      throw new Error('Berkas ditolak: tidak ada akun Administrator aktif di dalamnya — pemulihan akan mengunci semua orang keluar.');
    }
    return { counts: countTables(conn), adminAktif };
  } finally {
    conn.close();
  }
}

app.get('/api/admin/database/info', (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const st = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
    const walPath = `${DB_PATH}-wal`;
    const walSize = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
    const journal = db.prepare('PRAGMA journal_mode').get();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        path: DB_PATH,
        ukuran: st ? st.size : 0,
        ukuranWal: walSize,
        diubah: st ? localStamp(st.mtime) : null,
        journalMode: journal ? Object.values(journal)[0] : null,
        counts: countTables(db),
        cadangan: listBackups(),
        // systemd mengisi INVOCATION_ID untuk setiap layanan yang dijalankannya.
        // Pemulihan hanya aman bila proses dihidupkan ulang otomatis (Restart=always).
        systemd: Boolean(process.env.INVOCATION_ID),
        kataKonfirmasi: RESTORE_CONFIRM_WORD,
        batasUnggahBytes: RESTORE_MAX_BYTES
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/database/backup', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const stamp = stampForFile();
  const tmp = path.join(path.dirname(DB_PATH), `.backup-${stamp}-${process.pid}.db`);
  try {
    const size = snapshotDatabase(tmp);
    const filename = `sim-aset-${stamp}.db`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Length', String(size));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Filename', filename);
    // pipeline() menjamin callback terpanggil baik unduhan selesai maupun koneksi
    // putus di tengah (proxy/browser menutup lebih dulu) — berkas sementara selalu dihapus.
    // (stream.pipe() tidak menutup sumber bila tujuan ditutup lebih dulu → berkas bocor.)
    pipeline(fs.createReadStream(tmp), res, (err) => {
      hapusBerkasSqlite(tmp);
      if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
        console.error('[backup] Gagal mengirim cadangan:', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      }
    });
  } catch (err) {
    hapusBerkasSqlite(tmp);
    res.status(500).json({ success: false, error: `Gagal membuat cadangan: ${err.message}` });
  }
});

app.post('/api/admin/database/restore', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const konfirmasi = String(req.query?.konfirmasi || req.headers['x-konfirmasi'] || '');
  if (konfirmasi !== RESTORE_CONFIRM_WORD) {
    return res.status(400).json({ success: false, error: `Pemulihan harus dikonfirmasi dengan kata ${RESTORE_CONFIRM_WORD}.` });
  }
  const panjangDiumumkan = Number(req.headers['content-length'] || 0);
  if (panjangDiumumkan > RESTORE_MAX_BYTES) {
    return res.status(413).json({ success: false, error: `Berkas terlalu besar (maks ${Math.round(RESTORE_MAX_BYTES / 1048576)} MB).` });
  }

  const stamp = stampForFile();
  const dataDir = path.dirname(DB_PATH);
  const kandidat = path.join(dataDir, `.restore-${stamp}-${process.pid}.db`);
  const cadanganLama = path.join(BACKUP_DIR, `sebelum-pulihkan-${stamp}.db`);

  // Unggahan dialirkan LANGSUNG ke berkas sementara, tidak ditampung di memori
  // (LXC Proxmox sering ber-RAM kecil; express.raw akan menampung seluruh berkas).
  let total = 0;
  const pembatas = new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > RESTORE_MAX_BYTES) {
        const e = new Error(`Berkas terlalu besar (maks ${Math.round(RESTORE_MAX_BYTES / 1048576)} MB).`);
        e.statusCode = 413;
        return cb(e);
      }
      cb(null, chunk);
    }
  });

  pipeline(req, pembatas, fs.createWriteStream(kandidat), (errUnggah) => {
    if (errUnggah) {
      hapusBerkasSqlite(kandidat);
      if (res.headersSent || (req.destroyed && errUnggah.code === 'ERR_STREAM_PREMATURE_CLOSE')) return;
      return res.status(errUnggah.statusCode || 400).json({ success: false, error: errUnggah.statusCode ? errUnggah.message : `Unggahan terputus: ${errUnggah.message}` });
    }
    if (total < 1024) {
      hapusBerkasSqlite(kandidat);
      return res.status(400).json({ success: false, error: 'Berkas database tidak diterima atau terlalu kecil. Unggah berkas .db hasil Unduh Cadangan.' });
    }

    try {
      const info = validateRestoreCandidate(kandidat);

      // 1) Amankan DB yang sedang berjalan ke data/backups
      ensureBackupDir();
      snapshotDatabase(cadanganLama);

      // 2) Tutup koneksi, buang WAL/SHM lama, tukar berkas — mulai sekarang server
      //    tidak melayani request lain (lihat middleware serverRestarting).
      serverRestarting = true;
      try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* abaikan */ }
      db.close();
      for (const ext of ['-wal', '-shm', '-journal']) fs.rmSync(`${DB_PATH}${ext}`, { force: true });
      fs.renameSync(kandidat, DB_PATH);
      // Berkas pendamping kandidat (muncul bila berkas unggahan ber-mode WAL) tidak boleh tertinggal
      for (const ext of ['-wal', '-shm', '-journal']) fs.rmSync(`${kandidat}${ext}`, { force: true });

      console.log(`[restore] Database dipulihkan oleh ${req.user.username} dari unggahan ${total} byte; DB lama disimpan di ${cadanganLama}. Proses keluar agar dimuat ulang oleh systemd.`);
      res.json({
        success: true,
        message: 'Database berhasil dipulihkan. Server memulai ulang — halaman akan dimuat ulang otomatis.',
        data: {
          cadanganLama: path.basename(cadanganLama),
          counts: info.counts,
          restart: true,
          systemd: Boolean(process.env.INVOCATION_ID)
        }
      });
      // Beri waktu respons terkirim, lalu keluar. systemd (Restart=always) akan menyalakan
      // ulang proses dengan DB baru; tanpa supervisor proses TIDAK hidup lagi dengan sendirinya.
      setTimeout(() => process.exit(0), 700).unref();
    } catch (err) {
      hapusBerkasSqlite(kandidat);
      if (serverRestarting) {
        // Gagal setelah koneksi ditutup — kondisi tidak bisa dilanjutkan, biarkan supervisor menyalakan ulang.
        console.error('[restore] Gagal di tahap penukaran berkas:', err);
        res.status(500).json({ success: false, error: `Pemulihan gagal di tahap akhir: ${err.message}. Server memulai ulang dengan DB lama/cadangan.` });
        setTimeout(() => process.exit(1), 700).unref();
        return;
      }
      res.status(400).json({ success: false, error: err.message });
    }
  });
});

// ==========================================
// PENANGANAN AKHIR UNTUK /api: 404 JSON & error terpusat
// ==========================================
// Rute /api yang tidak dikenal jangan sampai jatuh ke fallback SPA (200 + index.html).
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: `Endpoint ${req.method} /api${req.path === '/' ? '' : req.path} tidak ditemukan.` });
});

// Error yang lolos dari handler (JSON rusak, body terlalu besar, exception tak tertangkap)
// dibalas JSON ber-Bahasa Indonesia — bukan halaman HTML Express berisi stack trace.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return res.destroy(err);
  const status = Number(err.status || err.statusCode) || 500;
  let pesan;
  if (err.type === 'entity.parse.failed') pesan = 'Format JSON pada permintaan tidak valid.';
  else if (err.type === 'entity.too.large') pesan = `Data yang dikirim terlalu besar (maks ${err.limit ? Math.round(err.limit / 1048576) + ' MB' : 'batas server'}). Pecah menjadi beberapa bagian.`;
  else if (status >= 500) pesan = 'Terjadi kesalahan di server. Coba lagi atau hubungi Administrator.';
  else pesan = err.message || 'Permintaan tidak dapat diproses.';
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (req.path.startsWith('/api/') || req.originalUrl.startsWith('/api/')) {
    return res.status(status).json({ success: false, error: pesan });
  }
  res.status(status).type('text/plain').send(pesan);
});

// Serve frontend static build if available
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath, {
  setHeaders(res, filePath) {
    // index.html & build-info.json selalu divalidasi ulang agar browser langsung
    // memakai versi baru setelah update; aset ber-hash boleh di-cache lama.
    const base = path.basename(filePath);
    if (base === 'index.html' || base === 'build-info.json') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Fallback to index.html for client-side routing
app.use((req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  } else {
    res.send('API server is running. Frontend build in progress...');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
