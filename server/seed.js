import db from './db.js';
import { hashPassword } from './auth.js';

// ============================================================
// Akun awal aplikasi (dibuat sekali saat tabel users kosong).
// Password wajib diganti lewat menu Manajemen User setelah login.
// ============================================================
export function seedUsers() {
  const rowCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (rowCount.count > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (username, password_hash, nama_lengkap, role, status)
    VALUES (?, ?, ?, ?, 'aktif')
  `);

  const defaults = [
    ['admin', 'admin123', 'Administrator Sistem', 'admin'],
    ['gudang', 'gudang123', 'Staff Gudang', 'staff_gudang'],
    ['teknisi', 'teknisi123', 'Teknisi Lapangan', 'teknisi'],
    ['viewer', 'viewer123', 'Viewer / Pimpinan', 'viewer']
  ];

  for (const [username, pw, nama, role] of defaults) {
    insert.run(username, hashPassword(pw), nama, role);
  }
  console.log('Akun awal dibuat: admin / gudang / teknisi / viewer');
}

export function seedData() {
  // Seed Categories if empty
  const rowCatCount = db.prepare('SELECT COUNT(*) as count FROM categories').get();
  if (rowCatCount.count === 0) {
    const insertCat = db.prepare('INSERT OR IGNORE INTO categories (nama_kategori, deskripsi) VALUES (?, ?)');
    const defaultCats = [
      ['Perangkat Aktif Pelanggan', 'ONU, ONT, Router SOHO, Modem CPE'],
      ['Kabel Fiber Optic', 'Kabel Dropcore, Precon, Feeder, Backbone'],
      ['Aksesoris & Pasif FO', 'Patchcord, SFP, ODP, ODC, Closure, Sleeve, Splitter'],
      ['Perangkat Wireless Tower', 'Radio Client, Access Point, Dish Antenna, Antena Sectoral'],
      ['Struktur & Aksesoris Tower', 'Tower Triangle, Monopole, Spanscrew, Kawat Sling'],
      ['Kabel Jaringan', 'Kabel UTP Cat6, FTP Outdoor, Patch Cable'],
      ['Perangkat Jaringan Core', 'RouterBOARD, OLT, Switch Gigabit, Media Converter'],
      ['Perangkat Power & Kelistrikan', 'UPS, Aki / Baterai, Power Supply, Solar Controller'],
      ['Alat Kerja & Splicer', 'Fusion Splicer, OTDR, OPM, Visual Fault Locator, Tang Fiber']
    ];
    for (const c of defaultCats) {
      insertCat.run(...c);
    }
  }

  const rowCount = db.prepare('SELECT COUNT(*) as count FROM items').get();
  if (rowCount.count > 0) {
    return; // Already seeded
  }

  console.log('Seeding initial data...');

  const insertItem = db.prepare(`
    INSERT INTO items (kode_barang, nama_barang, satuan, jenis_barang, stok, min_stok, harga_barang, referensi_suplayer, catatan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const items = [
    ['BRG-ONT-HG8546M', 'ONU XPON Huawei HG8546M 1GE+3FE+1POTS+WiFi', 'unit', 'Perangkat Aktif Pelanggan', 45, 10, 175000, 'PT. Fiber Solusindo Nusantara', 'Konektor SC/UPC, firmware global'],
    ['BRG-ONT-F670L', 'ONT ZTE F670L Dual Band AC1200 Gigabit', 'unit', 'Perangkat Aktif Pelanggan', 28, 5, 260000, 'CV. Telekomindo Sentosa', 'Support dual band 2.4G & 5G'],
    ['BRG-RTR-RB750GR3', 'Router MikroTik hEX RB750Gr3 5x Gigabit', 'unit', 'Perangkat Jaringan Core', 18, 5, 850000, 'PT. Citraweb Solusi Mandiri', 'RouterOS Level 4'],
    ['BRG-FO-DROP-1C-1000', 'Kabel FO Dropcore 1 Core 3 Seling 1000M', 'roll', 'Kabel Fiber Optic', 12, 3, 385000, 'PT. Optik Kabel Indonesia', 'G657A1 High Tensile Steel'],
    ['BRG-FO-PATCH-SC-3M', 'Patchcord SC-UPC to SC-UPC Simplex 3M', 'pcs', 'Aksesoris & Pasif FO', 180, 30, 12000, 'Toko Fiber Mediatama', 'Low insertion loss, LSZH jacket'],
    ['BRG-FO-PATCH-SC-LC-3M', 'Patchcord SC-UPC to LC-UPC Simplex 3M', 'pcs', 'Aksesoris & Pasif FO', 95, 20, 15000, 'Toko Fiber Mediatama', 'Untuk koneksi SFP OLT/Switch'],
    ['BRG-FO-SFP-1G-20KM', 'SFP Transceiver 1.25G BiDi 20KM 1310/1550', 'pcs', 'Aksesoris & Pasif FO', 34, 8, 125000, 'PT. Solusi Optik Digital', 'Kompatibel MikroTik, Cisco, ZTE'],
    ['BRG-FO-ODP-8C', 'ODP Box 8 Core Solid + Adapter SC/UPC', 'unit', 'Aksesoris & Pasif FO', 22, 5, 140000, 'PT. Optik Solusindo', 'Lengkap pigtail dan splitter 1:8'],
    ['BRG-FO-ODP-16C', 'ODP Box 16 Core Pole Mounted Outdoor', 'unit', 'Aksesoris & Pasif FO', 14, 4, 210000, 'PT. Optik Solusindo', 'Include splitter cassette 1:16'],
    ['BRG-FO-ODC-48C', 'ODC Outdoor 48 Core Lengkap Adapter SC', 'unit', 'Aksesoris & Pasif FO', 4, 5, 1950000, 'PT. Fiberindo Utama', 'Bahan SMC anti korosi dan kunci pengaman'],
    ['BRG-FO-CLOSURE-24C', 'Optical Joint Closure 24 Core Dome/Inline', 'unit', 'Aksesoris & Pasif FO', 16, 5, 165000, 'PT. Fiberindo Utama', 'Include heat shrink & tray splice'],
    ['BRG-FO-CLAMP-SPAN', 'Clamp Span Hook Penjepit Kabel Dropcore', 'pcs', 'Aksesoris & Pasif FO', 450, 50, 4500, 'CV. Logam Logika Mandiri', 'Material stainless & alumunium'],
    ['BRG-FO-SLEEVE-60', 'Protection Sleeve Sambungan FO 60mm', 'bks', 'Aksesoris & Pasif FO', 40, 10, 25000, 'CV. Telekomindo Sentosa', 'Isi 100 pcs per bks'],
    ['BRG-RAD-LBE-5AC', 'Ubiquiti LiteBeam 5AC Gen2 23dBi Wireless', 'unit', 'Perangkat Wireless Tower', 15, 4, 980000, 'PT. Citraweb Solusi Mandiri', 'Radio client airMAX ac 5GHz'],
    ['BRG-RAD-PBEAM-M5', 'Ubiquiti PowerBeam PBE-M5-400 25dBi', 'unit', 'Perangkat Wireless Tower', 8, 2, 1450000, 'PT. Citraweb Solusi Mandiri', 'Point-to-Point long range link'],
    ['BRG-RAD-RB922', 'MikroTik NetMetal 5 RB922UAGS-5HPacD', 'unit', 'Perangkat Wireless Tower', 6, 8, 2100000, 'PT. Citraweb Solusi Mandiri', 'Outdoor high power AP/Backhaul'],
    ['BRG-TWR-TRI-30', 'Tower Triangle Galvanis Lebar 30cm Panjang 5m', 'unit', 'Struktur & Aksesoris Tower', 12, 3, 750000, 'Bengkel Las Mandiri Tower', 'Pipa medium SNI galvanis celup panas'],
    ['BRG-TWR-SPANSCREW', 'Spanscrew Jarum Keras M12 Galvanis', 'pcs', 'Struktur & Aksesoris Tower', 60, 15, 35000, 'Toko Besi Sentosa Abadi', 'Tensioner tarikan kawat sling'],
    ['BRG-TWR-SLING-4MM', 'Kawat Sling Baja Galvanis 4mm', 'meter', 'Struktur & Aksesoris Tower', 650, 100, 8500, 'Toko Besi Sentosa Abadi', 'Kawat kencang pengikat tower'],
    ['BRG-KBL-UTP-CAT6', 'Kabel UTP Cat6 Outdoor Shielded FTP 305M', 'roll', 'Kabel Jaringan', 9, 2, 1750000, 'PT. Belden Pratama', 'FTP Outdoor dengan kawat grounding'],
    ['BRG-UPS-1200VA', 'UPS ICA CN1200 1200VA / 600W Backup Tower', 'unit', 'Perangkat Power & Kelistrikan', 7, 10, 1250000, 'PT. Daya Mandiri Sejahtera', 'Backup battery untuk router & switch BTS'],
    ['BRG-SW-GIGABIT-8P', 'Switch Gigabit 8 Port Metal Case Smart Managed', 'unit', 'Perangkat Jaringan Core', 20, 5, 420000, 'CV. Data Network Solusi', 'VLAN tagging & PoE Passthrough']
  ];

  for (const item of items) {
    insertItem.run(...item);
  }

  // Seed Customers
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id_pelanggan, nama_pelanggan, infrastruktur, paket, keterangan_paket, kategori, status, alamat, telepon, tanggal_pasang, total_harga, catatan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertCustItem = db.prepare(`
    INSERT INTO customer_items (customer_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const customers = [
    {
      id_pelanggan: 'CUST-OPT-001',
      nama_pelanggan: 'PT. Surya Graha Mandiri',
      infrastruktur: 'optic',
      paket: 'dedicated',
      keterangan_paket: 'Dedicated 50 Mbps 1:1 Clean IP Public',
      kategori: 'bandwidth',
      status: 'aktif',
      alamat: 'Jl. Jend. Sudirman Kav 28 No. 5, Gedung Surya Lt. 3',
      telepon: '081234567890',
      tanggal_pasang: '2026-08-10',
      catatan: 'Prioritas SLA 99.5%, port 1 ODF sentral',
      items: [
        { kode: 'BRG-ONT-F670L', qty: 1 },
        { kode: 'BRG-FO-PATCH-SC-3M', qty: 2 },
        { kode: 'BRG-FO-DROP-1C-1000', qty: 0.15 } // 150 meter
      ]
    },
    {
      id_pelanggan: 'CUST-OPT-002',
      nama_pelanggan: 'Bapak Ahmad Fauzi (Rumah)',
      infrastruktur: 'optic',
      paket: 'home',
      keterangan_paket: 'Home Internet 30 Mbps Unlimited',
      kategori: 'bandwidth',
      status: 'aktif',
      alamat: 'Perumahan Permata Indah Blok B3 No. 12',
      telepon: '081377889900',
      tanggal_pasang: '2026-08-25',
      catatan: 'Terhubung ke ODP-SUDIRMAN-01 Port 3',
      items: [
        { kode: 'BRG-ONT-HG8546M', qty: 1 },
        { kode: 'BRG-FO-PATCH-SC-3M', qty: 1 },
        { kode: 'BRG-FO-CLAMP-SPAN', qty: 4 }
      ]
    },
    {
      id_pelanggan: 'CUST-OPT-003',
      nama_pelanggan: 'Klinik Sehat Medika',
      infrastruktur: 'optic',
      paket: 'soho',
      keterangan_paket: 'SOHO Pro 100 Mbps + Static IP',
      kategori: 'bandwidth',
      status: 'aktif',
      alamat: 'Jl. Ahmad Yani No. 88, Ruko Medika Blok A',
      telepon: '082199887766',
      tanggal_pasang: '2026-09-02',
      catatan: 'Instalasi jalur bawah tanah pipa PVC',
      items: [
        { kode: 'BRG-ONT-F670L', qty: 1 },
        { kode: 'BRG-RTR-RB750GR3', qty: 1 },
        { kode: 'BRG-FO-PATCH-SC-3M', qty: 2 }
      ]
    },
    {
      id_pelanggan: 'CUST-WIR-004',
      nama_pelanggan: 'Restoran Dapoer Nusantara',
      infrastruktur: 'wireless',
      paket: 'middle',
      keterangan_paket: 'Middle Wireless 20 Mbps Low Latency',
      kategori: 'bandwidth',
      status: 'aktif',
      alamat: 'Jl. Lingkar Luar Km 4, Kawasan Wisata Kuliner',
      telepon: '085211223344',
      tanggal_pasang: '2026-09-12',
      catatan: 'Arah antena menghadap Tower Triangle Bukit Indah azimuth 145 deg',
      items: [
        { kode: 'BRG-RAD-LBE-5AC', qty: 1 },
        { kode: 'BRG-KBL-UTP-CAT6', qty: 0.1 } // 30 meter
      ]
    },
    {
      id_pelanggan: 'CUST-OPT-005',
      nama_pelanggan: 'Cafe Kopi Teman Lama',
      infrastruktur: 'optic',
      paket: 'family',
      keterangan_paket: 'Family Cafe 50 Mbps',
      kategori: 'bandwidth',
      status: 'cuti',
      alamat: 'Jl. Cempaka Putih No. 15',
      telepon: '087855443322',
      tanggal_pasang: '2026-09-18',
      catatan: 'Sementara cuti renovasi ruko 1 bulan',
      items: [
        { kode: 'BRG-ONT-HG8546M', qty: 1 },
        { kode: 'BRG-FO-PATCH-SC-3M', qty: 1 }
      ]
    }
  ];

  for (const c of customers) {
    // Calculate total price
    let total = 0;
    const itemDetails = [];
    for (const it of c.items) {
      const dbItem = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode);
      if (dbItem) {
        const subtotal = it.qty * dbItem.harga_barang;
        total += subtotal;
        itemDetails.push({
          kode: it.kode,
          nama: dbItem.nama_barang,
          jenis: dbItem.jenis_barang,
          satuan: dbItem.satuan,
          qty: it.qty,
          harga: dbItem.harga_barang,
          subtotal: subtotal,
          suplayer: dbItem.referensi_suplayer
        });
      }
    }

    const res = insertCustomer.run(
      c.id_pelanggan,
      c.nama_pelanggan,
      c.infrastruktur,
      c.paket,
      c.keterangan_paket,
      c.kategori,
      c.status,
      c.alamat,
      c.telepon,
      c.tanggal_pasang,
      total,
      c.catatan
    );

    const custId = res.lastInsertRowid;
    for (const it of itemDetails) {
      insertCustItem.run(
        custId,
        it.kode,
        it.nama,
        it.jenis,
        it.satuan,
        it.qty,
        it.harga,
        it.subtotal,
        it.suplayer,
        c.tanggal_pasang
      );
    }
  }

  // Seed Divisi FO Sites
  const insertFOSite = db.prepare(`
    INSERT INTO fo_sites (daerah_lokasi, tipe_lokasi, pic_teknisi, tanggal_pasang, total_harga, catatan)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertFOItem = db.prepare(`
    INSERT INTO fo_items (fo_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const foSites = [
    {
      daerah_lokasi: 'ODP-JLN-SUDIRMAN-01 (Depan Ruko Sentra)',
      tipe_lokasi: 'ODP',
      pic_teknisi: 'Budi Santoso & Hendra FO',
      tanggal_pasang: '2026-08-05',
      catatan: 'Kapasitas 8 Core, input feeder dari ODC Sentral Hub Barat',
      items: [
        { kode: 'BRG-FO-ODP-8C', qty: 1 },
        { kode: 'BRG-FO-PATCH-SC-3M', qty: 4 },
        { kode: 'BRG-FO-CLAMP-SPAN', qty: 12 },
        { kode: 'BRG-FO-SLEEVE-60', qty: 0.1 }
      ]
    },
    {
      daerah_lokasi: 'CLOSURE-KM12-TIMUR (Simpang Lampu Merah)',
      tipe_lokasi: 'Closure',
      pic_teknisi: 'Hendra FO & Rian',
      tanggal_pasang: '2026-08-15',
      catatan: 'Sambungan backbone 24 core ke arah Timur',
      items: [
        { kode: 'BRG-FO-CLOSURE-24C', qty: 1 },
        { kode: 'BRG-FO-SLEEVE-60', qty: 0.25 },
        { kode: 'BRG-FO-DROP-1C-1000', qty: 0.5 }
      ]
    },
    {
      daerah_lokasi: 'ODC-SENTRAL-HUB-BARAT (Gedung POP Sektor Barat)',
      tipe_lokasi: 'ODC',
      pic_teknisi: 'Budi Santoso',
      tanggal_pasang: '2026-08-20',
      catatan: 'Pusat distribusi 48 core untuk area perkantoran',
      items: [
        { kode: 'BRG-FO-ODC-48C', qty: 1 },
        { kode: 'BRG-FO-SFP-1G-20KM', qty: 4 },
        { kode: 'BRG-FO-PATCH-SC-LC-3M', qty: 8 }
      ]
    }
  ];

  for (const f of foSites) {
    let total = 0;
    const itemDetails = [];
    for (const it of f.items) {
      const dbItem = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode);
      if (dbItem) {
        const subtotal = it.qty * dbItem.harga_barang;
        total += subtotal;
        itemDetails.push({
          kode: it.kode,
          nama: dbItem.nama_barang,
          jenis: dbItem.jenis_barang,
          satuan: dbItem.satuan,
          qty: it.qty,
          harga: dbItem.harga_barang,
          subtotal: subtotal,
          suplayer: dbItem.referensi_suplayer
        });
      }
    }

    const res = insertFOSite.run(
      f.daerah_lokasi,
      f.tipe_lokasi,
      f.pic_teknisi,
      f.tanggal_pasang,
      total,
      f.catatan
    );

    const foId = res.lastInsertRowid;
    for (const it of itemDetails) {
      insertFOItem.run(
        foId,
        it.kode,
        it.nama,
        it.jenis,
        it.satuan,
        it.qty,
        it.harga,
        it.subtotal,
        it.suplayer,
        f.tanggal_pasang
      );
    }
  }

  // Seed Divisi Tower Sites
  const insertTowerSite = db.prepare(`
    INSERT INTO tower_sites (daerah_lokasi, jenis, type, ketinggian, kepemilikan, pic_teknisi, tanggal_pasang, total_harga, catatan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTowerItem = db.prepare(`
    INSERT INTO tower_items (tower_id, kode_barang, nama_barang, jenis_barang, satuan, jumlah, harga_barang, subtotal, referensi_suplayer, tanggal_pasang)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const towerSites = [
    {
      daerah_lokasi: 'Site Tower BTS Bukit Bintang - Elevasi 450 MDPL',
      jenis: 'tower',
      type: 'triangle',
      ketinggian: '45 meter',
      kepemilikan: 'Milik Sendiri',
      pic_teknisi: 'Gunawan & Tim Tower Riggers',
      tanggal_pasang: '2026-07-20',
      catatan: 'Induk BTS Wireless relay kawasan Bukit Bintang & Resto Area',
      items: [
        { kode: 'BRG-TWR-TRI-30', qty: 9 }, // 9 stage x 5m = 45m
        { kode: 'BRG-TWR-SPANSCREW', qty: 18 },
        { kode: 'BRG-TWR-SLING-4MM', qty: 450 },
        { kode: 'BRG-RAD-PBEAM-M5', qty: 2 },
        { kode: 'BRG-RAD-RB922', qty: 3 },
        { kode: 'BRG-UPS-1200VA', qty: 1 },
        { kode: 'BRG-SW-GIGABIT-8P', qty: 1 }
      ]
    },
    {
      daerah_lokasi: 'Site Monopole Kantor Cabang Utara',
      jenis: 'monopol',
      type: 'monopol',
      ketinggian: '20 meter',
      kepemilikan: 'Milik Sendiri',
      pic_teknisi: 'Gunawan',
      tanggal_pasang: '2026-08-18',
      catatan: 'Tiang monopole pipa galvanis untuk link PTP ke kantor pusat',
      items: [
        { kode: 'BRG-RAD-LBE-5AC', qty: 1 },
        { kode: 'BRG-TWR-SLING-4MM', qty: 80 },
        { kode: 'BRG-TWR-SPANSCREW', qty: 4 },
        { kode: 'BRG-KBL-UTP-CAT6', qty: 0.15 }
      ]
    },
    {
      daerah_lokasi: 'Site Tower Square Kawasan Industri Cikarang',
      jenis: 'tower',
      type: 'square',
      ketinggian: '42 meter',
      kepemilikan: 'Sewa Lahan',
      pic_teknisi: 'Tim Riggers Eksternal & Gunawan',
      tanggal_pasang: '2026-09-01',
      catatan: 'Tower 4 kaki (square) heavy duty menampung 4 antena sektor',
      items: [
        { kode: 'BRG-RAD-PBEAM-M5', qty: 2 },
        { kode: 'BRG-RAD-RB922', qty: 2 },
        { kode: 'BRG-UPS-1200VA', qty: 1 },
        { kode: 'BRG-SW-GIGABIT-8P', qty: 1 }
      ]
    }
  ];

  for (const t of towerSites) {
    let total = 0;
    const itemDetails = [];
    for (const it of t.items) {
      const dbItem = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(it.kode);
      if (dbItem) {
        const subtotal = it.qty * dbItem.harga_barang;
        total += subtotal;
        itemDetails.push({
          kode: it.kode,
          nama: dbItem.nama_barang,
          jenis: dbItem.jenis_barang,
          satuan: dbItem.satuan,
          qty: it.qty,
          harga: dbItem.harga_barang,
          subtotal: subtotal,
          suplayer: dbItem.referensi_suplayer
        });
      }
    }

    const res = insertTowerSite.run(
      t.daerah_lokasi,
      t.jenis,
      t.type,
      t.ketinggian,
      t.kepemilikan,
      t.pic_teknisi,
      t.tanggal_pasang,
      total,
      t.catatan
    );

    const towerId = res.lastInsertRowid;
    for (const it of itemDetails) {
      insertTowerItem.run(
        towerId,
        it.kode,
        it.nama,
        it.jenis,
        it.satuan,
        it.qty,
        it.harga,
        it.subtotal,
        it.suplayer,
        t.tanggal_pasang
      );
    }
  }

  // Seed Transactions (Log Keluar Masuk Barang)
  const insertTrx = db.prepare(`
    INSERT INTO transactions (no_transaksi, tanggal, waktu, jenis, kategori_transaksi, divisi, ref_id, lokasi_penerima, kode_barang, nama_barang, satuan, jumlah, harga_satuan, total_harga, keterangan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const txs = [
    // Pembelian Masuk Barang Baru (Juli - September)
    ['TRX-IN-202607-001', '2026-07-15', '09:30:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'PT. Fiber Solusindo Nusantara', 'BRG-ONT-HG8546M', 'ONU XPON Huawei HG8546M 1GE+3FE+1POTS+WiFi', 'unit', 50, 175000, 8750000, 'Pengadaan batch modem XPON PO-2026-071'],
    ['TRX-IN-202607-002', '2026-07-18', '11:15:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'CV. Telekomindo Sentosa', 'BRG-ONT-F670L', 'ONT ZTE F670L Dual Band AC1200 Gigabit', 'unit', 30, 260000, 7800000, 'Pengadaan modem dual band kelas SOHO'],
    ['TRX-IN-202607-003', '2026-07-19', '14:20:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'PT. Optik Kabel Indonesia', 'BRG-FO-DROP-1C-1000', 'Kabel FO Dropcore 1 Core 3 Seling 1000M', 'roll', 15, 385000, 5775000, 'Stok kabel dropcore 15 roll'],
    ['TRX-IN-202607-004', '2026-07-20', '10:00:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'Bengkel Las Mandiri Tower', 'BRG-TWR-TRI-30', 'Tower Triangle Galvanis Lebar 30cm Panjang 5m', 'unit', 21, 750000, 15750000, 'Pengadaan section tower triangle BTS'],
    ['TRX-IN-202607-005', '2026-07-20', '10:30:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'Toko Besi Sentosa Abadi', 'BRG-TWR-SLING-4MM', 'Kawat Sling Baja Galvanis 4mm', 'meter', 1200, 8500, 10200000, 'Kawat sling tarikan tower'],
    ['TRX-IN-202608-001', '2026-08-01', '08:45:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'PT. Citraweb Solusi Mandiri', 'BRG-RAD-LBE-5AC', 'Ubiquiti LiteBeam 5AC Gen2 23dBi Wireless', 'unit', 20, 980000, 19600000, 'Restock radio wireless client Ubiquiti'],
    ['TRX-IN-202608-002', '2026-08-02', '09:00:00', 'MASUK', 'Pembelian Supplier', 'GUDANG', null, 'PT. Citraweb Solusi Mandiri', 'BRG-RAD-PBEAM-M5', 'Ubiquiti PowerBeam PBE-M5-400 25dBi', 'unit', 12, 1450000, 17400000, 'Radio backhaul PTP'],

    // Pengeluaran Barang ke Tower
    ['TRX-OUT-202607-001', '2026-07-20', '13:00:00', 'KELUAR', 'Pemasangan Divisi Tower', 'DIVISI TOWER', 1, 'Site Tower BTS Bukit Bintang', 'BRG-TWR-TRI-30', 'Tower Triangle Galvanis Lebar 30cm Panjang 5m', 'unit', 9, 750000, 6750000, 'Pemasangan 9 stage tower triangle 45m'],
    ['TRX-OUT-202607-002', '2026-07-20', '13:15:00', 'KELUAR', 'Pemasangan Divisi Tower', 'DIVISI TOWER', 1, 'Site Tower BTS Bukit Bintang', 'BRG-TWR-SLING-4MM', 'Kawat Sling Baja Galvanis 4mm', 'meter', 450, 8500, 3825000, 'Pemasangan kawat tarikan sling 3 arah'],
    ['TRX-OUT-202607-003', '2026-07-21', '09:00:00', 'KELUAR', 'Pemasangan Divisi Tower', 'DIVISI TOWER', 1, 'Site Tower BTS Bukit Bintang', 'BRG-RAD-PBEAM-M5', 'Ubiquiti PowerBeam PBE-M5-400 25dBi', 'unit', 2, 1450000, 2900000, 'Radio link backbone pusat ke BTS'],

    // Pengeluaran Barang ke FO
    ['TRX-OUT-202608-001', '2026-08-05', '10:30:00', 'KELUAR', 'Pemasangan Divisi FO', 'DIVISI FO', 1, 'ODP-JLN-SUDIRMAN-01', 'BRG-FO-ODP-8C', 'ODP Box 8 Core Solid + Adapter SC/UPC', 'unit', 1, 140000, 140000, 'Pemasangan ODP di tiang No. T-045'],
    ['TRX-OUT-202608-002', '2026-08-15', '11:00:00', 'KELUAR', 'Pemasangan Divisi FO', 'DIVISI FO', 2, 'CLOSURE-KM12-TIMUR', 'BRG-FO-CLOSURE-24C', 'Optical Joint Closure 24 Core Dome/Inline', 'unit', 1, 165000, 165000, 'Sambungan kabel feeder km 12'],
    ['TRX-OUT-202608-003', '2026-08-20', '14:00:00', 'KELUAR', 'Pemasangan Divisi FO', 'DIVISI FO', 3, 'ODC-SENTRAL-HUB-BARAT', 'BRG-FO-ODC-48C', 'ODC Outdoor 48 Core Lengkap Adapter SC', 'unit', 1, 1950000, 1950000, 'Pemasangan ODC outdoor sentral barat'],

    // Pengeluaran Barang ke Pelanggan
    ['TRX-OUT-202608-004', '2026-08-10', '14:30:00', 'KELUAR', 'Pemasangan Pelanggan', 'PELANGGAN', 1, 'PT. Surya Graha Mandiri', 'BRG-ONT-F670L', 'ONT ZTE F670L Dual Band AC1200 Gigabit', 'unit', 1, 260000, 260000, 'Instalasi modem fiber gedung Surya Lt 3'],
    ['TRX-OUT-202608-005', '2026-08-25', '11:15:00', 'KELUAR', 'Pemasangan Pelanggan', 'PELANGGAN', 2, 'Bapak Ahmad Fauzi (Rumah)', 'BRG-ONT-HG8546M', 'ONU XPON Huawei HG8546M 1GE+3FE+1POTS+WiFi', 'unit', 1, 175000, 175000, 'Pemasangan pelanggan baru paket home'],
    ['TRX-OUT-202609-001', '2026-09-02', '10:00:00', 'KELUAR', 'Pemasangan Pelanggan', 'PELANGGAN', 3, 'Klinik Sehat Medika', 'BRG-ONT-F670L', 'ONT ZTE F670L Dual Band AC1200 Gigabit', 'unit', 1, 260000, 260000, 'Pemasangan modem SOHO'],
    ['TRX-OUT-202609-002', '2026-09-02', '10:15:00', 'KELUAR', 'Pemasangan Pelanggan', 'PELANGGAN', 3, 'Klinik Sehat Medika', 'BRG-RTR-RB750GR3', 'Router MikroTik hEX RB750Gr3 5x Gigabit', 'unit', 1, 850000, 850000, 'Router load balancing & bandwidth limiter'],
    ['TRX-OUT-202609-003', '2026-09-12', '13:00:00', 'KELUAR', 'Pemasangan Pelanggan', 'PELANGGAN', 4, 'Restoran Dapoer Nusantara', 'BRG-RAD-LBE-5AC', 'Ubiquiti LiteBeam 5AC Gen2 23dBi Wireless', 'unit', 1, 980000, 980000, 'Pemasangan radio client wireless di atap restoran'],
    ['TRX-OUT-202609-004', '2026-09-18', '15:20:00', 'KELUAR', 'Pemasangan Pelanggan', 'PELANGGAN', 5, 'Cafe Kopi Teman Lama', 'BRG-ONT-HG8546M', 'ONU XPON Huawei HG8546M 1GE+3FE+1POTS+WiFi', 'unit', 1, 175000, 175000, 'Pemasangan modem paket family cafe'],

    // Pengembalian / Dismantle
    ['TRX-IN-202609-001', '2026-09-22', '16:00:00', 'MASUK', 'Pengembalian / Dismantle', 'PELANGGAN', null, 'Eks Pelanggan Bpk. Herman (Putus)', 'BRG-ONT-HG8546M', 'ONU XPON Huawei HG8546M 1GE+3FE+1POTS+WiFi', 'unit', 1, 175000, 175000, 'Dismantle modem dari pelanggan putus langganan, kondisi baik tes OK']
  ];

  for (const t of txs) {
    insertTrx.run(...t);
  }

  console.log('Seeding completed successfully!');
}
