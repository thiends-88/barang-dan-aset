import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db, { initDb } from './db.js';
import { seedData, seedUsers } from './seed.js';
import { ROLES, hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { getGitInfo, readPackageVersion, localStamp } from '../scripts/build-info.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB and Seed data
initDb();
seedData();
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

// ==========================================
// MIDDLEWARE OTENTIKASI & HIRARKI PERAN
// ==========================================

// Jalur yang boleh diakses tanpa login
const PUBLIC_PATHS = [
  /^\/api\/auth\/login$/,
  /^\/api\/health$/, // diagnostik waktu server — berguna cek sinkron jam
  /^\/api\/version$/, // info versi terpasang — dipakai skrip update & VersionBadge
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
function logStockMutation({ jenis, kategori, divisi, refId = null, lokasi, item, jumlah, harga_satuan, keterangan = '' }) {
  const now = new Date();
  const tanggal = todayLocal();
  const harga = Number(harga_satuan !== undefined ? harga_satuan : (item.harga_barang || 0));
  db.prepare(`
    INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, serial_number, keterangan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateTrxNumber(jenis, tanggal),
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
    keterangan
  );
}

/**
 * Sinkronkan barang terpasang pada satu data divisi (pelanggan / FO / tower).
 * Baris lama diganti baris baru, lalu stok gudang disesuaikan berdasarkan SELISIH,
 * sehingga tidak ada stok yang hilang/tertahan dan setiap selisih tercatat sebagai mutasi.
 */
function reconcileInstalledItems({ table, fkColumn, ownerId, oldItems, validatedItems, divisi, refId, lokasiPenerima, label }) {
  const oldQtyByCode = sumQtyByCode(oldItems);
  const newQtyByCode = sumQtyByCode(validatedItems);

  db.prepare(`DELETE FROM ${table} WHERE ${fkColumn} = ?`).run(ownerId);
  const insert = db.prepare(`
    INSERT INTO ${table} (${fkColumn}, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, serial_number, referensi_suplayer, tanggal_pasang)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const it of validatedItems) {
    insert.run(ownerId, it.kode_barang, it.nama_barang, it.jenis_barang, it.satuan, it.jumlah, it.harga_barang, it.subtotal, it.serial_number, it.referensi_suplayer, it.tanggal_pasang);
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
    const items = db.prepare(`
      SELECT * FROM items 
      ORDER BY id DESC
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
    const {
      kode_barang,
      nama_barang,
      satuan = 'unit',
      jenis_barang,
      stok = 0,
      min_stok = 5,
      harga_barang = 0,
      referensi_suplayer = '',
      catatan = ''
    } = req.body;

    if (!kode_barang || !nama_barang || !jenis_barang) {
      return res.status(400).json({ success: false, error: 'Kode, nama, dan jenis barang wajib diisi' });
    }

    // Check duplicate code
    const existing = db.prepare('SELECT id FROM items WHERE LOWER(kode_barang) = LOWER(?)').get(kode_barang.trim());
    if (existing) {
      return res.status(400).json({ success: false, error: `Kode barang "${kode_barang}" sudah digunakan` });
    }

    const createItemTx = db.transaction(() => {
      const insert = db.prepare(`
        INSERT INTO items (kode_barang, nama_barang, satuan, jenis_barang, stok, min_stok, harga_barang, referensi_suplayer, catatan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = insert.run(
        kode_barang.trim().toUpperCase(),
        nama_barang.trim(),
        satuan.trim(),
        jenis_barang.trim(),
        Number(stok) || 0,
        Number(min_stok) || 0,
        Number(harga_barang) || 0,
        referensi_suplayer.trim(),
        catatan.trim()
      );

      const newItemId = result.lastInsertRowid;

      // Auto-register category into categories table if new
      try {
        db.prepare('INSERT OR IGNORE INTO categories (nama_kategori) VALUES (?)').run(jenis_barang.trim());
      } catch {}

      // Log stock-in transaction if initial stock > 0
      if (Number(stok) > 0) {
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
          kode_barang.trim().toUpperCase(),
          nama_barang.trim(),
          satuan.trim(),
          Number(stok),
          Number(harga_barang) || 0,
          (Number(stok) * Number(harga_barang)) || 0,
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
app.put('/api/items/:id', (req, res) => {
  try {
    const { id } = req.params;
    const {
      kode_barang,
      nama_barang,
      satuan,
      jenis_barang,
      stok,
      min_stok,
      harga_barang,
      referensi_suplayer,
      catatan
    } = req.body;

    const current = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Barang tidak ditemukan' });
    }

    // Check duplicate code if changed
    if (kode_barang && kode_barang.toUpperCase() !== current.kode_barang) {
      const dup = db.prepare('SELECT id FROM items WHERE LOWER(kode_barang) = LOWER(?) AND id != ?').get(kode_barang.trim(), id);
      if (dup) {
        return res.status(400).json({ success: false, error: `Kode barang "${kode_barang}" sudah digunakan` });
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
      kode_barang ? kode_barang.trim().toUpperCase() : current.kode_barang,
      nama_barang ? nama_barang.trim() : current.nama_barang,
      satuan ? satuan.trim() : current.satuan,
      jenis_barang ? jenis_barang.trim() : current.jenis_barang,
      stok !== undefined ? Number(stok) : current.stok,
      min_stok !== undefined ? Number(min_stok) : current.min_stok,
      harga_barang !== undefined ? Number(harga_barang) : current.harga_barang,
      referensi_suplayer !== undefined ? referensi_suplayer.trim() : current.referensi_suplayer,
      catatan !== undefined ? catatan.trim() : current.catatan,
      id
    );

    // Auto-register category into categories table if new
    if (jenis_barang) {
      try {
        db.prepare('INSERT OR IGNORE INTO categories (nama_kategori) VALUES (?)').run(jenis_barang.trim());
      } catch {}
    }

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal)) return fail(`Tanggal pasang "${tanggal}" tidak valid, gunakan format YYYY-MM-DD [${idPel}]`);

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

    const installDate = tanggal_pasang || todayLocal();

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

    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(id);
      const installDate = tanggal_pasang || current.tanggal_pasang;
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
      tanggal_pasang || current.tanggal_pasang,
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
app.post('/api/customers/:id/dismantle', (req, res) => {
  const transaction = db.transaction(() => {
    const { id } = req.params;
    const { keterangan = 'Dismantle perangkat pelanggan putus langganan' } = req.body;

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
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const it of items) {
      // Return stock to warehouse
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Incoming transaction
      const trxNo = generateTrxNumber('MASUK', tanggal);
      insertTrx.run(
        trxNo,
        tanggal,
        waktu,
        'MASUK',
        'Pengembalian / Dismantle',
        'PELANGGAN',
        id,
        `${cust.nama_pelanggan} (${cust.id_pelanggan})`,
        it.kode_barang,
        it.nama_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        `${keterangan} - Barang ditarik kembali ke gudang`
      );
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

    const installDate = tanggal_pasang || todayLocal();

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

    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?').all(id);
      const installDate = tanggal_pasang || current.tanggal_pasang;
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
      tanggal_pasang || current.tanggal_pasang,
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

    const installDate = tanggal_pasang || todayLocal();

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

    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      const oldItems = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?').all(id);
      const installDate = tanggal_pasang || current.tanggal_pasang;
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
      tanggal_pasang || current.tanggal_pasang,
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
      search
    } = req.query;

    let query = 'SELECT * FROM transactions WHERE 1=1';
    const params = [];

    // Date range
    if (start_date && end_date) {
      query += ' AND tanggal >= ? AND tanggal <= ?';
      params.push(start_date, end_date);
    } else if (start_date) {
      query += ' AND tanggal >= ?';
      params.push(start_date);
    } else if (end_date) {
      query += ' AND tanggal <= ?';
      params.push(end_date);
    }

    // Specific Year filter
    if (year) {
      query += " AND strftime('%Y', tanggal) = ?";
      params.push(String(year));
    }

    // Specific Month filter (1-12)
    if (month && year) {
      const formattedMonth = String(month).padStart(2, '0');
      query += " AND strftime('%Y-%m', tanggal) = ?";
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

      query += ' AND tanggal >= ? AND tanggal <= ?';
      params.push(sDate, eDate);
    }

    // Divisi filter
    if (divisi && divisi !== 'SEMUA') {
      query += ' AND UPPER(divisi) = UPPER(?)';
      params.push(divisi);
    }

    // Jenis filter (MASUK / KELUAR)
    if (jenis && (jenis === 'MASUK' || jenis === 'KELUAR')) {
      query += ' AND jenis = ?';
      params.push(jenis);
    }

    // Keyword search
    if (search) {
      query += ' AND (kode_barang LIKE ? OR nama_barang LIKE ? OR no_transaksi LIKE ? OR lokasi_penerima LIKE ? OR keterangan LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }

    query += ' ORDER BY tanggal DESC, id DESC';

    const txs = db.prepare(query).all(...params);

    // Compute summary metrics
    let totalMasukQty = 0;
    let totalMasukNilai = 0;
    let totalKeluarQty = 0;
    let totalKeluarNilai = 0;

    for (const t of txs) {
      if (t.jenis === 'MASUK') {
        totalMasukQty += t.jumlah;
        totalMasukNilai += t.total_harga;
      } else {
        totalKeluarQty += t.jumlah;
        totalKeluarNilai += t.total_harga;
      }
    }

    res.json({
      success: true,
      data: txs,
      summary: {
        total_transaksi: txs.length,
        total_masuk_qty: totalMasukQty,
        total_masuk_nilai: totalMasukNilai,
        total_keluar_qty: totalKeluarQty,
        total_keluar_nilai: totalKeluarNilai,
        net_qty: totalMasukQty - totalKeluarQty,
        net_nilai: totalMasukNilai - totalKeluarNilai
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
      serial_number = ''  // opsional: SN unit (pelacakan di tujuan)
    } = req.body;

    if (!jenis || !kode_barang || !jumlah) {
      throw new Error('Jenis transaksi, kode barang, dan jumlah wajib diisi');
    }

    const item = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(kode_barang.trim());
    if (!item) {
      throw new Error(`Barang dengan kode "${kode_barang}" tidak ditemukan`);
    }

    const qty = Number(jumlah);
    if (qty <= 0) {
      throw new Error('Jumlah harus lebih dari 0');
    }

    const now = new Date();
    const tgl = tanggal || todayLocal();
    const waktu = now.toTimeString().split(' ')[0];
    const isMasuk = jenis === 'MASUK';
    const sn = (serial_number || '').toString().trim();

    const linkCfg = LINKED_DIVISI[divisi] || null;
    const isLinked = !!linkCfg && !!tujuan_id;

    const insertTrxFull = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, serial_number, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

        db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);

        const trxNo = generateTrxNumber('MASUK', tgl);
        insertTrxFull.run(
          trxNo, tgl, waktu, 'MASUK',
          kategori_transaksi || `Pengembalian ${linkCfg.label}`,
          divisi, owner.id, ownerName,
          item.kode_barang, item.nama_barang, item.satuan, qty,
          item.harga_barang, qty * item.harga_barang, sn,
          keterangan.trim() || `Pengembalian dari ${linkCfg.label.toLowerCase()} ${ownerName}`
        );
        var hasilTrx = { trxNo, item, qty, isMasuk, terhubung: `${linkCfg.label} — ${ownerName}` };
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
          kategori_transaksi || `Pemasangan ${linkCfg.label}`,
          divisi, owner.id, ownerName,
          item.kode_barang, item.nama_barang, item.satuan, qty,
          item.harga_barang, qty * item.harga_barang, sn,
          keterangan.trim() || `Pemasangan di ${linkCfg.label.toLowerCase()} ${ownerName}`
        );
        var hasilTrx = { trxNo, item, qty, isMasuk, terhubung: `${linkCfg.label} — ${ownerName}` };
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
    if (!lokasi_penerima) {
      throw new Error('Lokasi / penerima / suplayer wajib diisi');
    }

    if (!isMasuk && item.stok < qty) {
      throw new Error(`Stok gudang tidak cukup. Sisa: ${item.stok} ${item.satuan}, diminta: ${qty}`);
    }

    // Update stock
    if (isMasuk) {
      db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);
    } else {
      db.prepare("UPDATE items SET stok = stok - ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(qty, item.id);
    }

    const subtotal = qty * item.harga_barang;
    const trxNo = generateTrxNumber(isMasuk ? 'MASUK' : 'KELUAR', tgl);

    insertTrxFull.run(
      trxNo,
      tgl,
      waktu,
      isMasuk ? 'MASUK' : 'KELUAR',
      kategori_transaksi || (isMasuk ? 'Pembelian Supplier' : 'Mutasi'),
      divisi,
      item.id,
      lokasi_penerima.trim(),
      item.kode_barang,
      item.nama_barang,
      item.satuan,
      qty,
      item.harga_barang,
      subtotal,
      sn,
      keterangan.trim()
    );

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
    const totalAssetStock = item.stok + totalInstalled;

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
          total_keseluruhan: totalAssetStock,
          total_nilai_aset: totalAssetStock * item.harga_barang
        },
        locations: {
          pelanggan: inCustomers,
          fo: inFO,
          tower: inTower
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

    const grandTotalValuation = (totalItems.total_nilai_gudang || 0) + 
                                (totalCust.total_nilai || 0) + 
                                (totalFO.total_nilai || 0) + 
                                (totalTower.total_nilai || 0);

    res.json({
      success: true,
      data: {
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
        DELETE FROM customer_items;
        DELETE FROM customers;
        DELETE FROM fo_items;
        DELETE FROM fo_sites;
        DELETE FROM tower_items;
        DELETE FROM tower_sites;
        DELETE FROM transactions;
        DELETE FROM items;
      `);
      seedData();
    });
    resetTx();
    res.json({ success: true, message: 'Data berhasil direset dan diisi ulang dengan data simulasi ISP' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
