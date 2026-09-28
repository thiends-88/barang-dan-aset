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

4. **Smoke Test Render (opsional)**:
   ```bash
   npm run test:render
   ```
   Memuat setiap komponen dengan data asli dari API untuk memastikan tidak ada error saat render tabel, kartu, dan modal. Server API harus aktif lebih dulu.

5. **Test Integritas API (opsional)**:
   ```bash
   npm run test:api
   ```
   Menguji alur pemasangan, pengeditan, dismantle, dan penghapusan barang untuk Pelanggan, Divisi FO, dan Divisi Tower, lalu memeriksa bahwa stok gudang tidak pernah minus dan **selalu cocok dengan riwayat mutasi**. Data contoh akan direset otomatis di akhir pengujian. Menjalankan keduanya sekaligus: `npm test`.

---

## 🖥️ Deploy ke Proxmox (Production)

Aplikasi ini sudah **siap jalan tanpa build** di server: hasil build frontend ikut tersimpan di folder `dist/`, dan server Express menyajikan `dist/` sekaligus API dari port yang sama (`PORT`, default `3000`).

### 1. Persiapan (sekali saja)

```bash
# Prasyarat: Node.js 22+ (fitur database memakai modul bawaan node:sqlite)
node -v

git clone https://github.com/thiends-88/barang-dan-aset.git /opt/barang-dan-aset
cd /opt/barang-dan-aset
npm install --omit=dev     # cukup dependensi runtime, tanpa alat build
PORT=3000 npm start
```

Buka `http://IP-PROXMOX:3000`.

### 2. Update versi terbaru (setiap kali ada PR di-merge)

> ⚠️ **PENTING:** file database `data/inventory.db` ikut tersimpan di repository. Menjalankan `git pull` akan **menimpa database di server dengan data contoh**, sehingga data asli bisa hilang. Selalu cadangkan dulu:

```bash
cd /opt/barang-dan-aset

# 1) WAJIB: cadangkan database sebelum menarik pembaruan
cp data/inventory.db "data/inventory.backup-$(date +%Y%m%d-%H%M).db"

# 2) Tarik versi terbaru
git pull origin main

# 3) Pasang dependensi bila ada perubahan
npm install --omit=dev

# 4) Jalankan ulang aplikasi
npm start
```

Untuk mengembalikan data setelah `git pull`, salin kembali berkas cadangannya:

```bash
cp data/inventory.backup-YYYYMMDD-HHMM.db data/inventory.db
```

> 💡 **Saran:** agar `git pull` tidak lagi menyentuh database produksi, hapus pelacakan berkas database dari repository (sekali saja, dari komputer pengembangan):
> ```bash
> git rm --cached data/inventory.db
> printf 'data/*.db\n' >> .gitignore
> git commit -m "Berhenti melacak database agar tidak menimpa data produksi"
> ```

### 3. Jalankan otomatis saat server menyala (systemd)

Buat berkas `/etc/systemd/system/barang-dan-aset.service`:

```ini
[Unit]
Description=Sistem Manajemen Barang & Aset ISP
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/barang-dan-aset
Environment=PORT=3000
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
```

Aktifkan:

```bash
systemctl daemon-reload
systemctl enable --now barang-dan-aset
systemctl status barang-dan-aset      # cek status
journalctl -u barang-dan-aset -f      # lihat log
```

### 4. Catatan

- **Port**: ubah lewat environment `PORT`, mis. `PORT=8080 npm start`.
- **Firewall**: pastikan port tersebut dibuka di Proxmox/LXC (`ufw allow 3000` atau aturan di router).
- **Reverse proxy**: bila memakai Nginx/PM2/Caddy, arahkan ke `127.0.0.1:3000`. Server sudah mendukung semua host, jadi tidak perlu konfigurasi tambahan.
- **Backup berkala**: cukup salin folder `data/` (berisi `inventory.db`) atau jadwalkan cron harian:
  ```bash
  0 2 * * * cd /opt/barang-dan-aset && cp data/inventory.db "data/backup-$(date +\%Y\%m\%d).db"
  ```

---

## 🔒 Integritas Data Stok

Seluruh perubahan stok divalidasi di sisi server:

- **Stok tidak bisa minus** — pemasangan/pengeditan ditolak dengan pesan jelas (mis. *"Stok gudang tidak mencukupi untuk ... Tersedia: 20 unit, dibutuhkan: 999 unit."*).
- **Jumlah tidak boleh negatif** — mencegah stok bertambah diam-diam.
- **Kode barang wajib terdaftar** di master data.
- **Pengeditan memakai penyesuaian selisih** — stok hanya berubah sebesar perbedaan pemasangan lama vs baru, dan setiap selisih otomatis tercatat sebagai mutasi masuk/keluar.
- **Menghapus data Pelanggan / FO / Tower mengembalikan stok** barang yang masih terpasang beserta catatan mutasinya, sehingga tidak ada stok yang hilang.
- **Sebelum berubah, semua operasi dibungkus transaksi database** — bila ada satu baris gagal, seluruh perubahan dibatalkan (rollback).

---

## ⚡ Optimasi

- **Pemindai barcode dimuat terpisah (lazy load)** — library kamera `html5-qrcode` hanya diunduh ketika pemindai dibuka, sehingga bundle awal turun dari ~906 kB menjadi ~517 kB (gzip 230 kB → 119 kB).
- **Indeks database** pada kolom yang sering difilter (`transactions.tanggal/jenis/divisi/kode_barang`, kolom kode barang, dan kolom relasi antar tabel) mempercepat laporan, pencarian, dan penghapusan berantai.
- **Notifikasi in-app** menggantikan `alert()` bawaan browser: pesan error panjang (mis. stok tidak mencukupi) tampil rapi, tidak memblokir, dan bertahan lebih lama.

---

## 📱 Dukungan Mobile & Responsif

Aplikasi dirancang agar nyaman dipakai di HP, tablet, dan desktop:

- **Navigasi mobile**: navbar atas ringkas, tab divisi dapat digeser horizontal (scroll), dan tab aktif otomatis digeser ke tengah. Scrollbar disembunyikan agar tampilan bersih.
- **Tabel lebar**: semua tabel memiliki lebar minimum sehingga tetap terbaca dan bisa digeser ke samping, bukan terhimpit menjadi kolom sempit.
- **Modal / dialog**: berubah menjadi *bottom sheet* di layar kecil (menempel di bawah, sudut atas membulat), dengan tinggi maksimal `92vh`, header dan tombol aksi tetap terlihat, serta isi yang bisa di-scroll.
- **Form**: bidang input otomatis menjadi satu kolom di HP; ukuran huruf input minimal `16px` untuk mencegah browser HP melakukan zoom otomatis saat mengetik.
- **Sentuhan**: area tap tombol dalam tabel diperbesar, highlight biru saat tap dihilangkan, dan animasi dihormati bagi pengguna yang mengaktifkan *reduce motion*.
- **Notch / safe area**: elemen yang menempel di bawah (toast, bottom sheet) memberi ruang untuk *safe area* perangkat iOS.
- **Cetak**: hasil cetak (label barcode, berita acara, laporan) tidak terpengaruh perubahan layout layar — lebar minimum tabel dinonaktifkan saat mode cetak.
