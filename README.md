# Sistem Manajemen Data Barang & Aset Terintegrasi
### Pelanggan • Divisi FO • Divisi Tower • Barcode Scanner • Laporan Berkala

Aplikasi enterprise untuk manajemen inventaris barang dan pelacakan aset jaringan telekomunikasi/ISP yang terintegrasi penuh ke semua lini divisi operasional.

---

## 🌟 Fitur Utama

### 1. Input Master Barang (Katalog & Stok Logistik)
- **Kode Barang**: Unique identification code dengan barcode otomatis.
- **Nama Barang**: Deskripsi lengkap perangkat/material.
- **Satuan**: Unit, Roll, Meter, Bks, Pcs, Pack, Set.
- **Jenis / Kategori Barang Fleksibel (Dapat Ditambahkan Manual Sesuai Keinginan)**:
  - Dilengkapi sistem Master Kategori dinamis (`/api/categories`).
  - Pengguna dapat mengetikkan kategori baru secara langsung saat input barang (`+ Ketik Kategori Baru`) atau melalui menu **Kelola Kategori**.
  - Modal Kelola Kategori: tambah kategori baru, ubah nama kategori (otomatis mengupdate semua barang terkait), lihat jumlah barang per kategori, dan hapus kategori yang sudah tidak digunakan.
  - Dropdown filter kategori diperbarui secara realtime sesuai kategori yang tersedia.
- **Harga Barang (Rp)**: Harga satuan standar pengadaan.
- **Referensi Suplayer / Pembelian**: Data vendor dan suplayer pengadaan barang.
- **Stok Gudang & Peringatan Stok Menipis**: Alert otomatis ketika sisa stok di bawah batas minimum.
- **Cetak Label Barcode**: Generator label sticker barcode (Code128) siap cetak langsung.
- **Pencatatan Serial Number (SN / MAC Address)**: Pelacakan perangkat unik pada tiap barang terpasang.

### 2. Divisi Pelanggan
- **ID Pelanggan**: Format kode pelanggan (contoh: `CUST-OPT-001`).
- **Nama Pelanggan**: Identitas pelanggan perorangan atau korporasi.
- **Infrastruktur**:
  - `wireless` (Radio CPE / Antena)
  - `optic` (Kabel Dropcore / Modem ONT)
- **Paket Berlangganan**:
  - `personal`, `home`, `family`, `middle`, `soho`, `small`, `little`, `bronze`, `free`, `parallel`, `custom`, `dedicated`
  - Keterangan paket (kecepatan, IP Public, rasio bandwidth).
- **Kategori**: `bandwidth`, `rent`, `service`, `kombinasi`.
- **Status Pelanggan**: `aktif`, `blokir`, `cuti`, `putus`.
- **Barang Terpasang (Multi-Item Dynamic Rows)**:
  - Input beberapa barang sekaligus secara dinamis.
  - Saat memilih / memasukkan kode barang, nama barang, jenis barang, satuan, harga, dan referensi suplayer langsung muncul otomatis tanpa perlu diketik manual!
  - Jumlah dengan berbagai pilihan satuan (unit, roll, meter, bks, pcs).
  - Subtotal per item dihitung otomatis (`jumlah * harga_barang`).
  - Total harga barang terpasang dijumlahkan secara otomatis.
- **Fitur Bongkar / Dismantle**:
  - Saat pelanggan berhenti langganan (status putus) atau perangkat ditarik, fitur dismantle otomatis mengembalikan stok barang ke gudang dan mencatat log mutasi masuk.

### 3. Divisi FO (Fiber Optic)
- **Daerah / Lokasi**: Titik sebaran FO (contoh: `Jl. Sudirman Depan Gedung Bank`, `Simpang KM 12`, `ODP-01 Sentral Hub`).
- **PIC / Teknisi FO**: Penanggung jawab teknis pemasangan.
- **Tanggal Pasang & Catatan**: Tanggal instalasi dan keterangan rincian titik FO.
- **Barang Terpasang (Multi-Item Dynamic Rows)**:
  - Input beberapa barang sekaligus secara dinamis dengan auto-fill jenis, harga, dan referensi suplayer berdasarkan kode barang.
  - Pencatatan Serial Number (SN / MAC) untuk setiap perangkat FO terpasang.
  - Subtotal & Total harga barang terpasang dihitung otomatis.
  - Memotong stok gudang dan mencatat log mutasi barang keluar divisi FO secara otomatis.

