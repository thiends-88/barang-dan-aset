import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db, { initDb } from './db.js';
import { seedData } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB and Seed data
initDb();
seedData();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Helper to generate transaction number
function generateTrxNumber(type) {
  const prefix = type === 'MASUK' ? 'TRX-IN' : 'TRX-OUT';
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${yearMonth}-${randomSuffix}`;
}

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

    // Log stock-in transaction if initial stock > 0
    if (Number(stok) > 0) {
      const now = new Date();
      const tanggal = now.toISOString().split('T')[0];
      const waktu = now.toTimeString().split(' ')[0];
      const trxNo = generateTrxNumber('MASUK');

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

    db.prepare('UPDATE items SET stok = ?, updated_at = datetime("now", "localtime") WHERE id = ?').run(newStock, id);

    const now = new Date();
    const tanggal = now.toISOString().split('T')[0];
    const waktu = now.toTimeString().split(' ')[0];
    const trxNo = generateTrxNumber(isMasuk ? 'MASUK' : 'KELUAR');

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

    const installDate = tanggal_pasang || new Date().toISOString().split('T')[0];

    // Calculate total price and prepare items
    let totalHarga = 0;
    const validatedItems = [];

    for (const it of items) {
      if (!it.kode_barang) continue;
      const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode_barang);
      if (!master) {
        throw new Error(`Kode barang "${it.kode_barang}" tidak terdaftar di master data`);
      }
      const qty = Number(it.jumlah) || 1;
      const price = master.harga_barang;
      const subtotal = qty * price;
      totalHarga += subtotal;

      validatedItems.push({
        kode_barang: master.kode_barang,
        nama_barang: master.nama_barang,
        jenis_barang: master.jenis_barang,
        satuan: master.satuan,
        jumlah: qty,
        harga_barang: price,
        subtotal: subtotal,
        referensi_suplayer: master.referensi_suplayer || '',
        tanggal_pasang: installDate
      });
    }

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
      INSERT INTO customer_items (customer_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      insertCustItem.run(
        custId,
        it.kode_barang,
        it.nama_barang,
        it.jenis_barang,
        it.satuan,
        it.jumlah,
        it.harga_barang,
        it.subtotal,
        it.referensi_suplayer,
        it.tanggal_pasang
      );

      // Deduct warehouse stock
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Outgoing transaction
      const trxNo = generateTrxNumber('KELUAR');
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
        `Instalasi perangkat pelanggan ${id_pelanggan.trim().toUpperCase()} (${paket} - ${infrastruktur})`
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

    // If items are provided in update, reconcile items
    let totalHarga = current.total_harga;
    if (Array.isArray(items)) {
      // First, get old items and restore their stock
      const oldItems = db.prepare('SELECT * FROM customer_items WHERE customer_id = ?').all(id);
      for (const oldIt of oldItems) {
        db.prepare('UPDATE items SET stok = stok + ? WHERE kode_barang = ?').run(oldIt.jumlah, oldIt.kode_barang);
      }
      db.prepare('DELETE FROM customer_items WHERE customer_id = ?').run(id);

      // Now insert new items and deduct stock
      totalHarga = 0;
      const insertCustItem = db.prepare(`
        INSERT INTO customer_items (customer_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare(`
        UPDATE items SET stok = stok - ? WHERE kode_barang = ?
      `);

      for (const it of items) {
        if (!it.kode_barang) continue;
        const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode_barang);
        if (!master) continue;
        const qty = Number(it.jumlah) || 1;
        const subtotal = qty * master.harga_barang;
        totalHarga += subtotal;

        insertCustItem.run(
          id,
          master.kode_barang,
          master.nama_barang,
          master.jenis_barang,
          master.satuan,
          qty,
          master.harga_barang,
          subtotal,
          master.referensi_suplayer || '',
          tanggal_pasang || current.tanggal_pasang
        );
        updateStock.run(qty, master.kode_barang);
      }
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
    const tanggal = now.toISOString().split('T')[0];
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
      const trxNo = generateTrxNumber('MASUK');
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
    db.prepare('UPDATE customers SET status = "putus", total_harga = 0, updated_at = datetime("now", "localtime") WHERE id = ?').run(id);

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
  try {
    const { id } = req.params;
    const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!cust) {
      return res.status(404).json({ success: false, error: 'Pelanggan tidak ditemukan' });
    }
    db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    res.json({ success: true, message: `Pelanggan ${cust.nama_pelanggan} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    const installDate = tanggal_pasang || new Date().toISOString().split('T')[0];

    // Calculate total price and prepare items
    let totalHarga = 0;
    const validatedItems = [];

    for (const it of items) {
      if (!it.kode_barang) continue;
      const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode_barang);
      if (!master) {
        throw new Error(`Kode barang "${it.kode_barang}" tidak terdaftar di master data`);
      }
      const qty = Number(it.jumlah) || 1;
      const price = master.harga_barang;
      const subtotal = qty * price;
      totalHarga += subtotal;

      validatedItems.push({
        kode_barang: master.kode_barang,
        nama_barang: master.nama_barang,
        jenis_barang: master.jenis_barang,
        satuan: master.satuan,
        jumlah: qty,
        harga_barang: price,
        subtotal: subtotal,
        referensi_suplayer: master.referensi_suplayer || '',
        tanggal_pasang: installDate
      });
    }

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
      INSERT INTO fo_items (fo_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        it.referensi_suplayer,
        it.tanggal_pasang
      );

      // Deduct warehouse stock
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Outgoing transaction
      const trxNo = generateTrxNumber('KELUAR');
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
      // Restore previous items stock
      const oldItems = db.prepare('SELECT * FROM fo_items WHERE fo_id = ?').all(id);
      for (const oldIt of oldItems) {
        db.prepare('UPDATE items SET stok = stok + ? WHERE kode_barang = ?').run(oldIt.jumlah, oldIt.kode_barang);
      }
      db.prepare('DELETE FROM fo_items WHERE fo_id = ?').run(id);

      // Insert updated items
      totalHarga = 0;
      const insertFOItem = db.prepare(`
        INSERT INTO fo_items (fo_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare(`
        UPDATE items SET stok = stok - ? WHERE kode_barang = ?
      `);

      for (const it of items) {
        if (!it.kode_barang) continue;
        const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode_barang);
        if (!master) continue;
        const qty = Number(it.jumlah) || 1;
        const subtotal = qty * master.harga_barang;
        totalHarga += subtotal;

        insertFOItem.run(
          id,
          master.kode_barang,
          master.nama_barang,
          master.jenis_barang,
          master.satuan,
          qty,
          master.harga_barang,
          subtotal,
          master.referensi_suplayer || '',
          tanggal_pasang || current.tanggal_pasang
        );
        updateStock.run(qty, master.kode_barang);
      }
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
  try {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM fo_sites WHERE id = ?').get(id);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Titik FO tidak ditemukan' });
    }
    db.prepare('DELETE FROM fo_sites WHERE id = ?').run(id);
    res.json({ success: true, message: `Titik FO ${site.daerah_lokasi} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

    const installDate = tanggal_pasang || new Date().toISOString().split('T')[0];

    // Calculate total price and prepare items
    let totalHarga = 0;
    const validatedItems = [];

    for (const it of items) {
      if (!it.kode_barang) continue;
      const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode_barang);
      if (!master) {
        throw new Error(`Kode barang "${it.kode_barang}" tidak terdaftar di master data`);
      }
      const qty = Number(it.jumlah) || 1;
      const price = master.harga_barang;
      const subtotal = qty * price;
      totalHarga += subtotal;

      validatedItems.push({
        kode_barang: master.kode_barang,
        nama_barang: master.nama_barang,
        jenis_barang: master.jenis_barang,
        satuan: master.satuan,
        jumlah: qty,
        harga_barang: price,
        subtotal: subtotal,
        referensi_suplayer: master.referensi_suplayer || '',
        tanggal_pasang: installDate
      });
    }

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
      INSERT INTO tower_items (tower_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        it.referensi_suplayer,
        it.tanggal_pasang
      );

      // Deduct warehouse stock
      updateStock.run(it.jumlah, it.kode_barang);

      // Log Outgoing transaction
      const trxNo = generateTrxNumber('KELUAR');
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
      // Restore previous items stock
      const oldItems = db.prepare('SELECT * FROM tower_items WHERE tower_id = ?').all(id);
      for (const oldIt of oldItems) {
        db.prepare('UPDATE items SET stok = stok + ? WHERE kode_barang = ?').run(oldIt.jumlah, oldIt.kode_barang);
      }
      db.prepare('DELETE FROM tower_items WHERE tower_id = ?').run(id);

      // Insert updated items
      totalHarga = 0;
      const insertTowerItem = db.prepare(`
        INSERT INTO tower_items (tower_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateStock = db.prepare(`
        UPDATE items SET stok = stok - ? WHERE kode_barang = ?
      `);

      for (const it of items) {
        if (!it.kode_barang) continue;
        const master = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode_barang);
        if (!master) continue;
        const qty = Number(it.jumlah) || 1;
        const subtotal = qty * master.harga_barang;
        totalHarga += subtotal;

        insertTowerItem.run(
          id,
          master.kode_barang,
          master.nama_barang,
          master.jenis_barang,
          master.satuan,
          qty,
          master.harga_barang,
          subtotal,
          master.referensi_suplayer || '',
          tanggal_pasang || current.tanggal_pasang
        );
        updateStock.run(qty, master.kode_barang);
      }
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
  try {
    const { id } = req.params;
    const site = db.prepare('SELECT * FROM tower_sites WHERE id = ?').get(id);
    if (!site) {
      return res.status(404).json({ success: false, error: 'Site Tower tidak ditemukan' });
    }
    db.prepare('DELETE FROM tower_sites WHERE id = ?').run(id);
    res.json({ success: true, message: `Site Tower ${site.daerah_lokasi} berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
      keterangan = ''
    } = req.body;

    if (!jenis || !kode_barang || !jumlah || !lokasi_penerima) {
      throw new Error('Jenis transaksi, kode barang, jumlah, dan lokasi/suplayer wajib diisi');
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
    const tgl = tanggal || now.toISOString().split('T')[0];
    const waktu = now.toTimeString().split(' ')[0];
    const isMasuk = jenis === 'MASUK';

    if (!isMasuk && item.stok < qty) {
      throw new Error(`Stok gudang tidak cukup. Sisa: ${item.stok} ${item.satuan}, diminta: ${qty}`);
    }

    // Update stock
    if (isMasuk) {
      db.prepare('UPDATE items SET stok = stok + ?, updated_at = datetime("now", "localtime") WHERE id = ?').run(qty, item.id);
    } else {
      db.prepare('UPDATE items SET stok = stok - ?, updated_at = datetime("now", "localtime") WHERE id = ?').run(qty, item.id);
    }

    const subtotal = qty * item.harga_barang;
    const trxNo = generateTrxNumber(isMasuk ? 'MASUK' : 'KELUAR');

    const insertTrx = db.prepare(`
      INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertTrx.run(
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
      keterangan.trim()
    );

    return { trxNo, item, qty, isMasuk };
  });

  try {
    const result = transaction();
    res.status(201).json({ success: true, data: result, message: `Transaksi ${result.trxNo} berhasil disimpan` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


// ==========================================
// 6. BARCODE SCANNER & ASSET LOOKUP
// ==========================================

// Lookup scanned barcode / item code
app.get('/api/scanner/lookup/:code', (req, res) => {
  try {
    const rawCode = req.params.code.trim();
    // Search exact code or case-insensitive
    const item = db.prepare('SELECT * FROM items WHERE UPPER(kode_barang) = UPPER(?)').get(rawCode);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: `Barang dengan kode barcode "${rawCode}" tidak ditemukan di database`
      });
    }

    // 1. Where is it installed in Pelanggan?
    const inCustomers = db.prepare(`
      SELECT 
        c.id, c.id_pelanggan, c.nama_pelanggan, c.infrastruktur, c.paket, c.status, c.alamat, c.telepon,
        ci.jumlah, ci.satuan, ci.harga_barang, ci.subtotal, ci.tanggal_pasang
      FROM customer_items ci
      JOIN customers c ON ci.customer_id = c.id
      WHERE UPPER(ci.kode_barang) = UPPER(?)
      ORDER BY ci.id DESC
    `).all(item.kode_barang);

    // 2. Where is it installed in FO Sites?
    const inFO = db.prepare(`
      SELECT 
        f.id, f.daerah_lokasi, f.tipe_lokasi, f.pic_teknisi,
        fi.jumlah, fi.satuan, fi.harga_barang, fi.subtotal, fi.tanggal_pasang
      FROM fo_items fi
      JOIN fo_sites f ON fi.fo_id = f.id
      WHERE UPPER(fi.kode_barang) = UPPER(?)
      ORDER BY fi.id DESC
    `).all(item.kode_barang);

    // 3. Where is it installed in Tower Sites?
    const inTower = db.prepare(`
      SELECT 
        t.id, t.daerah_lokasi, t.jenis, t.type, t.ketinggian, t.kepemilikan, t.pic_teknisi,
        ti.jumlah, ti.satuan, ti.harga_barang, ti.subtotal, ti.tanggal_pasang
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
    }

    res.json({ success: true, data: filteredResult });
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
    res.json({ success: true, message: 'Data berhasil direset dan diisi ulang dengan data simulasi ISP' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend static build if available
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Fallback to index.html for client-side routing
app.use((req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('API server is running. Frontend build in progress...');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
