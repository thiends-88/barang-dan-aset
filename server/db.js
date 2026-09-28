import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
  `);

  // Safe migrations for newly added columns if table already exists
  const migrations = [
    "ALTER TABLE customer_items ADD COLUMN serial_number TEXT DEFAULT ''",
    "ALTER TABLE fo_items ADD COLUMN serial_number TEXT DEFAULT ''",
    "ALTER TABLE tower_items ADD COLUMN serial_number TEXT DEFAULT ''",
    "ALTER TABLE transactions ADD COLUMN serial_number TEXT DEFAULT ''"
  ];

  for (const m of migrations) {
    try {
      db.exec(m);
    } catch (e) {
      // Column already exists, ignore
    }
  }
}

export default db;
