# HANDOFF ARENA — SIM-ASET ISP

> **Serah terima proyek untuk sesi Arena berikutnya.**
> Berisi semua keputusan yang sudah diambil, kebiasaan kerja yang sudah mapan, jebakan yang
> pernah kena, dan hal-hal yang belum selesai — supaya sesi baru tidak mengulang debat yang
> sama atau merusak hal yang sudah disepakati.
>
> Terakhir diperbarui: **1 Oktober 2026** · basis commit: `f1e7e84` (merge PR #9)
> Repo: <https://github.com/thiends-88/barang-dan-aset> · Branch kerja sesi terakhir: `arena/01a0f6d1-barang-dan-aset`
> Sesi baru cukup diminta: *"Baca docs/HANDOFF-ARENA.md lalu lanjutkan dari §12."*

---

## 0. Cara memakai dokumen ini

1. Baca **§1–§4** dulu (konteks, aturan sesi, cara menjalankan, cara menguji) — cukup 5 menit.
2. Sebelum mengubah kode, cek **§5 (konvensi kode)** dan **§6 (keputusan domain)**.
   Banyak "aturan aneh" di aplikasi ini adalah keputusan sadar, bukan bug.
3. Sebelum menutup sesi, jalankan **§10 (checklist penutup sesi)**.
4. Kalau ada pertanyaan "kenapa dulu dibuat begini?", lihat **§11 (jebakan & pelajaran)**
   dan riwayat PR #1–#5 di GitHub — deskripsinya sangat rinci dan berbahasa Indonesia.

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
| Database | Satu file: `data/inventory.db` (SQLite, WAL) — **tidak dilacak git**, dibuat + diisi data contoh otomatis bila belum ada |
| Bahasa | **Seluruh UI, komentar, pesan error, test, dan PR memakai Bahasa Indonesia** |
| Deploy | Proxmox / LXC: `node server/index.js` menyajikan API **dan** `dist/` di satu port (`PORT`, default 3000) |

**Alur bisnis inti:** stok masuk ke gudang (pembelian/import) → dipasang ke Pelanggan / titik FO /
site Tower (stok berkurang, tercatat sebagai barang terpasang) → di-dismantle/dikembalikan
(stok bertambah lagi) — dan **setiap** perubahan stok wajib punya jejak di tabel `transactions`.

---

## 2. Aturan main sesi Arena

- **Satu sesi = satu branch** bernama `arena/<id-sesi>-barang-dan-aset`, dibuat dari `main`,
  lalu di-merge lewat Pull Request ke `main`. PR #1–#4 sudah di-merge dengan pola ini.
  Contoh branch yang sudah ada: `arena/01a0e613-...`, `arena/01a0e75a-...`, `arena/01a0eadc-...`.
- **Jangan pernah** force-push / commit langsung ke `main`. Semua perubahan lewat PR.
- Author PR adalah akun otomasi `app/arena-ai-coding-agent`; **yang me-merge adalah pemilik repo
  (thiends-88)** — jangan merge PR sendiri.
- Branch sesi **tidak boleh dipindah**: seluruh pekerjaan tetap di branch `arena/...` yang
  diberikan sesi itu (Arena melacak sesi lewat nama branch tersebut).
- **Push lebih awal & sering.** Workspace bisa dipulihkan dari snapshot yang hanya membawa isi
  repo; commit lokal yang belum di-push dan berkas di luar repo **bisa hilang** (pernah terjadi
  di sesi 4 — seluruh hasilnya harus dikerjakan ulang di PR #5).
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
    BonTeknisi.jsx (halaman Bon Teknisi: daftar, riwayat, laporan, detail)
    BonTeknisiForms.jsx (bon baru + scan, realisasi pemasangan, pengembalian)
    BonTeknisiPrint.jsx (surat jalan / rekap bon, pakai blok .print-doc)
    DataTeknisi.jsx (tab Data Teknisi + TeknisiFormModal, dipakai juga oleh form bon)
  utils/
    auth.js       → sesi localStorage, peta MENU_ACCESS, penambal window.fetch
    formatters.js → todayLocal(), formatRupiah(), formatNumber(), formatDate(), exportToCSV()
    notify.js     → pub/sub notifikasi in-app (pengganti alert())
    buildInfo.js  → CLIENT_BUILD (konstanta __APP_BUILD__ dari Vite), versionLabel(), isClientOutdated()
  components/VersionBadge.jsx → lencana versi di footer + tombol "Versi baru — muat ulang"

scripts/build-info.mjs → getBuildInfo()/getGitInfo(): dipakai vite.config.js (build) & server (runtime)
update-proxmox.sh      → skrip update server: cadangkan DB → reset --hard → pulihkan DB → install → restart
.github/workflows/ci.yml → workflow CI GitHub Actions (AKTIF — JANGAN diubah commit App Arena, lihat §11)
docs/ci.yml              → salinan rujukan workflow CI (tempat aman bila sesi Arena perlu mengusulkan edit CI)

api-test.mjs       → 78 tes integrasi API (integritas stok, auth, peran, waktu, scan tertaut, import massal, versi)
ssr-test.mjs       → 18 smoke test render + 11 tes regresi Navbar (Seksi 19), data asli API
contoh-import/     → barang.csv, pelanggan.csv (contoh file import)
data/inventory.db  → database (TIDAK dilacak git sejak PR #5 — lihat §7)
data/backups/      → cadangan otomatis dari update-proxmox.sh (diabaikan git)
dist/              → hasil build frontend + build-info.json (IKUT ter-commit — lihat §8)
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
npm run test:api                     # 149 tes integrasi API
npm run test:render                  # 46 tes render (18 smoke + 11 regresi Navbar + 1 Seksi 20 + 16 Seksi 21 Bon Teknisi)
```

> Hasil terakhir (sesi `arena/01a0edc1`, 29 Sep 2026): **API 78/78 lolos, SSR 29/29 lolos**
> (18 smoke test render + **11 tes regresi tampilan Navbar**, Seksi 19),
> `npm run build` sukses** (bundle awal 271,92 kB). Rangkaian yang sama jalan otomatis di CI.
>
> ⚠️ `api-test.mjs` **menulis ke database asli**; data contoh direset di awal (diverifikasi —
> gagal reset = test berhenti) dan di akhir. Bila test crash di tengah, pengaman
> `uncaughtException`/`unhandledRejection` tetap mencoba memulihkan data contoh sebelum keluar.
> Kalau DB sedang berisi data penting, **cadangkan dulu** (`cp data/inventory.db /tmp/…`)
> dan kembalikan setelah pengujian. **Jangan menjalankan tes di server yang sedang dipakai**
> (interaksi pemakai ikut mengubah stok dan bisa menggagalkan tes).
>
> Rangkaian yang sama **berjalan otomatis di CI GitHub Actions** (`.github/workflows/ci.yml`,
> aktif sejak commit `2463996`) pada setiap push/PR ke `main`.

### 4.4 Build frontend

```bash
npm run build        # keluaran ke dist/ (hash nama file berubah) + dist/build-info.json
```

`vite.config.js` memanggil `getBuildInfo()` (versi `package.json`, commit git, waktu build WIB)
satu kali per build, lalu (1) menanamnya ke bundle sebagai `__APP_BUILD__` dan (2) menulis
`dist/build-info.json`. Karena build dibuat **sebelum** commit, `commit` di build-info adalah
commit *induk* dari commit yang memuat build tsb. — ini wajar. Commit yang benar-benar berjalan
di server dilaporkan terpisah (`runtime.commit` di `/api/version`).

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
>
> Sejak sesi `arena/01a0edaf`, panel "AKUN CONTOH PER PERAN (klik untuk mengisi form)" di
> bawah kartu login **dihapus dari UI** agar aplikasi terlihat profesional — akun seed-nya
> tetap ada dan test tetap memakainya. Jangan kembalikan panel itu.

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
- Nomor transaksi: `TRX-IN-YYYYMM-NNNN` / `TRX-OUT-YYYYMM-NNNN` (`generateTrxNumber(type, tanggal)`).
  Prefix `YYYYMM` mengikuti `tanggal` transaksi (termasuk entri bertanggal mundur), dan kandidat
  nomor **wajib diperiksa keunikannya** terhadap `transactions.no_transaksi` (`UNIQUE`) dengan
  cadangan sekuensial 5+ digit bila ruang 4 digit padat (lihat §11).
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
- Library berat & halaman dimuat malas: semua tab selain Dashboard + `BarcodeLabelModal` lewat
  `React.lazy` + `Suspense` di `App.jsx` (fallback spinner konsisten "Memuat halaman..." /
  "Memuat pemindai barcode..."); `BarcodeScannerModal` sudah lazy sejak awal; `html5-qrcode`
  di `KeluarMasukBarang` di-`await import()` tepat sebelum kamera dinyalakan; `xlsx` juga
  `await import()` (di server untuk template, di klien untuk pratinjau import).

### 5.4 Hak akses (satu sumber kebenaran = server)
- Peta izin di `server/index.js` (`WRITE_RULES`) dan di UI (`MENU_ACCESS`, `canManageInventory`,
  `canManageDivisions` di `src/utils/auth.js`) harus **selalu selaras**; server tetap penentu akhir.
- Bon Teknisi: `POST /api/technician-loans/:id/install` boleh `admin/staff_gudang/teknisi`; semua `POST` lain di `/api/technician-loans` hanya `admin/staff_gudang` (aturan spesifik harus berada SEBELUM aturan umum di `WRITE_RULES`).
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
- DB **tidak dilacak git**. Clone baru / workspace yang kehilangan DB cukup menjalankan server:
  `initDb()` membuat skema, `seedData()` + `seedUsers()` mengisi data contoh & 4 akun demo.

### 6.9 Info versi (PR #5)
- `GET /api/version` **publik** (tanpa login, `Cache-Control: no-store`):
  `{ version, build: <isi dist/build-info.json | null>, runtime: { commit, commitShort, branch,
  commitDate, node, startedAt, uptimeSeconds } }`. `/api/health` ikut memuat `version`, `commit`,
  `buildCommit`.
- `VersionBadge` (footer) menampilkan `v<versi> · <commit build>`, panel detail saat diklik, dan
  tombol **"Versi baru — muat ulang"** bila `build.builtAt` di server ≠ yang tertanam di bundle
  browser (hanya di build produksi; di `npm run dev` selalu beda, jadi dimatikan).
- `index.html` & `build-info.json` disajikan `Cache-Control: no-cache`; `dist/assets/*` (ber-hash)
  `max-age=1 tahun, immutable`.

---

### 6.10 Bon / Barang Bawaan Teknisi (stok transit lapangan)
- **Alur 3 tahap** (semua di `server/index.js`, bagian *5B*): `POST /api/technician-loans` (BAWA) →
  `POST /:id/install` (PASANG) → `POST /:id/return` (KEMBALI); `POST /:id/cancel` membatalkan bon yang
  belum ada realisasi pemasangan. Semuanya `db.transaction`.
- **Stok**: hanya BAWA (`KELUAR`) dan KEMBALI/BATAL (`MASUK`) yang menyentuh `items.stok` dan **wajib** tercatat di
  `transactions` (`divisi = 'TEKNISI'`, `kategori_transaksi` = `Bon Teknisi (Dibawa)` / `Pengembalian Bon Teknisi` /
  `Pembatalan Bon Teknisi`, `ref_id` = id bon). PASANG **tidak** mengubah stok gudang & **tidak** menulis ke
  `transactions` (barang sudah keluar di tahap 1) — jejaknya ada di `technician_loan_movements`. Invarian
  `stok = snapshot + Σ(transactions)` tetap berlaku (diuji di Seksi 6F `api-test.mjs`).
- **"Stok dibawa teknisi"** bukan kolom: dihitung `jumlah_dibawa − jumlah_terpasang − jumlah_kembali` pada bon berstatus
  `AKTIF`/`SEBAGIAN` (muncul sebagai `stok_transit` di `GET /api/items`, `distribution.transit_teknisi` di scanner,
  `teknisi` di dashboard-summary — dan ikut `grand_total_valuation`). Barang yang masih dibawa teknisi **tidak bisa dihapus** dari master.
- **Status bon**: `AKTIF` (belum ada realisasi/pengembalian) → `SEBAGIAN` → `SELESAI` (sisa 0); `BATAL` permanen.
  Dihitung ulang oleh `refreshLoanStatus()`.
- **Realisasi** memakai `LINKED_DIVISI` (pelanggan/FO/tower), menggabung baris dengan kode+SN sama, menyinkronkan
  `total_harga`, menolak jumlah > sisa bon, SN dengan jumlah ≠ 1, dan SN yang sudah terpasang di mana pun.
  Kolom baru `dipasang_oleh` & `no_bon` pada `customer_items`/`fo_items`/`tower_items`; `reconcileInstalledItems()`
  (edit pelanggan/FO/tower) mempertahankannya dengan mencocokkan kode+SN.
- **Teknisi & divisi (Data Teknisi)**: tabel `technicians` (`nama` unik tak peka huruf, `divisi` ∈ PELANGGAN/DIVISI FO/DIVISI TOWER,
  `no_hp`, `status` aktif|nonaktif), CRUD di `/api/teknisi` (GET semua peran; tulis hanya admin/staff_gudang — aturan ada di
  `WRITE_RULES`). Bon baru **wajib `divisi`** dan memakai `teknisi_ref_id` (nama & divisi bon diambil dari Data Teknisi; divisi
  boleh dikosongkan bila ada `teknisi_ref_id` → mengikuti divisi teknisi). API masih menerima `teknisi_nama` bebas (+ `divisi`)
  demi kompatibilitas, tetapi UI hanya memakai dropdown. Teknisi nonaktif ditolak untuk bon baru. Ganti nama teknisi
  memperbarui `technician_loans`, `technician_loan_movements`, dan `dipasang_oleh` secara berantai; hapus ditolak bila sudah
  tercatat (pakai nonaktif). Dropdown UI: pilih Divisi → daftar teknisi aktif divisi itu (reset saat divisi diganti);
  pemasang di Realisasi dikelompokkan per divisi (pembawa bon selalu ada, juga untuk bon lama). `GET /api/technician-loans/technicians`
  (akun peran teknisi + nama pernah tercatat) tetap ada untuk filter nama. Filter `divisi` ada di daftar & laporan; laporan
  punya `per_divisi_bon`. `reset-seed` TIDAK menghapus Data Teknisi (seperti tabel `users`). Seed tidak berisi nama teknisi.
  Teknisi pemasang boleh berbeda dari pembawa. Tidak ada pembatasan "hanya bon milik sendiri".
- **No. Bon**: kosong → `BON-YYYYMM-NNNN` berurutan per bulan (unik); bisa diisi manual (huruf besar, unik, maks 40).
- **Cetak**: dokumen dirender dua kali — di modal (layar) dan di `<div class="print-doc">` (hanya tampil saat cetak,
  bisa pecah halaman). Jangan mencetak modal `fixed` langsung. Laporan memakai `print-only` + `print-page-laporan`.
- **Navbar kini 9 menu** (`Bon` = `bonteknisi`): padding tombol di bawah `xl` dikurangi (`px-1.5`) agar muat di 1100px.
  ⚠️ Belum diukur di Chromium sungguhan (sandbox tanpa browser) — **ukur ulang di lebar 1100/1170/1280** sebelum menambah menu ke-10.
- Reset data contoh (`/api/reset-seed`) ikut menghapus bon + riwayatnya; seed demo TIDAK membuat bon.

---

## 7. Database & data

- Tabel: `categories`, `items`, `customers`, `customer_items`, `fo_sites`, `fo_items`,
  `tower_sites`, `tower_items`, `transactions`, `users`, dan (Bon Teknisi) `technician_loans`,
  `technician_loan_items`, `technician_loan_movements` (jenis `BAWA|PASANG|KEMBALI|BATAL`), serta `technicians` (Data Teknisi;
  `technician_loans` punya kolom `divisi` & `teknisi_ref_id`).
- Skema dibuat dengan `CREATE TABLE IF NOT EXISTS`; penambahan kolom baru memakai daftar
  `migrations` (`ALTER TABLE ... ADD COLUMN`, dibungkus try/catch) di `server/db.js`.
  **Cara menambah kolom baru = tambahkan entri di array itu**, jangan menulis migrasi lain.
- 11 indeks dibuat `IF NOT EXISTS` untuk kolom yang sering difilter (tanggal/jenis/divisi/kode
  barang/kunci relasi) — tambahkan indeks bila muncul query lambat baru.
- Kolom uang disimpan sebagai `REAL`, tanggal `YYYY-MM-DD` teks, waktu `HH:MM:SS` teks
  (kompatibel `datetime('now','localtime')`).
- **`data/inventory.db` TIDAK dilacak git (sejak PR #5).** `.gitignore` memuat `data/*.db`,
  berkas WAL/SHM/journal, dan `data/backups/`. Alasannya: dulu `git pull` di server **menimpa**
  database produksi dengan data contoh.
- Server membuat & mengisi DB contoh otomatis bila berkas belum ada (lihat §6.8), jadi clone
  baru tetap langsung bisa dipakai.
- **Update server wajib lewat `./update-proxmox.sh`** (dry-run dulu). Pada update PERTAMA setelah
  PR #5, `git reset --hard` akan *menghapus* `data/inventory.db` (karena berkas itu keluar dari
  index); skrip mencadangkannya dulu (`VACUUM INTO`, lolos `integrity_check`) lalu memulihkannya
  otomatis, dan membandingkan jumlah baris sebelum/sesudah. Jangan pernah melewati langkah cadangan.

---

## 8. Deployment (Proxmox)

- Prasyarat: **Node.js 22+** (modul `node:sqlite` masih eksperimental — warning di log itu normal).
- `dist/` ikut repository → di server cukup `npm install --omit=dev` lalu `npm start`.
- **Update = `./update-proxmox.sh --dry-run` lalu `sudo ./update-proxmox.sh`.** Urutan skrip:
  cek prasyarat → fetch & tampilkan commit masuk → stop layanan → cadangkan DB (+ patch perubahan
  lokal) → `reset --hard` → pulihkan DB bila hilang/tertimpa → `npm install --omit=dev` → start →
  cek `/api/version` (commit berjalan = target) → pangkas cadangan (default simpan 20).
  Bila gagal di tengah, skrip mencetak perintah rollback lengkap. Opsi: `--dir`, `--branch`,
  `--service`, `--port`, `--keep`, `--no-restart`, `--force`, `--yes`.
- Server yang **belum** punya skrip (masih di versi sebelum PR #5) menjalankannya dari `/tmp`:
  `git fetch origin main && git show origin/main:update-proxmox.sh > /tmp/update-proxmox.sh &&
  bash /tmp/update-proxmox.sh --dir /opt/barang-dan-aset --dry-run`.
- Skrip menjalankan dirinya dari salinan sementara (aman walau `reset --hard` mengganti berkasnya)
  dan mengingatkan bila `AUTH_SECRET` belum di-set di unit systemd.
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
- Sertakan **angka hasil tes** (`78/78`, `18/18`) dan, bila relevan, **angka sebelum/sesudah**
  (mis. ukuran bundle 906 kB → 517 kB).
- `dist/` hasil build ikut di-commit di PR yang sama dengan perubahan frontend.
- Yang **tidak** boleh masuk repo: `node_modules/`, berkas `*.db-wal` / `*.db-shm` / `*.db-journal`
  (sudah ada di `.gitignore`), sampah eksperimen, dan **`data/*.db` / `data/backups/`**
  (tidak dilacak sejak PR #5 — jangan `git add -f`).

---

## 10. Checklist penutup sesi

1. `npm install` (bila `package.json` berubah) —
   dependensi baru wajib tercermin di `package-lock.json`.
2. Jalankan server di 3001, lalu:
   - `npm run test:api` → harapan **149/149 lolos**
   - `npm run test:render` → harapan **46/46 lolos**
   - bila menambah fitur, **tambahkan seksi tesnya** di `api-test.mjs` / `ssr-test.mjs`
     mengikuti gaya yang ada (fungsi `ok()` / `bad()`, judul seksi `=== N. ... ===`).
3. `npm run build` bila menyentuh frontend; pastikan `dist/` ter-commit.
4. `data/inventory.db` tidak dilacak git, jadi pengujian tidak mengotori diff. Bila DB rusak/
   hilang, cukup hapus lalu jalankan ulang server (seed otomatis).
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
| `git pull` di server menimpa `data/inventory.db` | Data produksi hilang tertimpa data contoh | DB tidak dilacak lagi (PR #5); update hanya lewat `update-proxmox.sh` (§8) |
| Workspace Arena kehilangan metadata git / commit lokal antar-snapshot (sesi 4) | Commit lokal & berkas di luar repo (`/home/user/*.patch`) lenyap | **Push ke branch sesi sesering mungkin**; jangan menyimpan cadangan di luar repo |
| Salinan DB mentah saat server jalan (mode WAL) | Data terbaru hanya ada di `-wal`, salinan `.db` saja tidak lengkap | Cadangan pakai `VACUUM INTO` (lihat `update-proxmox.sh`) |
| Skrip bash diganti `git reset --hard` saat sedang berjalan | Bash membaca sisa skrip versi baru → perilaku acak | `update-proxmox.sh` re-exec dari salinan di `/tmp` |
| Build menghasilkan hash nama berkas berbeda | Diff `dist/` terlihat besar padahal ukuran sama | Wajar (beda toolchain); commit hasil build terbaru, jangan panik |
| Body JSON default Express | Import massal ditolak 413 | Limit dinaikkan ke 5 MB + batas 5000 baris |
| Run uji mati di tengah / reset awal gagal diam-diam | Run berikutnya bisa mewarisi DB kotor | Reset awal diverifikasi; pengaman crash memulihkan data contoh; jangan uji di server yang sedang dipakai |
| `generateTrxNumber` acak 4 digit (`1000–9999`) tanpa cek `UNIQUE` | Paradoks ulang tahun: ~1% run `api-test.mjs` gagal di "Tower: hapus mengembalikan stok" (stok 15 vs 20 + 4 gagal lanjutan) karena `DELETE /api/tower/:id` kena `UNIQUE constraint failed: transactions.no_transaksi` dan ter-rollback; import ≥200 barang gagal ~89% | `generateTrxNumber(type, tanggal)` wajib cek `SELECT 1 FROM transactions WHERE no_transaksi = ?` + fallback sekuensial 5+ digit bila padat; `YYYYMM` mengikuti `tanggal` transaksi |
| Varian arbitrer Tailwind v4 (`min-[1100px]:` dsb) kalah urutan dari `sm:`/`md:`/`2xl:` | Aturan `min-[1100px]:hidden sm:inline` diam-diam TIDAK menyembunyikan apa pun — `sm:` ditulis SETELAH-nya di CSS dan menang (spesifisitas sama), sehingga label tombol tetap tampil, baris menu terjepit jadi scroller, dan item menu tertimpa tombol sebelah | Untuk breakpoint kustom pakai **varian bernama**: `--breakpoint-nav: 1100px` di `@theme` `src/index.css` → `nav:` / `max-nav:` (terurut bersama sm/md/lg/2xl). **Jangan** mencampur varian arbitrer dengan breakpoint standar pada satu className; maksimal SATU pasangan tampil/sembunyi per elemen. Ditegakkan Seksi 19 `ssr-test.mjs` |
| App Arena tanpa izin `workflows` | `git push` ditolak saat commit memuat `.github/workflows/*.yml`; `gh api` contents → 403 | `.github/workflows/ci.yml` sudah aktif (commit `2463996`) — **jangan pernah menyentuh berkas di `.github/workflows/`** dari commit Arena; gunakan `docs/ci.yml` bila ingin mengusulkan perubahan workflow |

---

## 12. Status terkini & yang belum selesai

**Sudah selesai (semua lolos tes):** master barang + kategori dinamis, Pelanggan/FO/Tower dengan
multi-item & SN, dismantle, integritas stok transaksional, scanner kamera/USB + label barcode,
mutasi + transaksi tertaut divisi, laporan (mutasi/sebaran/valuasi) + cetak A4 landscape,
login & manajemen user berperan, import massal CSV/xlsx, sinkron waktu WIB, optimasi mobile,
`dist/` siap deploy.

**Selesai di PR #5:** DB dilepas dari git (seed otomatis), skrip `update-proxmox.sh` (teruji
di simulasi server: update pertama yang menghapus DB dari index, update biasa, tanpa commit baru,
gagal di tengah + petunjuk rollback, pemangkasan cadangan), cron cadangan harian `VACUUM INTO`
di README, info versi build (`/api/version`,
`dist/build-info.json`, `VersionBadge`), header cache `index.html`.

**Selesai di PR #6 + commit `2463996`:**
- **CI GitHub Actions aktif** di `.github/workflows/ci.yml` (dipindahkan pemilik pada commit
  `2463996`, salinan rujukan tetap di `docs/ci.yml`): checkout → Node 22 → `npm ci` → server uji
  port 3001 → `npm test` → `npm run build` pada setiap push/PR ke `main`.
- **Bundle dipecah per halaman** (`React.lazy` + `Suspense` + dynamic import `html5-qrcode`/`xlsx`):
  `index-*.js` turun **947 kB → 273 kB** (gzip ~84 kB), tanpa chunk > 500 kB.
- **Pengerasan `api-test.mjs`**: verifikasi reset data contoh di awal + pengaman crash
  `uncaughtException`/`unhandledRejection`.

**Selesai di sesi ini (branch `arena/01a0ed85-barang-dan-aset`):**
- **Akar masalah flake "Tower: hapus mengembalikan stok (stok 15 vs 20)" ditemukan & dituntaskan:**
  bukan warisan DB kotor, melainkan **bentrok nomor transaksi acak 4 digit** (`1000–9999`) di
  `generateTrxNumber` terhadap kolom `transactions.no_transaksi TEXT UNIQUE NOT NULL`. Akibat
  paradoks ulang tahun, ~1% run `api-test.mjs` mengalami bentrok acak saat `DELETE /api/tower/:id`
  mencatat mutasi kembali → `db.transaction` me-rollback penghapusan tower → stok tertinggal 15
  dari 20 dan memicu tepat 4 kegagalan lanjutan di Seksi 6 (sementara invarian Seksi 7 tetap
  lolos karena stok & transaksi sama-sama ter-rollback). Masalah yang sama juga membuat import
  massal ≥200 barang berstok awal > 0 gagal ~89% dengan `UNIQUE constraint failed`.
  - `generateTrxNumber(type, tanggal)` kini memeriksa keunikan terhadap `transactions.no_transaksi`
    dan memiliki cadangan sekuensial 5+ digit bila ruang 4 digit pada bulan tersebut padat.
  - Prefix `YYYYMM` pada `no_transaksi` kini mengikuti `tanggal` transaksi (termasuk entri
    bertanggal mundur di Pelanggan/FO/Tower/Mutasi), bukan bulan jam server saat ini.
  - `POST /api/items`, `POST /api/items/:id/stock-adjust`, dan `POST /api/reset-seed` kini ikut
    dibungkus `db.transaction(...)` agar seluruh perubahan stok & reset bersifat atomik.
- **Seksi tes baru `6D` di `api-test.mjs` (+3 tes → total 78/78 lolos):**
  1. Import massal 200 barang baru dengan stok awal > 0 sekaligus → 200 transaksi `MASUK` dengan
     `no_transaksi` 100% unik tanpa gagal `UNIQUE constraint`.
  2. Transaksi bertanggal mundur (`2026-01-15`) → prefix `no_transaksi` selaras `TRX-IN-202601-...`.
  3. Invarian stok vs log transaksi pasca-6C & 6D tetap terjaga penuh.
- **Dokumentasi CI diselaraskan** di `README.md`, `docs/ci.yml`, dan dokumen ini (mencerminkan
  `.github/workflows/ci.yml` yang sudah aktif sejak commit `2463996`).

**Selesai di sesi `arena/01a0eda3` (perbaikan menu atas menutupi halaman):**
- Penyebab (dari tangkapan layar pemilik, lebar ±1170px): 8 label menu dua kata membungkus jadi 2 baris,
  ditambah brand/subtitle/tombol ber-label, sehingga header sticky membengkak & menutupi konten; di layar kecil
  header sticky memuat 2 baris (≈106px).
- Solusi di `Navbar.jsx`: header sticky **selalu satu baris** (h-14/sm:h-16). Lebar ≥ **1100px**
  (`min-[1100px]:`): brand + menu + alat dalam satu baris; menu memakai label ringkas (`short`, mis. "Barang",
  "Pelanggan", "FO", "Tower", "User"; nama lengkap di tooltip), subtitle/badge/label tombol/nama user baru
  tampil di `2xl`. Lebar < 1100px: menu pindah ke baris geser terpisah di bawah bar atas yang **tidak sticky**
  (ikut tergulung). Menambah menu baru → isi `label` **dan** `short`.
  ⚠️ **Koreksi (29 Sep 2026, sesi `arena/01a0edc1`): perbaikan ini ternyata TIDAK BERJALAN.**
  `min-[1100px]:` tidak pernah menyalakan/mematikan apa pun — lihat jebakan di §11. Pendekatan
  `min-[1100px]:hidden sm:inline` sudah dibuang total; pakai varian bernama `nav:`.

**Selesai di sesi `arena/01a0edaf` (tampilan halaman login):**
- Panel **"AKUN CONTOH PER PERAN (klik untuk mengisi form)"** (berisi 4 akun demo + tombol
  pengisi otomatis) dihapus dari bawah kartu login di `src/components/LoginPage.jsx` supaya
  halaman login terlihat profesional — kredensial demo tidak lagi terekspos di UI produksi.
  Akun seed (`server/seed.js`) dan test tetap memakai akun yang sama; `dist/` di-build ulang.
  Hasil: API 78/78 lolos, SSR 18/18 lolos, `npm run build` sukses.

**Selesai di sesi `arena/01a0edc1` (menu utama tertimpa di browser laptop):**
- **Keluhan pemilik**: "menu utama ada yang tertimpa … ketutup sebagian oleh menu lain" di browser laptop.
  Ter reproduced persis: pada lebar **1100–1535px** (termasuk 1170px yang dilaporkan, juga 1280/1366/1440)
  dari 8 menu hanya terlihat 4 ("Pelanggan, FO, Tower, Keluar/Mas…"), sisanya tergeser keluar kotak dan
  **tertimpa tombol "Pindai Barcode"**; `Dashboard` dan `Barang` hilang sama sekali.
- **Akar masalah (bukan sekadar "label kepanjangan")**: kelas `min-[1100px]:hidden sm:inline` dsb. di
  `Navbar.jsx` **tidak pernah menghasilkan efek**. Tailwind v4.3 menaruh blok `@media (width>=1100px)`
  (varian arbitrer) di posisi **61011**, sedangkan `@media (width>=40rem)` (varian `sm:`) di **61107** —
  *setelahnya*. Spesifisitas sama-sama satu kelas, jadi aturan yang ditulis belakangan menang:
  `sm:inline` menimpa `min-[1100px]:hidden`. Akibatnya "sembunyikan label di 1100–1535px" tidak berlaku,
  blok alat membengkak jadi **541px** (bukan ±150px), menu tinggal dapat **392px** dari **602px** yang
  dibutuhkan → `overflow-x-auto` + `justify-center` memotongnya. Verifikasi: `dist/assets/*.css`.
- **Perbaikan**: (1) `--breakpoint-nav: 1100px` di `@theme` `src/index.css` → varian bernama `nav:` /
  `max-nav:` yang urutannya dijamin benar bersama sm/md/lg/2xl; (2) `Navbar.jsx` tidak lagi memakai
  satu pun varian arbitrer untuk tampil/sembunyi — brand cukup logo + "SIM-ASET" (badge & subtitle
  pindah ke hero Dashboard, isinya sudah ada di sana), tombol alat jadi **ikon saja** (label penuh di
  `title`/`aria-label`), nama & peran user baru tampil di `2xl`. Menu utama kini selalu dapat ruangnya:
  di 1100px tersedia 724px untuk kebutuhan 724px (8 menu utuh, tanpa geser).
- **Pengaman tambahan**: `justify-center-safe` (kelas sendiri di `index.css`) sebagai pengaman bila menu
  ke-9 someday ditambahkan, plus peringatan `console.warn` bila `nav.scrollWidth > nav.clientWidth`;
  brand jadi `<button>` dengan `aria-label` (sebelumnya `<div onClick>`).
- **Bonus ketemu saat pengujian**: pada lebar 760–1099px tombol Keluar terdorong **12px keluar viewport**
  (brand + alat sama-sama `shrink-0`) — ikut beres dengan brand/alat yang diringkas.
- **Verifikasi**: 16 lebar (1920→390, termasuk batas 1100/1099) diukur di Chromium sungguhan — **16/16
  lolos**, di dev **dan** di build produksi `dist/`; tidak ada item terpotong, tidak ada tumpang tindih,
  tidak ada overflow horizontal, tinggi header tetap 64px. Screenshot di `shots/`.
- **Tes regresi baru — Seksi 19 di `ssr-test.mjs` (+11 → total 29/29)**: `--breakpoint-nav` terdaftar;
  tidak ada className yang mencampur varian arbitrer dengan `sm:/md:/2xl:`; **tepat satu** `nav:flex` +
  **tepat satu** `nav:hidden` (menangkap bug dua baris menu); 8 menu punya `label`+`short` dengan
  `short` ≤ 10 karakter; kelas `.justify-center-safe`/`.scrollbar-none` terdefinisi di `index.css`;
  jumlah menu per peran (admin 8, staff_gudang 7, teknisi 6, viewer 6) dan label `short`/`label` muncul
  di baris yang benar. Ketiga mutasi bug (kembali ke `max-nav:hidden`, pakai `min-[…]`+`sm:`, dan
  `short` kepanjangan) sudah diuji **benar-benar membuat test gagal**.
- Hasil: **API 78/78 lolos, SSR 29/29 lolos, `npm run build` sukses** (bundle 273 kB → 271,92 kB).

**Selesai di sesi `arena/01a0f6d1` (pilihan stok gudang keseluruhan tersedia & barang stok menipis di Laporan Gudang Logistik):**
- Di menu **Laporan → Laporan Barang Masuk & Keluar → Gudang Logistik**, ditambahkan pilihan:
  1. **Stok Gudang Keseluruhan yang Tersedia** (`STOK_TERSEDIA`): menampilkan seluruh barang di Gudang Logistik yang memiliki stok tersedia (`stok > 0`), lengkap dengan KPI ringkasan gudang, filter pencarian & kategori, status stok, jumlah terpasang di divisi, harga satuan, total nilai stok, Export CSV, dan Cetak / Print PDF (lengkap kop & tanda tangan).
  2. **Barang Stok Menipis** (`STOK_MENIPIS`): menampilkan barang di Gudang Logistik dengan `stok <= min_stok` (diurutkan dari stok paling kritis), lengkap dengan status `STOK MENIPIS` / `STOK HABIS`, batas minimum, pencarian/filter kategori, Export CSV, dan Cetak / Print PDF.
- Pilihan ini dapat diakses baik dari dropdown Divisi (`Gudang Logistik — Stok Gudang Keseluruhan yang Tersedia` / `Gudang Logistik — Barang Stok Menipis`), dropdown Jenis Laporan di sebelahnya, maupun bilah tombol cepat **Pilihan Gudang Logistik** yang tampil saat `Gudang Logistik` dipilih.
- Endpoint baru `GET /api/reports/warehouse-stock` (`filter=tersedia|menipis|semua`, `kategori`, `search`) + dukungan `divisi=STOK_MENIPIS` pada `GET /api/reports/installed-assets`.
- Seksi tes baru `6E` di `api-test.mjs` (+3 → **81/81 lolos**) dan Seksi `20` di `ssr-test.mjs` (+1 → **30/30 lolos**), `dist/` di-build ulang.

**Selesai di sesi `arena/01a0fa7c` (Bon / Barang Bawaan Teknisi — stok transit lapangan):**
- Fitur 3 tahap: (1) bon + scan barcode, stok gudang → stok dibawa teknisi; (2) realisasi ke Pelanggan / Divisi FO /
  Divisi Tower lengkap SN, lokasi tujuan & teknisi pemasang; (3) pengembalian sisa ke gudang. Detail keputusan: **§6.10**.
- Menu baru **Bon Teknisi** (daftar bon, riwayat mutasi, laporan + CSV + cetak), surat jalan / rekap bon A4, kolom
  `+N dibawa teknisi` di Master Barang, kartu *Dibawa Teknisi* di Dashboard, filter divisi `TEKNISI` di menu Mutasi.
- **Data Teknisi + Divisi pada bon** (permintaan lanjutan): tab *Data Teknisi*, pilih Divisi → nama teknisi di Bon Baru & Realisasi,
  tambah teknisi cepat dari form bon, filter/rekap per divisi (§6.10).
- Tes: **Seksi 6F+6G** `api-test.mjs` (**149/149**) dan **Seksi 21** `ssr-test.mjs` (**46/46**); alur UI juga
  diuji manual di jsdom (scan, bon, realisasi, pengembalian, riwayat, laporan, cetak) — skrip tidak disimpan karena jsdom bukan dependensi.
- Belum terverifikasi visual di browser sungguhan (sandbox tanpa Chromium): tampilan responsif modal, hasil cetak
  A4, dan lebar Navbar 9 menu perlu dicek pemilik.

**Belum dikerjakan / kandidat sesi berikutnya:**

0. Bon Teknisi: opsi **tambah barang ke bon yang sudah berjalan**, pembatasan teknisi hanya melihat/merealisasi bon sendiri,
   dan kondisi barang saat dikembalikan (baik/rusak) — sengaja ditunda, belum diminta.

1. **Tindakan pemilik di server Proxmox (bukan kode):**
   - Update pertama setelah PR #5 wajib `./update-proxmox.sh --dry-run` dulu (lihat §8).
   - **Ganti password akun demo** (menu *Manajemen User*) dan set **`AUTH_SECRET`** (+ `APP_TZ`
     bila bukan WIB) di unit systemd.
2. **Koreksi stempel waktu historis** yang masih UTC (pergeseran +7 jam untuk data sebelum PR #3)
   bila sewaktu-waktu dikehendaki pemilik pada database produksi.

---

## 13. Cheat sheet perintah

```bash
# Dev (2 terminal)
PORT=3001 node server/index.js           # API  (dipakai juga oleh test)
npm run dev                              # Vite di :3000, proxy /api → :3001

# Uji
PORT=3001 node server/index.js &         # server untuk pengujian
npm test                                 # 149 tes API + 46 tes render
npm run test:api ; npm run test:render   # terpisah

# Produksi
npm run build && PORT=3000 npm start     # satu port untuk API + dist/

# Diagnostik & data
curl -s localhost:3000/api/health        # cek jam/zona waktu server
curl -s localhost:3000/api/version       # versi, commit berjalan, waktu build
./update-proxmox.sh --dry-run            # rencana update server (tidak mengubah apa pun)
sudo ./update-proxmox.sh                 # update server + cadangan DB otomatis
node -e "console.log(process.version)"   # pastikan Node ≥ 22 (node:sqlite)

# Git (pola sesi Arena)
git push origin <branch-sesi>            # branch arena/... yang diberikan sesi — push sesering mungkin
gh pr create --fill --base main          # jangan merge sendiri
```

---

*Dokumen ini hidup: setiap keputusan baru yang disepakati bersama pemilik repo sebaiknya
ditambahkan di sini pada sesi yang sama, supaya sesi Arena berikutnya tidak perlu menebak.*
