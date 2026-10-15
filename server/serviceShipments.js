// Ledger servis: pengiriman tidak mengurangi stok siap pakai lagi karena sudah di gudang rusak.
export function registerServiceShipments(app, { db, todayLocal, tanggalOpsional, logStockMutation, getMasterItem }) {
  const detail = (id) => {
    const row = db.prepare('SELECT * FROM service_shipments WHERE id = ?').get(Number(id));
    if (!row) throw new Error('Pengiriman servis tidak ditemukan');
    const items = db.prepare('SELECT * FROM service_shipment_items WHERE shipment_id = ? ORDER BY id').all(row.id);
    return { ...row, items, status: items.every(i => i.hasil !== 'DISERVIS') ? 'SELESAI' : 'DISERVIS' };
  };
  const text = (value, label, required = false) => {
    if (value !== undefined && typeof value !== 'string') throw new Error(`${label} harus berupa teks`);
    const result = (value || '').trim();
    if (required && !result) throw new Error(`${label} wajib diisi`);
    if (result.length > 2000) throw new Error(`${label} terlalu panjang (maksimal 2000 karakter)`);
    return result;
  };
  app.get('/api/service-shipments', (req, res) => {
    try {
      const rows = db.prepare(`SELECT s.*, COUNT(i.id) AS jumlah_baris, SUM(i.jumlah) AS total_qty,
        SUM(CASE WHEN i.hasil = 'DISERVIS' THEN i.jumlah ELSE 0 END) AS qty_diservis
        FROM service_shipments s JOIN service_shipment_items i ON i.shipment_id = s.id
        GROUP BY s.id ORDER BY s.id DESC`).all();
      res.json({ success: true, data: rows });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });
  app.get('/api/service-shipments/:id', (req, res) => {
    try { res.json({ success: true, data: detail(req.params.id) }); }
    catch (err) { res.status(404).json({ success: false, error: err.message }); }
  });
  app.post('/api/service-shipments', (req, res) => {
    try {
      const result = db.transaction(() => {
        const body = req.body || {};
        const tujuan = text(body.tujuan, 'Tempat servis', true);
        const tanggal = tanggalOpsional(body.tanggal, 'Tanggal pengiriman') || todayLocal();
        if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) throw new Error('Pilih 1–100 barang untuk dikirim');
        const seen = new Set();
        const rows = body.items.map(i => {
          const id = Number(i?.damaged_id), jumlah = Number(i?.jumlah);
          if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) throw new Error('Pilihan barang tidak valid atau duplikat');
          seen.add(id);
          const row = db.prepare('SELECT * FROM damaged_items WHERE id = ?').get(id);
          if (!row || row.status !== 'DITAMPUNG' || row.jumlah <= 0) throw new Error('Barang harus berstatus DITAMPUNG dan masih tersedia');
          if (!Number.isFinite(jumlah) || jumlah < 0.001 || Math.abs(jumlah * 1000 - Math.round(jumlah * 1000)) > 1e-7) throw new Error('Jumlah kirim minimal 0,001 dengan maksimal 3 angka desimal');
          if (jumlah > row.jumlah) throw new Error(`Jumlah ${row.nama_barang} harus lebih dari 0 dan maksimal ${row.jumlah}`);
          return { row, jumlah };
        });
        const author = req.user.nama_lengkap || req.user.username;
        const header = db.prepare('INSERT INTO service_shipments (tanggal, tujuan, alamat, kontak, catatan, dibuat_oleh) VALUES (?, ?, ?, ?, ?, ?)')
          .run(tanggal, tujuan, text(body.alamat, 'Alamat'), text(body.kontak, 'Kontak'), text(body.catatan, 'Catatan'), author);
        const id = Number(header.lastInsertRowid);
        db.prepare('UPDATE service_shipments SET no_surat = ? WHERE id = ?').run(`SRV-${tanggal.replaceAll('-', '')}-${String(id).padStart(5, '0')}`, id);
        for (const { row, jumlah } of rows) {
          db.prepare(`INSERT INTO service_shipment_items (shipment_id, damaged_id, kode_barang, nama_barang, satuan, kondisi, harga_barang, jumlah)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, row.id, row.kode_barang, row.nama_barang, row.satuan, row.kondisi, row.harga_barang, jumlah);
          const sisa = Math.round((row.jumlah - jumlah) * 1000) / 1000;
          db.prepare("UPDATE damaged_items SET jumlah = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(sisa, sisa > 0 ? 'DITAMPUNG' : 'DISERVIS', row.id);
        }
        return detail(id);
      })();
      res.status(201).json({ success: true, data: result });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });
  // Satu baris pengiriman diterima seluruhnya; baris lain boleh menyusul di tanggal berbeda.
  app.post('/api/service-shipments/:id/items/:itemId/receive', (req, res) => {
    try {
      const result = db.transaction(() => {
        const shipment = detail(req.params.id);
        const item = shipment.items.find(i => i.id === Number(req.params.itemId));
        if (!item || item.hasil !== 'DISERVIS') throw new Error('Barang tidak ditemukan atau sudah diterima');
        const { hasil } = req.body || {};
        if (!['BERHASIL', 'GAGAL'].includes(hasil)) throw new Error('Hasil servis harus BERHASIL atau GAGAL');
        const tanggal = tanggalOpsional(req.body.tanggal, 'Tanggal kembali') || todayLocal();
        if (tanggal < shipment.tanggal) throw new Error('Tanggal kembali tidak boleh sebelum tanggal pengiriman');
        const catatan = text(req.body.catatan, 'Catatan hasil');
        let trx = '';
        if (hasil === 'BERHASIL') {
          const master = getMasterItem(item.kode_barang);
          if (!master) throw new Error('Master barang tidak ditemukan; pulihkan master sebelum menerima hasil servis');
          db.prepare("UPDATE items SET stok = stok + ?, updated_at = datetime('now','localtime') WHERE id = ?").run(item.jumlah, master.id);
          trx = logStockMutation({ jenis: 'MASUK', kategori: 'Perbaikan Barang Rusak', divisi: 'GUDANG', item: master,
            jumlah: item.jumlah, harga_satuan: item.harga_barang, tanggal, lokasi: shipment.tujuan,
            keterangan: `${shipment.no_surat} — hasil servis berhasil. ${catatan}`, kondisi: 'Baik' });
          // Status sumber hanya ditutup jika tidak ada sisa maupun kiriman lain yang masih berjalan.
          const pending = db.prepare("SELECT COUNT(*) AS n FROM service_shipment_items WHERE damaged_id = ? AND hasil = 'DISERVIS' AND id != ?").get(item.damaged_id, item.id).n;
          db.prepare("UPDATE damaged_items SET status = CASE WHEN jumlah > 0 THEN 'DITAMPUNG' WHEN ? > 0 THEN 'DISERVIS' ELSE 'DIPERBAIKI' END WHERE id = ?").run(pending, item.damaged_id);
        } else {
          db.prepare("UPDATE damaged_items SET jumlah = jumlah + ?, status = 'DITAMPUNG', updated_at = datetime('now','localtime') WHERE id = ?").run(item.jumlah, item.damaged_id);
        }
        db.prepare(`UPDATE service_shipment_items SET hasil = ?, tanggal_kembali = ?, catatan_hasil = ?, diterima_oleh = ?, no_transaksi = ? WHERE id = ?`)
          .run(hasil, tanggal, catatan, req.user.nama_lengkap || req.user.username, trx, item.id);
        return detail(shipment.id);
      })();
      res.json({ success: true, data: result });
    } catch (err) { res.status(400).json({ success: false, error: err.message }); }
  });
}
