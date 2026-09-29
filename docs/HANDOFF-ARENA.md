# HANDOFF ARENA — SIM-ASET ISP

> **Serah terima proyek untuk sesi Arena berikutnya.**
> Berisi semua keputusan yang sudah diambil, kebiasaan kerja yang sudah mapan, jebakan yang
> pernah kena, dan hal-hal yang belum selesai — supaya sesi baru tidak mengulang debat yang
> sama atau merusak hal yang sudah disepakati.
>
> Terakhir diperbarui: **29 September 2026** · basis commit: `984e2c3` (merge PR #3)
> Repo: <https://github.com/thiends-88/barang-dan-aset> · Branch kerja sesi ini: `arena/01a0ec98-barang-dan-aset`

---

## 0. Cara memakai dokumen ini

1. Baca **§1–§4** dulu (konteks, aturan sesi, cara menjalankan, cara menguji) — cukup 5 menit.
2. Sebelum mengubah kode, cek **§5 (konvensi kode)** dan **§6 (keputusan domain)**.
   Banyak "aturan aneh" di aplikasi ini adalah keputusan sadar, bukan bug.
3. Sebelum menutup sesi, jalankan **§10 (checklist penutup sesi)**.
4. Kalau ada pertanyaan "kenapa dulu dibuat begini?", lihat **§11 (jebakan & pelajaran)**
   dan riwayat PR #1–#3 di GitHub — deskripsinya sangat rinci dan berbahasa Indonesia.

---

## 1. Ringkasan proyek

| Item | Keterangan |
|---|---|
| Nama aplikasi | **SIM-ASET ISP** — Sistem Manajemen Data Barang & Aset Terintegrasi |
| Pengguna | Operator ISP / telekomunikasi (PT. CINOXMEDIA NETWORK INDONESIA, Solok) |
| Cakupan | Master barang & kategori, Pelanggan, Divisi FO, Divisi Tower, gudang logistik, mutasi stok, barcode scanner, laporan/valuasi, login & manajemen user, import massal |
| Ukuran kode | ± 14.200 baris (± 10.000 frontend, ± 3.500 server, ± 700 test) |
| Backend | Node.js 22+ · Express 5 · `node:sqlite` (DatabaseSync, modul bawaan Node) — **tanpa ORM** |
| Frontend | React 19 · Vite 8 (rolldown) · Tailwind v4 (`@tailwindcss/vite`) · lucide-react · xlsx · jsbarcode · html5-qrcode |
| Database | Satu file: `data/inventory.db` (SQLite, WAL) |
| Bahasa | **Seluruh UI, komentar, pesan error, test, dan PR memakai Bahasa Indonesia** |
| Deploy | Proxmox / LXC: `node server/index.js` menyajikan API **dan** `dist/` di satu port (`PORT`, default 3000) |

**Alur bisnis inti:** stok masuk ke gudang (pembelian/import) → dipasang ke Pelanggan / titik FO /
site Tower (stok berkurang, tercatat sebagai barang terpasang) → di-dismantle/dikembalikan
(stok bertambah lagi) — dan **setiap** perubahan stok wajib punya jejak di tabel `transactions`.

---

## 2. Aturan main sesi Arena

- **Satu sesi = satu branch** bernama `arena/<id-sesi>-barang-dan-aset`, dibuat dari `main`,
  lalu di-merge lewat Pull Request ke `main`. PR #1, #2, #3 sudah di-merge dengan pola ini.
  Contoh branch yang sudah ada: `arena/01a0e613-...`, `arena/01a0e75a-...`, `arena/01a0eadc-...`.
- **Jangan pernah** force-push / commit langsung ke `main`. Semua perubahan lewat PR.
- Author PR adalah akun otomasi `app/arena-ai-coding-agent`; **yang me-merge adalah pemilik repo
  (thiends-88)** — jangan merge PR sendiri.
- Branch sesi ini **tidak boleh dipindah**: seluruh pekerjaan tetap di
  `arena/01a0ec98-barang-dan-aset` (Arena melacak sesi lewat nama branch ini).
- Riwayat `main` di checkout Arena bisa tampak hanya 1 commit (hasil penyederhanaan saat clone).
  **Konteks lengkap ada di halaman PR GitHub**, bukan di `git log` lokal.
- Perubahan besar/berisiko (mis. menyentuh integritas stok atau menghapus data) **selalu**
  diverifikasi ulang dengan test, bukan hanya "kelihatan jalan".

---

## 3. Peta berkas

```
server/
  index.js   → SEMUA endpoint API (± 2.700 baris): auth, users, categories, items,
               import, customers, fo, tower, transactions, scanner, reports, reset-seed
  db.js      → koneksi node:sqlite, pemaksaan zona waktu, skema tabel, migrasi, indeks
  seed.js    → seedUsers() (4 akun awal) & seedData() (dataset demo ISP)
  auth.js    → scrypt hash password + token HMAC stateless (tanpa library)

src/
  App.jsx            → router tab sederhana + state global (items, customers, fo, tower),
                       gerbang login, toast, penjaga hak akses tab
  main.jsx           → bootstrap React
  index.css          → Tailwind + seluruh aturan mobile & CETAK (@page, no-print, print-only)
  components/
    LoginPage.jsx        Dashboard.jsx         MasterBarang.jsx
    DivisiPelanggan.jsx  DivisiFO.jsx          DivisiTower.jsx
    KeluarMasukBarang.jsx (mutasi + scan tertaut divisi)
    Laporan.jsx           (3 tab: mutasi, sebaran, valuasi)
    BarcodeScannerModal.jsx (lazy-load html5-qrcode)   BarcodeLabelModal.jsx   BarcodeRenderer.jsx
    CategoryManagerModal.jsx  ImportDataModal.jsx      UserManagement.jsx
    WorkOrderPrintModal.jsx (BASTP pelanggan / berita acara FO / Tower)  Navbar.jsx
  utils/
    auth.js       → sesi localStorage, peta MENU_ACCESS, penambal window.fetch
    formatters.js → todayLocal(), formatRupiah(), formatNumber(), formatDate(), exportToCSV()
    notify.js     → pub/sub notifikasi in-app (pengganti alert())

api-test.mjs       → 73 tes integrasi API (integritas stok, auth, peran, waktu, scan tertaut)
ssr-test.mjs       → 17 smoke test render komponen dengan data asli API
contoh-import/     → barang.csv, pelanggan.csv (contoh file import)
data/inventory.db  → database (IKUT ter-commit di git — lihat §7 & §11)
dist/              → hasil build frontend (IKUT ter-commit — lihat §8)
```

---

## 4. Menjalankan, mengembangkan, menguji

### 4.1 Mode pengembangan (dua proses)

```bash
npm install

# Terminal 1 — API di port 3001 (WAJIB 3001, lihat di bawah)
PORT=3001 node server/index.js

# Terminal 2 — Vite dev server di port 3000 (host 0.0.0.0, allowedHosts: true)
npm run dev          # = vite → http://0.0.0.0:3000, proxy /api → 127.0.0.1:3001
```

- Vite sudah dikonfigurasi: `host: '0.0.0.0'`, `port: 3000`, `allowedHosts: true`,
  dan `proxy '/api' → http://127.0.0.1:3001` (`vite.config.js`). Di sandbox Arena, buka
  preview pada port **3000** (frontend + API lewat proxy — jangan arahkan browser ke 3001).
- **Port 3000 dipakai Vite di mode dev**, jadi API harus dijalankan di **3001**.
  (Di produksi hanya ada satu proses: API + `dist/` sama-sama di port 3000.)

### 4.2 Mode produksi / Proxmox

```bash
npm install --omit=dev          # dist/ sudah ikut repo, tidak perlu build di server
PORT=3000 npm start             # = node server/index.js
```

Server Express menyajikan `dist/` secara statis, fallback SPA ke `dist/index.html`,
dan semua `/api/*` dari port yang sama. Detail lengkap (systemd, firewall, backup,
reverse proxy) ada di `README.md` bagian **Deploy ke Proxmox**.

### 4.3 Test (server test harus hidup di 3001)

```bash
PORT=3001 node server/index.js &     # siapkan server untuk pengujian
npm test                             # = api-test.mjs && ssr-test.mjs
npm run test:api                     # 73 tes integrasi API
npm run test:render                  # 17 smoke test render (SSR)
```

> Hasil terakhir (commit `984e2c3`, diverifikasi ulang 29 Sep 2026): **API 73/73 lolos,
> SSR 17/17 lolos, `npm run build` sukses.**
>
> ⚠️ `api-test.mjs` **menulis ke database asli** dan di akhir menjalankan ulang data contoh.
> Kalau DB sedang berisi data penting, **cadangkan dulu** (`cp data/inventory.db /tmp/…`)
> dan kembalikan setelah pengujian.

### 4.4 Build frontend

```bash
npm run build        # keluaran ke dist/ (hash nama file berubah)
```

`dist/` **ikut di-commit** karena server Proxmox tidak melakukan build. Jadi setiap
perubahan frontend wajib disertai hasil build terbaru di PR yang sama.
Catatan: build di mesin/lingkungan berbeda bisa menghasilkan *hash* nama berkas yang
berbeda walau ukurannya nyaris sama (pernah: `index-W0YyTs-9.js` vs `index-BETudh2p.js`) —
itu wajar karena perbedaan versi toolchain, bukan bug.

### 4.5 Akun demo (dibuat sekali saat tabel `users` kosong — `server/seed.js`)

| Peran | Username | Password | Label tampilan |
|---|---|---|---|
| `admin` | `admin` | `admin123` | Administrator |
| `staff_gudang` | `gudang` | `gudang123` | Staff Gudang |
| `teknisi` | `teknisi` | `teknisi123` | Teknisi Lapangan |
| `viewer` | `viewer` | `viewer123` | Viewer (Hanya Lihat) |

> Deskripsi PR #3 menyebut akun "kantor/kantor123" — itu **tidak ada di kode**. Yang benar
> adalah `viewer/viewer123`. Selalu jadikan kode sebagai sumber kebenaran.

---

## 5. Konvensi kode (kebiasaan yang sudah mapan)

### 5.1 Bahasa & gaya umum
- **Bahasa Indonesia** untuk UI, komentar, pesan error, judul/isi PR, dan nama variabel domain
  (`kode_barang`, `jumlah`, `tanggal_pasang`, `lokasi_penerima`). Nama teknis umum tetap Inggris
  (`items`, `useState`, `handleSubmit`).
- Komentar ditulis sebagai **penjelasan "kenapa"**, bukan "apa" — sering memuat alasan historis
  (contoh: kenapa `overflow-x: clip` bukan `hidden`, kenapa token dikirim multi-saluran).
- Tidak menambah dependensi bila bisa memakai modul bawaan Node (contoh: auth memakai
  `crypto.scryptSync` + HMAC, bukan jsonwebtoken/bcrypt).

### 5.2 Server (Express 5)
- **Pola respons seragam**: sukses `{ success: true, data: ... }`, gagal
  `{ success: false, error: 'pesan Bahasa Indonesia yang bisa dibaca operator' }`.
  Status: 201 untuk create, 400 untuk validasi, 401/403 untuk auth, 404 untuk not found.
- Setiap route dibungkus `try { ... } catch (err) { res.status(500).json({ success:false, error: err.message }) }`.
- Operasi yang menyentuh stok **selalu** dibungkus `db.transaction(...)`
  (wrapper `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` di `db.js`) — satu baris gagal = semua batal.
- SQL selalu **parameterized**. ⚠️ Jangan memakai kutip ganda (`"..."`) untuk literal teks di
  SQLite — dianggap nama kolom dan pernah menimbulkan error `no such column: "putus"`
  (lihat §11).
- Nomor transaksi: `TRX-IN-YYYYMM-NNNN` / `TRX-OUT-YYYYMM-NNNN` (`generateTrxNumber`).
- Tanggal server **hanya** dari `todayLocal()` (di `server/index.js`) — jangan
  `toISOString()`.

### 5.3 Frontend (React 19)
- **Tanpa router, tanpa state manager.** `App.jsx` memegang state global dan meneruskan props;
  tab aktif = string di state. Tabel/kartu di-render ulang dari `loadAllData()` setelah aksi.
- Semua akses `fetch('/api/...')` **relatif**; token disuntik otomatis oleh `installAuthFetch()`
  di `src/utils/auth.js` (menambal `window.fetch` satu kali dari `App.jsx`).
- **Jangan memakai `alert()` / `confirm()` bawaan browser.** Pakai `notify('pesan', 'error' | 'success')`
  dari `src/utils/notify.js` → tampil sebagai toast di `App.jsx` (error tampil 7 detik, sukses 4 detik).
  `window.confirm` hanya dipakai untuk konfirmasi hapus/reset yang sifatnya destruktif.
- Format angka/tanggal wajib lewat `src/utils/formatters.js` (`formatRupiah`, `formatNumber`,
  `formatDate`, `formatDateTime`, `todayLocal`, `exportToCSV`) — jangan format manual.
- Komponen harus **aman di-render di SSR** (tanpa `window`/`localStorage` di jalur render) karena
  dipakai `ssr-test.mjs`.
- Library berat dimuat malas: `BarcodeScannerModal` lewat `React.lazy` + `Suspense` dengan
  fallback "Memuat pemindai barcode..."; `xlsx` juga `await import()` di server untuk template.

### 5.4 Hak akses (satu sumber kebenaran = server)
- Peta izin di `server/index.js` (`WRITE_RULES`) dan di UI (`MENU_ACCESS`, `canManageInventory`,
  `canManageDivisions` di `src/utils/auth.js`) harus **selalu selaras**; server tetap penentu akhir.
- `GET` boleh untuk semua peran yang sudah login. `POST/PUT/DELETE` dibatasi peran;
  `viewer` tidak boleh menulis apa pun (default tolak).
- UI menyembunyikan/menonaktifkan aksi dengan prop `canEdit` — bukan sekadar mengandalkan error server.

### 5.5 Tampilan (Tailwind v4)
- Palet: latar `bg-slate-100`, kartu `bg-white rounded-2xl border border-slate-200 shadow-sm`,
  aksen utama **indigo** (`indigo-600`), tombol aksen `rounded-xl text-xs font-semibold`.
- Warna per divisi (dipakai konsisten di dashboard & kartu): Pelanggan = **biru**,
  FO = **emerald**, Tower = **ungu/purple**, Gudang = **slate**, peringatan = **amber/rose**.
- Ikon selalu dari `lucide-react`, ukuran `w-4 h-4` (tombol) / `w-5 h-5` (kartu).
- Teks UI kecil-padat: label `text-xs font-bold uppercase tracking-wider`, isi `text-xs`.
- Kelas bantu buatan sendiri (didefinisikan di `src/index.css`, **jangan lupa didefinisikan** saat dipakai):
  `scrollbar-none`, `animate-slideUp`, `no-print`, `print-only`, `print-page-laporan`.

### 5.6 Mobile & cetak
- Semua tabel lebar memakai `min-w-[...]` + pembungkus `overflow-x-auto` supaya bisa digeser,
  bukan terhimpit. Modal menjadi *bottom sheet* di layar kecil (maks `92vh`).
- Input minimal 16px di layar kecil (mencegah zoom otomatis iOS) — sudah global di `index.css`.
- Elemen yang menempel di bawah menghormati `env(safe-area-inset-bottom)`.
- Cetak: `@page` margin 10mm/8mm; laporan memakai `@page laporan { size: A4 landscape }`
  (BASTP tetap portrait); blok kop & tanda tangan memakai `.print-only`, tombol/filter `.no-print`;
  pembungkus scroll dibuka saat cetak (`overflow: visible !important`), `min-w-*` dianulir,
  `.truncate` dinormalkan, `thead` diulang tiap halaman.
- Kop dokumen resmi: **PT. CINOXMEDIA NETWORK INDONESIA**, JL. Adityawarman No. 366,
  Kampung Jawa, Kota Solok (dipakai di laporan & berita acara — ubah di dua tempat bila berubah).

### 5.7 Tanggal & zona waktu (hasil perbaikan PR #3)
- Zona waktu aplikasi dipaksa **Asia/Jakarta** di `server/db.js` (`process.env.TZ`), dapat
  di-override lewat `APP_TZ` (mis. `Asia/Makassar`) — harus di-set **sebelum** pemakaian
  `Date`/SQLite apa pun.
- Frontend memakai `todayLocal()` (bukan `new Date().toISOString()`) untuk semua default tanggal.
- Ada endpoint diagnostik publik `GET /api/health` (tanpa login) yang mengembalikan
  `serverTime`, `timezone`, `offsetMinutes` (WIB = 420) — pakai ini saat mencurigai jam tidak sinkron.

---

## 6. Keputusan domain yang sudah disepakati (jangan diubah tanpa alasan kuat)

### 6.1 Integritas stok — non-negotiable
1. **Stok gudang tidak boleh minus.** Pemasangan/pengeditan ditolak dengan pesan jelas,
   mis. *"Stok gudang tidak mencukupi … Tersedia: 20 unit, dibutuhkan: 999 unit."*
2. **Jumlah tidak boleh negatif / nol** (mencegah stok bertambah diam-diam).
3. **Kode barang wajib terdaftar** di master; kode tak dikenal ditolak, bukan diabaikan diam-diam.
4. **Edit = penyesuaian selisih**, bukan "kembalikan semua lalu potong ulang". Stok hanya berubah
   sebesar selisihnya, dan setiap selisih tercatat sebagai mutasi masuk/keluar.
5. **Menghapus Pelanggan/FO/Tower mengembalikan stok** barang yang masih terpasang + mencatat
   mutasi. Karena itu relasi item **tidak** memakai `ON DELETE CASCADE` pada alur hapus manual —
   handler menghitung dan mengembalikan stok lebih dulu, baru menghapus.
6. Semua operasi di atas dibungkus transaksi database; gagal satu baris = rollback total.
7. Invarian yang diuji otomatis: `stok_sekarang == stok_snapshot + Σ(mutasi tercatat)` dan
   `tidak ada stok < 0`. **Setiap fitur baru yang menyentuh stok wajib menjaga invarian ini.**

### 6.2 Dismantle & pengembalian
- Dismantle (`POST /api/customers/:id/dismantle`) mengosongkan barang terpasang, menambah stok
  gudang, dan mencatat mutasi MASUK beralasan "Pengembalian / Dismantle".
- Saat pelanggan berstatus `putus`, dismantle adalah jalur resmi pengembalian perangkat.

### 6.3 Transaksi tertaut divisi (`POST /api/transactions`)
- Jika `divisi` ∈ {`PELANGGAN`, `DIVISI FO`, `DIVISI TOWER`} **dan** `tujuan_id` diisi, transaksi
  menjadi **tertaut**: KELUAR = barang langsung tercatat terpasang di tujuan; MASUK = barang
  dikurangi dari daftar terpasang dan stok gudang kembali.
- Peta tujuan ada di konstanta `LINKED_DIVISI` (`customers`/`customer_items`,
  `fo_sites`/`fo_items`, `tower_sites`/`tower_items`).
- Barang dengan kode & SN sama di tujuan sama **digabung** (qty ditambah), tidak membuat baris dobel.
- Nilai aset tujuan (`total_harga`) disinkronkan otomatis setiap perubahan.
- Mode **manual Gudang** (tanpa `tujuan_id`) tetap ada untuk pembelian supplier, retur, barang
  rusak, koreksi stok — dan tetap mewajibkan `lokasi_penerima`/keterangan.
- Penolakan yang disepakati (HTTP 400): stok kurang, pengembalian melebihi jumlah terpasang,
  tujuan tidak ditemukan, jumlah ≤ 0.

### 6.4 Scanner barcode
- Satu pintu: `GET /api/scanner/lookup/:code` mencari berdasarkan **kode barang** (case-insensitive)
  **atau** **serial number/SN** di ketiga tabel item terpasang (`matchedBySN: true`).
- Balikan berisi stok gudang, sebaran di pelanggan/FO/Tower, total keseluruhan, nilai aset,
  dan 15 transaksi terakhir — inilah fitur "barang ini terpasang di mana saja".
- Label cetak memakai Code128 (`jsbarcode`); pemindai kamera memakai `html5-qrcode` yang
  di-lazy-load; scanner USB didukung lewat input teks + Enter.

### 6.5 Kategori dinamis
- Kategori **bukan** enum: tabel `categories` + `/api/categories`, bisa ditambah langsung dari
  form barang (`+ Ketik Kategori Baru`) atau modal **Kelola Kategori** (ubah nama → otomatis
  meng-update semua barang terkait; hapus hanya bila tidak dipakai).

### 6.6 Import massal
- Endpoint: `POST /api/items/import` dan `POST /api/customers/import`, payload `{ rows, mode }`
  (`mode: 'skip' | 'update'`), maksimum **5000 baris** (`MAX_IMPORT_ROWS`), body JSON maks 5 MB.
- Template resmi diunduh dari `GET /api/import/template/:type?format=xlsx|csv`
  (`items` | `customers`) — **endpoint publik tanpa login** karena hanya berkas statis.
  CSV memakai pemisah `;` + BOM agar rapi di Excel Indonesia.
- Stok awal hasil import **dicatat sebagai transaksi MASUK** supaya riwayat tetap konsisten.
- Contoh berkas ada di `contoh-import/`.

### 6.7 Auth & sesi
- Password: `scrypt` + salt acak, disimpan `salt:hash`, verifikasi `timingSafeEqual`.
- Sesi: token stateless `payload.signature` (HMAC-SHA256, `AUTH_SECRET`, masa berlaku 7 hari),
  disimpan di `localStorage` (`bda_token`, `bda_user`).
- Token dikirim **multi-saluran** (header `Authorization`, `X-Session-Token`, query `_token`
  untuk GET) karena sebagian proxy preview membuang header Authorization.
- 401 hanya menendang sesi bila **dikonfirmasi** oleh probe ke `/api/auth/me` yang menjawab JSON;
  401 ber-content-type HTML (gateway/sandbox bangun tidur) diabaikan + sesi dipertahankan.
- Rate limit login: 15 percobaan gagal / 5 menit per `ip|username` → HTTP 429.
- Admin tidak bisa menurunkan/menonaktifkan/menghapus dirinya sendiri atau admin aktif terakhir.

### 6.8 Data & seed
- `seedData()` **idempoten** (hanya mengisi bila tabel kosong), `seedUsers()` mengisi 4 akun demo.
- `POST /api/reset-seed` (khusus `admin`, tombol "Reset Data Contoh" di navbar) menghapus data
  operasional (bukan user) dan mengisi ulang dataset demo ISP.
- `PRAGMA wal_checkpoint(TRUNCATE)` dijalankan saat start supaya data benar-benar tertulis ke
  berkas `.db` utama (bukan hanya WAL) — penting agar snapshot workspace tidak kehilangan data.

---

## 7. Database & data

- Tabel: `categories`, `items`, `customers`, `customer_items`, `fo_sites`, `fo_items`,
  `tower_sites`, `tower_items`, `transactions`, `users`.
- Skema dibuat dengan `CREATE TABLE IF NOT EXISTS`; penambahan kolom baru memakai daftar
  `migrations` (`ALTER TABLE ... ADD COLUMN`, dibungkus try/catch) di `server/db.js`.
  **Cara menambah kolom baru = tambahkan entri di array itu**, jangan menulis migrasi lain.
- 11 indeks dibuat `IF NOT EXISTS` untuk kolom yang sering difilter (tanggal/jenis/divisi/kode
  barang/kunci relasi) — tambahkan indeks bila muncul query lambat baru.
- Kolom uang disimpan sebagai `REAL`, tanggal `YYYY-MM-DD` teks, waktu `HH:MM:SS` teks
  (kompatibel `datetime('now','localtime')`).
- **`data/inventory.db` ikut di-commit.** Ini keputusan lama yang masih berlaku (server Proxmox
  tarik data contoh lewat `git pull`), tetapi berisiko: `git pull` di server **menimpa** database
  produksi. Prosedur wajib: cadangkan dulu (`cp data/inventory.db data/inventory.backup-$(date +%Y%m%d-%H%M).db`)
  sebelum pull. README sudah memuat peringatan + saran melepas pelacakan file DB
  (`git rm --cached data/inventory.db`, tambahkan `data/*.db` ke `.gitignore`) — saran ini
  **belum dieksekusi**, lihat §12.

---

## 8. Deployment (Proxmox)

- Prasyarat: **Node.js 22+** (modul `node:sqlite` masih eksperimental — warning di log itu normal).
- `dist/` ikut repository → di server cukup `npm install --omit=dev` lalu `npm start`.
- Layanan systemd contoh (`/etc/systemd/system/barang-dan-aset.service`) ada di README;
  `Restart=always`, `Environment=PORT=3000`, `Environment=NODE_ENV=production`.
- Port diubah lewat env `PORT`; server listen di `0.0.0.0`, aman di balik Nginx/Caddy
  (`127.0.0.1:3000`) dan sudah `cors()` terbuka untuk pemakaian internal.
- Backup cukup menyalin folder `data/`; README menyertakan contoh cron harian.
- Jangan lupa set **`AUTH_SECRET`** (dan `APP_TZ` bila bukan WIB) di environment service;
  default di kode hanya untuk pengembangan.

---

## 9. Kebiasaan Git & PR

- Judul PR & isi PR **Bahasa Indonesia**, terstruktur: ringkasan → daftar perubahan per fitur →
  tabel hasil pengujian → catatan deploy/langkah update di server.
- Satu PR = satu rangkaian perubahan yang koheren (mis. "Login & user management, import massal,
  scan barcode tertaut divisi, sinkron WIB, PDF laporan"). Hindari PR "campur semua".
- Sertakan **angka hasil tes** (`73/73`, `17/17`) dan, bila relevan, **angka sebelum/sesudah**
  (mis. ukuran bundle 906 kB → 517 kB).
- `dist/` hasil build ikut di-commit di PR yang sama dengan perubahan frontend.
- Yang **tidak** boleh masuk repo: `node_modules/`, berkas `*.db-wal` / `*.db-shm` / `*.db-journal`
  (sudah ada di `.gitignore`), sampah eksperimen. `data/inventory.db` sendiri **tetap dilacak**
  sampai keputusan §12 diambil.

---

## 10. Checklist penutup sesi

1. `npm install` (bila `package.json` berubah) —
   dependensi baru wajib tercermin di `package-lock.json`.
2. Jalankan server di 3001, lalu:
   - `npm run test:api` → harapan **73/73 lolos**
   - `npm run test:render` → harapan **17/17 lolos**
   - bila menambah fitur, **tambahkan seksi tesnya** di `api-test.mjs` / `ssr-test.mjs`
     mengikuti gaya yang ada (fungsi `ok()` / `bad()`, judul seksi `=== N. ... ===`).
3. `npm run build` bila menyentuh frontend; pastikan `dist/` ter-commit.
4. Kembalikan `data/inventory.db` ke kondisi semula bila pengujian mengubahnya dan perubahan itu
   bukan maksud sesi ini (`git checkout -- data/inventory.db`).
5. Pastikan `git status` bersih dari berkas tak sengaja (`-shm`, `-wal`, hasil eksperimen).
6. Perbarui `README.md` bila perilaku yang dijelaskan di sana berubah, dan perbarui dokumen ini
   bila ada keputusan baru.
7. Commit dengan pesan Bahasa Indonesia yang menjelaskan *dampak*, push ke branch sesi,
   lalu buka PR ke `main` (jangan merge sendiri).

---

## 11. Jebakan & pelajaran (yang pernah benar-benar kena)

| Jebakan | Gejala | Aturan sekarang |
|---|---|---|
| Kutip ganda di SQL SQLite (`status = "putus"`, `date("now")`) | Dismantle gagal: `no such column: "putus"`; penyesuaian stok error | Pakai placeholder `?` atau kutip tunggal untuk literal |
| Pemasangan tanpa cek stok (versi awal) | Stok jadi −979 | Validasi stok di server sebelum memotong |
| Edit memakai pola "kembalikan semua → potong ulang" | Stok bisa minus & perubahan tidak tercatat | Penyesuaian selisih + catat mutasi tiap selisih |
| Hapus Pelanggan/FO/Tower memakai `CASCADE` | Stok hilang permanen tanpa jejak | Kembalikan stok dulu, lalu hapus, semua dalam 1 transaksi |
| `toISOString()` untuk tanggal | Selisih 1 hari (UTC vs WIB) jam 00.00–06.59 | `todayLocal()` di server & frontend; TZ dipaksa `Asia/Jakarta` |
| Riwayat lama (sebelum PR #3) | Stempel waktu masih UTC (geser +7 jam) | Diketahui & didokumentasikan; koreksi hanya bila diminta pemilik |
| Kelas Tailwind dipakai tapi tak pernah didefinisikan (`scrollbar-none`, `animate-slideUp`) | Fitur tampak "tidak jalan" tanpa error | Setiap kelas kustom wajib ada di `src/index.css` |
| 401 HTML dari gateway/proxy preview | Sesi ter-logout sendiri / data gagal dimuat | Token multi-saluran + konfirmasi 401 lewat probe `/api/auth/me` |
| Port bentrok 3000 (Vite vs API) | Proxy /api mati / `ECONNREFUSED` | Dev: Vite 3000 + API 3001. Test: API 3001 |
| `git pull` di server menimpa `data/inventory.db` | Data produksi hilang tertimpa data contoh | Selalu backup DB sebelum pull (§7) |
| Build menghasilkan hash nama berkas berbeda | Diff `dist/` terlihat besar padahal ukuran sama | Wajar (beda toolchain); commit hasil build terbaru, jangan panik |
| Body JSON default Express | Import massal ditolak 413 | Limit dinaikkan ke 5 MB + batas 5000 baris |

---

## 12. Status terkini & yang belum selesai

**Sudah selesai (semua lolos tes):** master barang + kategori dinamis, Pelanggan/FO/Tower dengan
multi-item & SN, dismantle, integritas stok transaksional, scanner kamera/USB + label barcode,
mutasi + transaksi tertaut divisi, laporan (mutasi/sebaran/valuasi) + cetak A4 landscape,
login & manajemen user berperan, import massal CSV/xlsx, sinkron waktu WIB, optimasi mobile,
`dist/` siap deploy.

**Belum dikerjakan / kandidat sesi berikutnya:**

1. **Lepas pelacakan `data/inventory.db` dari git** (saran README, belum dieksekusi) —
   butuh langkah hati-hati karena server produksi masih mengambil data contoh lewat `git pull`.
2. **Koreksi stempel waktu historis** yang masih UTC (pergeseran +7 jam) bila pemilik menghendaki.
3. **Ganti password akun demo & set `AUTH_SECRET` produksi** — sudah diimbau di README/PR, tapi
   harus dilakukan pemilik di server.
4. **Belum ada CI GitHub Actions**; semua tes dijalankan manual sebelum PR.
5. **Bundle `index-*.js` masih ± 942 kB** (peringatan Vite >500 kB); masih bisa dipecah lagi
   (mis. `xlsx` sudah terpisah, sisanya bisa di-split per halaman).
6. Utang kecil: `README.md` menyebut pada §1 "saran" melepas DB, dan deskripsi PR #3 menyebut
   akun `kantor` yang tidak ada — rapikan bila sedang menyentuh berkas terkait.

---

## 13. Cheat sheet perintah

```bash
# Dev (2 terminal)
PORT=3001 node server/index.js           # API  (dipakai juga oleh test)
npm run dev                              # Vite di :3000, proxy /api → :3001

# Uji
PORT=3001 node server/index.js &         # server untuk pengujian
npm test                                 # 73 tes API + 17 tes render
npm run test:api ; npm run test:render   # terpisah

# Produksi
npm run build && PORT=3000 npm start     # satu port untuk API + dist/

# Diagnostik & data
curl -s localhost:3000/api/health        # cek jam/zona waktu server
cp data/inventory.db data/inventory.backup-$(date +%Y%m%d-%H%M).db   # sebelum pull/uji
node -e "console.log(process.version)"   # pastikan Node ≥ 22 (node:sqlite)

# Git (pola sesi Arena)
git checkout arena/01a0ec98-barang-dan-aset
git push origin arena/01a0ec98-barang-dan-aset
gh pr create --fill --base main          # jangan merge sendiri
```

---

*Dokumen ini hidup: setiap keputusan baru yang disepakati bersama pemilik repo sebaiknya
ditambahkan di sini pada sesi yang sama, supaya sesi Arena berikutnya tidak perlu menebak.*