### 4. Divisi Tower (BTS Wireless)
- **Daerah / Lokasi Site**: Contoh `Site Tower BTS Bukit Bintang`, `Monopole Cabang Barat`.
- **Jenis**: `tower` atau `monopol`.
- **Type**: `monopol`, `triangle`, `square`.
- **Ketinggian**: Contoh `30 meter`, `45 meter`.
- **Kepemilikan**: `Milik Sendiri`, `Sewa Lahan`, `Bersama / Colocation`, `Provider Partner`.
- **PIC / Teknisi Tower Riggers**: Teknisi menara.
- **Barang Terpasang**:
  - Multi-item dynamic rows (Radio wireless, section tower, spanscrew, kawat sling, UPS, switch).
  - Auto-fill harga, subtotal, dan total harga otomatis.
  - Memotong stok gudang dan mencatat log barang keluar divisi Tower secara otomatis.

### 5. Barcode Scanner & Pelacakan Aset Cerdas
- **Scanner Kamera Langsung**: Menggunakan kamera laptop/smartphone untuk memindai barcode / QR code barang secara realtime.
- **Kompatibilitas USB Barcode Scanner Gun**: Mendukung barcode scanner eksternal untuk pemindaian instan di gudang.
- **Asset Intelligence (Terpasang Dimananya)**:
  - Sekali scan barcode barang, sistem langsung menampilkan:
    1. Detail spesifikasi barang, harga, dan suplayer.
    2. Sisa stok di gudang.
    3. Daftar pelanggan mana saja yang sedang memakai barang tersebut beserta status dan kuantitasnya.
    4. Daftar titik divisi FO mana saja yang memakai barang tersebut.
    5. Daftar site divisi Tower mana saja yang memakai barang tersebut.
    6. Riwayat mutasi keluar/masuk barang tersebut lengkap tanggal, bulan, dan tahunnya.

### 6. Laporan Terpadu (Reporting Engine)
- **Laporan Barang Masuk & Keluar**:
  - Filter rentang tanggal bebas (Dari - Sampai).
  - Filter per Minggu (Minggu ke-1, 2, 3, 4, 5).
  - Filter per Bulan (Januari - Desember).
  - Filter per Tahun.
  - Filter divisi (Semua, Pelanggan, Divisi FO, Divisi Tower, Gudang).
  - Filter jenis transaksi (Semua, Hanya Masuk, Hanya Keluar).
  - Rekapitulasi: Total transaksi, kuantitas barang masuk & keluar, total nilai rupiah masuk & keluar, serta selisih net.
- **Laporan Matriks Sebaran Barang Terpasang (Where Installed Matrix)**:
  - Menjawab posisi setiap barang terpasang di mana saja di semua pelanggan dan masing-masing divisi.
- **Laporan Valuasi Aset per Divisi**:
  - Total nilai aset fisik terpasang di Gudang, Pelanggan, FO, dan Tower.
- **Fitur Ekspor & Cetak**:
  - Ekspor data ke CSV / Excel.
  - Tampilan cetak resmi (Print / PDF) lengkap dengan kop dan lembar persetujuan.

---

## 🚀 Panduan Menjalankan Aplikasi

1. **Jalankan Server**:
   ```bash
   node server/index.js
   ```
   Aplikasi akan berjalan di port `3000` (http://0.0.0.0:3000).

2. **Membangun Frontend (Build)**:
   ```bash
   npm run build
   ```

3. **Reset Data Simulasi (Demo Data)**:
   Klik tombol **"Reset Data Contoh"** di navbar atas kapan saja untuk mengembalikan dan mengisi ulang database simulasi ISP lengkap.
