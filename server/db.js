import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Zona waktu aplikasi — HARUS di-set sebelum pemakaian Date/SQLite mana pun
// agar 'localtime' SQLite dan new Date() sama-sama menghasilkan WIB.
// Bisa diganti lewat env APP_TZ saat deploy ke zona lain (WITA/WIT).
process.env.TZ = process.env.APP_TZ || process.env.TZ || 'Asia/Jakarta';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'inventory.db');
const db = new DatabaseSync(dbPath);

// Enable foreign keys and WAL mode for maximum performance & reliability
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Transaction wrapper identical to better-sqlite3
db.transaction = (fn) => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    const res = fn(...args);
    db.exec('COMMIT');
    return res;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export function initDb() {
  db.exec(`
    -- Master Kategori / Jenis Barang Dinamis
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama_kategori TEXT UNIQUE NOT NULL,
      deskripsi TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Master Data Barang
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode_barang TEXT UNIQUE NOT NULL,
      nama_barang TEXT NOT NULL,
      satuan TEXT NOT NULL DEFAULT 'unit',
      jenis_barang TEXT NOT NULL,
      stok REAL NOT NULL DEFAULT 0,
      min_stok REAL NOT NULL DEFAULT 5,
      harga_barang REAL NOT NULL DEFAULT 0,
      referensi_suplayer TEXT DEFAULT '',
      catatan TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Divisi Pelanggan
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      id_pelanggan TEXT UNIQUE NOT NULL,
      nama_pelanggan TEXT NOT NULL,
      infrastruktur TEXT NOT NULL DEFAULT 'optic', -- 'wireless' | 'optic'
      paket TEXT NOT NULL DEFAULT 'home', -- personal, home, family, middle, soho, small, little, bronze, free, parallel, custom, dedicated
      keterangan_paket TEXT DEFAULT '',
      kategori TEXT NOT NULL DEFAULT 'bandwidth', -- bandwidth, rent, service, lainnya
      status TEXT NOT NULL DEFAULT 'aktif', -- aktif, blokir, cuti, putus
      alamat TEXT DEFAULT '',
      telepon TEXT DEFAULT '',
      tanggal_pasang TEXT DEFAULT (date('now', 'localtime')),
      total_harga REAL DEFAULT 0,
      catatan TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Barang Terpasang di Pelanggan
    CREATE TABLE IF NOT EXISTS customer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      jenis_barang TEXT NOT NULL,
      satuan TEXT NOT NULL,
      jumlah REAL NOT NULL DEFAULT 1,
      harga_barang REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      serial_number TEXT DEFAULT '',
      referensi_suplayer TEXT DEFAULT '',
      tanggal_pasang TEXT DEFAULT (date('now', 'localtime'))
    );

    -- Divisi FO
    CREATE TABLE IF NOT EXISTS fo_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      daerah_lokasi TEXT NOT NULL,
      tipe_lokasi TEXT DEFAULT 'ODP', -- ODP, ODC, Closure, Tiang Distribusi, Sentral Hub
      pic_teknisi TEXT DEFAULT '',
      tanggal_pasang TEXT DEFAULT (date('now', 'localtime')),
      total_harga REAL DEFAULT 0,
      catatan TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Barang Terpasang di FO
    CREATE TABLE IF NOT EXISTS fo_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fo_id INTEGER NOT NULL REFERENCES fo_sites(id) ON DELETE CASCADE,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      jenis_barang TEXT NOT NULL,
      satuan TEXT NOT NULL,
      jumlah REAL NOT NULL DEFAULT 1,
      harga_barang REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      serial_number TEXT DEFAULT '',
      referensi_suplayer TEXT DEFAULT '',
      tanggal_pasang TEXT DEFAULT (date('now', 'localtime'))
    );

    -- Divisi Tower
    CREATE TABLE IF NOT EXISTS tower_sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      daerah_lokasi TEXT NOT NULL,
      jenis TEXT NOT NULL DEFAULT 'tower', -- 'tower' | 'monopol'
      type TEXT NOT NULL DEFAULT 'triangle', -- 'monopol' | 'triangle' | 'square'
      ketinggian TEXT DEFAULT '30 meter',
      kepemilikan TEXT DEFAULT 'Milik Sendiri', -- Milik Sendiri, Sewa, Bersama, Partner
      pic_teknisi TEXT DEFAULT '',
      tanggal_pasang TEXT DEFAULT (date('now', 'localtime')),
      total_harga REAL DEFAULT 0,
      catatan TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Barang Terpasang di Tower
    CREATE TABLE IF NOT EXISTS tower_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tower_id INTEGER NOT NULL REFERENCES tower_sites(id) ON DELETE CASCADE,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      jenis_barang TEXT NOT NULL,
      satuan TEXT NOT NULL,
      jumlah REAL NOT NULL DEFAULT 1,
      harga_barang REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      serial_number TEXT DEFAULT '',
      referensi_suplayer TEXT DEFAULT '',
      tanggal_pasang TEXT DEFAULT (date('now', 'localtime'))
    );

    -- Riwayat Keluar Masuk Barang
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no_transaksi TEXT UNIQUE NOT NULL,
      tanggal TEXT NOT NULL, -- YYYY-MM-DD
      waktu TEXT NOT NULL, -- HH:MM:SS
      jenis TEXT NOT NULL, -- 'MASUK' | 'KELUAR'
      kategori_transaksi TEXT NOT NULL, -- 'Pemasangan Pelanggan', 'Pemasangan Divisi FO', 'Pemasangan Divisi Tower', 'Pembelian Supplier', 'Pengembalian / Dismantle', 'Retur', 'Rusak', 'Koreksi Stok'
      divisi TEXT NOT NULL, -- 'PELANGGAN', 'DIVISI FO', 'DIVISI TOWER', 'GUDANG'
      ref_id INTEGER DEFAULT NULL,
      lokasi_penerima TEXT NOT NULL,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      satuan TEXT NOT NULL,
      jumlah REAL NOT NULL,
      harga_satuan REAL NOT NULL DEFAULT 0,
      total_harga REAL NOT NULL DEFAULT 0,
      keterangan TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Bon / Barang Bawaan Teknisi (stok transit lapangan) — tahap 1: catatan awal
    CREATE TABLE IF NOT EXISTS technician_loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no_bon TEXT UNIQUE NOT NULL,
      tanggal TEXT NOT NULL, -- YYYY-MM-DD
      waktu TEXT NOT NULL, -- HH:MM:SS
      teknisi_id INTEGER DEFAULT NULL, -- users.id (opsional; teknisi boleh diketik bebas)
      teknisi_nama TEXT NOT NULL,
      keperluan TEXT DEFAULT '',
      catatan TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'AKTIF', -- 'AKTIF' | 'SEBAGIAN' | 'SELESAI' | 'BATAL'
      dibuat_oleh TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Daftar barang per bon: sisa dibawa teknisi = jumlah_dibawa - jumlah_terpasang - jumlah_kembali
    CREATE TABLE IF NOT EXISTS technician_loan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL REFERENCES technician_loans(id) ON DELETE CASCADE,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      jenis_barang TEXT NOT NULL DEFAULT '',
      satuan TEXT NOT NULL,
      harga_barang REAL NOT NULL DEFAULT 0,
      jumlah_dibawa REAL NOT NULL DEFAULT 0,
      jumlah_terpasang REAL NOT NULL DEFAULT 0,
      jumlah_kembali REAL NOT NULL DEFAULT 0
    );

    -- Riwayat mutasi bon: BAWA (gudang → teknisi), PASANG (teknisi → divisi), KEMBALI (teknisi → gudang)
    CREATE TABLE IF NOT EXISTS technician_loan_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL REFERENCES technician_loans(id) ON DELETE CASCADE,
      loan_item_id INTEGER DEFAULT NULL,
      jenis TEXT NOT NULL, -- 'BAWA' | 'PASANG' | 'KEMBALI' | 'BATAL'
      tanggal TEXT NOT NULL,
      waktu TEXT NOT NULL,
      kode_barang TEXT NOT NULL,
      nama_barang TEXT NOT NULL,
      satuan TEXT NOT NULL,
      harga_barang REAL NOT NULL DEFAULT 0,
      jumlah REAL NOT NULL,
      serial_number TEXT DEFAULT '',
      divisi TEXT DEFAULT '', -- hanya untuk PASANG: 'PELANGGAN' | 'DIVISI FO' | 'DIVISI TOWER'
      tujuan_id INTEGER DEFAULT NULL,
      tujuan_nama TEXT DEFAULT '',
      lokasi_tujuan TEXT DEFAULT '',
      teknisi_nama TEXT DEFAULT '', -- teknisi pelaku (membawa / memasang / mengembalikan)
      no_transaksi TEXT DEFAULT '', -- nomor mutasi gudang (hanya BAWA / KEMBALI)
      keterangan TEXT DEFAULT '',
      dicatat_oleh TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- Pengguna Aplikasi (login & hirarki peran)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nama_lengkap TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer', -- 'admin' | 'staff_gudang' | 'teknisi' | 'viewer'
      status TEXT NOT NULL DEFAULT 'aktif', -- 'aktif' | 'nonaktif'
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Safe migrations for newly added columns if table already exists
  const migrations = [
    "ALTER TABLE customer_items ADD COLUMN serial_number TEXT DEFAULT ''",
    "ALTER TABLE fo_items ADD COLUMN serial_number TEXT DEFAULT ''",
    "ALTER TABLE tower_items ADD COLUMN serial_number TEXT DEFAULT ''",
    "ALTER TABLE transactions ADD COLUMN serial_number TEXT DEFAULT ''",
    // Jejak teknisi pemasang & No. Bon asal pada barang terpasang di tiap divisi
    "ALTER TABLE customer_items ADD COLUMN dipasang_oleh TEXT DEFAULT ''",
    "ALTER TABLE customer_items ADD COLUMN no_bon TEXT DEFAULT ''",
    "ALTER TABLE fo_items ADD COLUMN dipasang_oleh TEXT DEFAULT ''",
    "ALTER TABLE fo_items ADD COLUMN no_bon TEXT DEFAULT ''",
    "ALTER TABLE tower_items ADD COLUMN dipasang_oleh TEXT DEFAULT ''",
    "ALTER TABLE tower_items ADD COLUMN no_bon TEXT DEFAULT ''"
  ];

  for (const m of migrations) {
    try {
      db.exec(m);
    } catch (e) {
      // Column already exists, ignore
    }
  }

  // Index untuk mempercepat laporan, pencarian, dan penghapusan berantai (cascade)
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_trx_tanggal ON transactions (tanggal)',
    'CREATE INDEX IF NOT EXISTS idx_trx_jenis ON transactions (jenis)',
    'CREATE INDEX IF NOT EXISTS idx_trx_divisi ON transactions (divisi)',
    'CREATE INDEX IF NOT EXISTS idx_trx_kode_barang ON transactions (kode_barang)',
    'CREATE INDEX IF NOT EXISTS idx_items_jenis ON items (jenis_barang)',
    'CREATE INDEX IF NOT EXISTS idx_customer_items_customer ON customer_items (customer_id)',
    'CREATE INDEX IF NOT EXISTS idx_customer_items_kode ON customer_items (kode_barang)',
    'CREATE INDEX IF NOT EXISTS idx_fo_items_fo ON fo_items (fo_id)',
    'CREATE INDEX IF NOT EXISTS idx_fo_items_kode ON fo_items (kode_barang)',
    'CREATE INDEX IF NOT EXISTS idx_tower_items_tower ON tower_items (tower_id)',
    'CREATE INDEX IF NOT EXISTS idx_tower_items_kode ON tower_items (kode_barang)',
    'CREATE INDEX IF NOT EXISTS idx_tloan_status ON technician_loans (status)',
    'CREATE INDEX IF NOT EXISTS idx_tloan_tanggal ON technician_loans (tanggal)',
    'CREATE INDEX IF NOT EXISTS idx_tloan_items_loan ON technician_loan_items (loan_id)',
    'CREATE INDEX IF NOT EXISTS idx_tloan_items_kode ON technician_loan_items (kode_barang)',
    'CREATE INDEX IF NOT EXISTS idx_tloan_mov_loan ON technician_loan_movements (loan_id)',
    'CREATE INDEX IF NOT EXISTS idx_tloan_mov_tanggal ON technician_loan_movements (tanggal)'
  ];

  for (const sql of indexes) {
    try {
      db.exec(sql);
    } catch (e) {
      // Index sudah ada, abaikan
    }
  }
}

export default db;
