/**
 * Test integrasi API — memverifikasi integritas stok & transaksi.
 *
 * Menjalankan serangkaian operasi nyata ke API, lalu memeriksa:
 *  - stok gudang tidak pernah minus
 *  - jumlah tidak boleh negatif / kode barang harus terdaftar
 *  - setiap perubahan stok selalu tercatat di tabel transactions
 *  - menghapus data pelanggan/FO/Tower mengembalikan stok
 *
 * Jalankan: node api-test.mjs   (server API harus hidup di port 3001)
 * Data akan direset ke data contoh di akhir pengujian.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const API = 'http://127.0.0.1:3001';
const DB_PATH = path.join(process.cwd(), 'data', 'inventory.db');

let pass = 0, fail = 0;
const failures = [];

function ok(name, detail = '') {
  pass++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function bad(name, detail = '') {
  fail++;
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

let TOKEN = '';

async function req(method, url, body, { noAuth = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (TOKEN && !noAuth) headers['Authorization'] = `Bearer ${TOKEN}`;
  const res = await fetch(API + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* biarkan null */ }
  return { status: res.status, json };
}

const db = new DatabaseSync(DB_PATH);

const stockOf = (kode) => db.prepare('SELECT stok FROM items WHERE kode_barang = ?').get(kode)?.stok;
const allStocks = () => Object.fromEntries(db.prepare('SELECT kode_barang, stok FROM items').all().map(r => [r.kode_barang, r.stok]));
const maxTrxId = () => db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM transactions').get().m;
const trxSince = (id) => db.prepare('SELECT * FROM transactions WHERE id > ? ORDER BY id').all(id);

/** Bandingkan stok sekarang dengan snapshot + semua mutasi yang tercatat setelah snapshot. */
function checkInvariant(label, snapshot, sinceId) {
  const now = allStocks();
  const delta = {};
  for (const t of trxSince(sinceId)) {
    const sign = t.jenis === 'MASUK' ? 1 : -1;
    delta[t.kode_barang] = (delta[t.kode_barang] || 0) + sign * Number(t.jumlah);
  }
  const mismatch = [];
  for (const kode of Object.keys(now)) {
    const expected = (snapshot[kode] ?? 0) + (delta[kode] || 0);
    if (now[kode] !== expected) mismatch.push(`${kode}: stok=${now[kode]} seharusnya=${expected}`);
  }
  if (mismatch.length === 0) ok(`Invariant stok vs log transaksi (${label})`);
  else bad(`Invariant stok vs log transaksi (${label})`, mismatch.join('; '));
}

function checkNoNegativeStock(label) {
  const negatif = db.prepare('SELECT kode_barang, stok FROM items WHERE stok < 0').all();
  if (negatif.length === 0) ok(`Tidak ada stok minus (${label})`);
  else bad(`Tidak ada stok minus (${label})`, negatif.map(r => `${r.kode_barang}=${r.stok}`).join(', '));
}

// Pengaman kebersihan DB: bila test mati mendadak di tengah jalan (error yang tak
// tertangkap), coba pulihkan data contoh dulu sebelum keluar supaya run berikutnya
// tidak mewarisi database kotor. Best-effort saja — TOKEN bisa saja belum ada
// (reset akan dijawab 401, cukup diabaikan).
async function keluarSetelahCrash(jenis, err) {
  console.error(`\nTest crash (${jenis}):`, err);
  try { await req('POST', '/api/reset-seed'); } catch { /* abaikan */ }
  try { db.close(); } catch { /* abaikan */ }
  process.exit(1);
}
process.on('uncaughtException', (err) => { void keluarSetelahCrash('uncaughtException', err); });
process.on('unhandledRejection', (err) => { void keluarSetelahCrash('unhandledRejection', err); });

// ============================================================
console.log('\n=== PERSIAPAN & OTENTIKASI ===');

// Endpoint wajib menolak akses tanpa token
{
  const r = await req('GET', '/api/items', undefined, { noAuth: true });
  if (r.status === 401) ok('API menolak request tanpa login (401)');
  else bad('API menolak request tanpa login (401)', `status=${r.status}`);
}

// Login sebagai admin bawaan
{
  const r = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' }, { noAuth: true });
  if (r.status === 200 && r.json?.success && r.json.data?.token) {
    TOKEN = r.json.data.token;
    ok('Login admin berhasil & token diterima');
  } else {
    bad('Login admin berhasil & token diterima', `status=${r.status} ${JSON.stringify(r.json)}`);
    console.log('\nTidak bisa lanjut tanpa token — hentikan test.');
    process.exit(1);
  }
}

// Password salah harus ditolak
{
  const r = await req('POST', '/api/auth/login', { username: 'admin', password: 'salah-banjir' }, { noAuth: true });
  if (r.status === 401) ok('Login dengan password salah ditolak (401)');
  else bad('Login dengan password salah ditolak (401)', `status=${r.status}`);
}

// Token diterima lewat saluran cadangan (tahan proxy yang menghapus Authorization)
{
  const r1 = await fetch(API + '/api/items', { headers: { 'X-Session-Token': TOKEN } });
  if (r1.status === 200) ok('Token via header X-Session-Token diterima');
  else bad('Token via header X-Session-Token diterima', `status=${r1.status}`);

  const r2 = await fetch(API + `/api/items?_token=${encodeURIComponent(TOKEN)}`);
  if (r2.status === 200) ok('Token via query parameter diterima');
  else bad('Token via query parameter diterima', `status=${r2.status}`);
}

// Server harus berjalan di zona waktu aplikasi (default Asia/Jakarta, UTC+7)
{
  const r = await fetch(API + '/api/health');
  const j = await r.json().catch(() => null);
  const tz = j?.data?.timezone;
  const off = j?.data?.offsetMinutes;
  if (r.status === 200 && off === 420) ok(`Zona waktu server sinkron WIB (${tz}, UTC+${off / 60})`);
  else bad('Zona waktu server sinkron WIB', `timezone=${tz} offset=${off}`);
}

// Info versi: publik (dipakai update-proxmox.sh & VersionBadge) dan konsisten dengan /api/health
{
  const pkgVersion = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
  const r = await fetch(API + '/api/version'); // sengaja TANPA token
  const j = await r.json().catch(() => null);
  const d = j?.data;
  const buildOk = d?.build === null || (typeof d?.build?.builtAt === 'string' && d.build.version === pkgVersion);
  if (r.status === 200 && d?.version === pkgVersion && d?.runtime?.node === process.version && buildOk
      && 'commit' in (d?.runtime || {}) && /no-store/.test(r.headers.get('cache-control') || '')) {
    ok('GET /api/version publik & lengkap', `v${d.version}, commit=${d.runtime.commitShort ?? '-'}, build=${d.build?.builtAtLocal ?? 'belum ada'}`);
  } else {
    bad('GET /api/version publik & lengkap', `status=${r.status} body=${JSON.stringify(j)?.slice(0, 200)}`);
  }

  const h = await (await fetch(API + '/api/health')).json().catch(() => null);
  if (h?.data?.version === d?.version && h?.data?.commit === (d?.runtime?.commitShort ?? null)
      && h?.data?.buildCommit === (d?.build?.commitShort ?? null)) {
    ok('/api/health memuat versi & commit yang sama dengan /api/version');
  } else {
    bad('/api/health memuat versi & commit', JSON.stringify(h?.data));
  }
}

// Reset ke data contoh SEBELUM mulai dan VERIFIKASI berhasil: seluruh pengujian di
// bawah mengasumsikan kondisi awal yang pasti (stok seed tertentu). Dulu reset ini
// tidak diperiksa — kalau gagal, kegagalannya baru tampak jauh di bawah sebagai
// "flake" yang menyulitkan diagnosis.
{
  const rr = await req('POST', '/api/reset-seed');
  if (!(rr.status === 200 && rr.json?.success)) {
    console.error(`Gagal me-reset data contoh di awal pengujian (HTTP ${rr.status}: ${rr.json?.error || '-'}) — hentikan test.`);
    process.exit(1);
  }
}
const KODE = 'BRG-SW-GIGABIT-8P';           // stok awal 20 unit
const STOK_AWAL = stockOf(KODE);
const GLOBAL_SNAP = allStocks();            // snapshot seluruh barang sebelum pengujian
const GLOBAL_MARK = maxTrxId();
console.log(`  Barang uji: ${KODE} (stok ${STOK_AWAL})`);

// ============================================================
console.log('\n=== 0B. KETAHANAN API: error selalu JSON, rute /api tak dikenal 404 ===');
{
  // Sebelumnya body JSON rusak / terlalu besar dijawab halaman HTML Express berisi stack trace,
  // dan rute /api yang tidak ada jatuh ke fallback SPA (200 + index.html).
  const kirimMentah = (url, body, ct = 'application/json') => fetch(API + url, { method: 'POST', headers: { 'Content-Type': ct, Authorization: `Bearer ${TOKEN}` }, body });
  const rusak = await kirimMentah('/api/items', '{"kode_barang": ');
  const rusakJson = await rusak.json().catch(() => null);
  const besar = await kirimMentah('/api/items', JSON.stringify({ x: 'a'.repeat(6 * 1024 * 1024) }));
  const besarJson = await besar.json().catch(() => null);
  if (rusak.status === 400 && rusakJson?.success === false && /JSON/.test(rusakJson.error) && besar.status === 413 && besarJson?.success === false && /terlalu besar/i.test(besarJson.error)) {
    ok('Body JSON rusak → 400 JSON, body > 5 MB → 413 JSON (bukan halaman HTML Express)');
  } else {
    bad('Body JSON rusak / terlalu besar dijawab JSON', `rusak=${rusak.status} ${JSON.stringify(rusakJson)} besar=${besar.status} ${JSON.stringify(besarJson)}`);
  }

  const takAda = await req('GET', '/api/tidak-ada-endpoint');
  const takAdaTulis = await req('DELETE', '/api/items/1/sub/x');
  const spa = await fetch(API + '/laporan');
  if (takAda.status === 404 && takAda.json?.success === false && takAdaTulis.status === 404 && takAdaTulis.json?.success === false && spa.status === 200 && /text\/html/.test(spa.headers.get('content-type') || '')) {
    ok('Rute /api tak dikenal → 404 JSON; fallback SPA untuk rute non-API tetap 200 HTML');
  } else {
    bad('Rute /api tak dikenal → 404 JSON', `get=${takAda.status} del=${takAdaTulis.status} spa=${spa.status}`);
  }
}

console.log('\n=== 0C. BATAS 5.000 BARIS & RINGKASAN SQL UTUH PADA GET /api/transactions ===');
{
  const penuh = await req('GET', '/api/transactions');
  const potong = await req('GET', '/api/transactions?limit=5');
  const batasMaks = await req('GET', '/api/transactions?limit=99999');
  const sPenuh = penuh.json?.summary;
  const sPotong = potong.json?.summary;
  const masukDiPotong = (potong.json?.data || [])
    .filter((t) => t.jenis === 'MASUK')
    .reduce((a, t) => a + Number(t.jumlah), 0);

  if (
    penuh.status === 200 &&
    sPenuh?.limit === 5000 &&
    sPenuh?.terpotong === false &&
    sPenuh?.total_transaksi === penuh.json?.data?.length &&
    potong.status === 200 &&
    potong.json?.data?.length === 5 &&
    sPotong?.ditampilkan === 5 &&
    sPotong?.limit === 5 &&
    sPotong?.terpotong === true &&
    sPotong?.truncated === true &&
    sPotong?.total_transaksi === sPenuh?.total_transaksi &&
    sPotong?.total_masuk_qty === sPenuh?.total_masuk_qty &&
    sPotong?.total_masuk_nilai === sPenuh?.total_masuk_nilai &&
    sPotong?.total_keluar_qty === sPenuh?.total_keluar_qty &&
    sPotong?.total_keluar_nilai === sPenuh?.total_keluar_nilai &&
    sPotong?.net_qty === sPenuh?.net_qty &&
    sPotong?.net_nilai === sPenuh?.net_nilai &&
    sPotong?.total_masuk_qty > masukDiPotong &&
    batasMaks.status === 200 &&
    batasMaks.json?.summary?.limit === 5000
  ) {
    ok(
      'GET /api/transactions membatasi baris (maks 5.000) dengan ringkasan SQL utuh atas seluruh data',
      `ditampilkan=${sPotong.ditampilkan}/${sPotong.total_transaksi}, terpotong=true, masuk=${sPotong.total_masuk_qty} unit`
    );
  } else {
    bad(
      'GET /api/transactions batas baris & ringkasan SQL utuh',
      `penuh=${JSON.stringify(sPenuh)} potong=${JSON.stringify(sPotong)} maks=${batasMaks.json?.summary?.limit}`
    );
  }
}

console.log('\n=== 0D. VALIDASI INPUT: MASTER BARANG, TRANSAKSI & TANGGAL (anti data rusak) ===');
{
  // Barang uji sementara supaya data contoh tidak tercemar
  const KODE_UJI = 'BRG-UJI-VALIDASI-01';
  const buat = await req('POST', '/api/items', {
    kode_barang: KODE_UJI, nama_barang: 'Barang Uji Validasi', satuan: 'unit',
    jenis_barang: 'Kabel Jaringan', stok: 10, min_stok: 2, harga_barang: 10000
  });
  const itemValid = buat.json?.data;
  const STOK_UJI = itemValid?.stok;

  // 1. POST /api/items: stok negatif / bukan angka, nama objek, jenis kosong → 400 tanpa membuat barang
  const tolakCreate = await Promise.all([
    req('POST', '/api/items', { kode_barang: KODE_UJI + '-NEG', nama_barang: 'Negatif', jenis_barang: 'Kabel Jaringan', stok: -5 }),
    req('POST', '/api/items', { kode_barang: KODE_UJI + '-NAN', nama_barang: 'Bukan Angka', jenis_barang: 'Kabel Jaringan', stok: 'abc' }),
    req('POST', '/api/items', { kode_barang: KODE_UJI + '-OBJ', nama_barang: { a: 1 }, jenis_barang: 'Kabel Jaringan', stok: 1 }),
    req('POST', '/api/items', { kode_barang: KODE_UJI + '-SP', nama_barang: 'Spasi', jenis_barang: '   ', stok: 1 }),
  ]);
  const dibuatTidakSengaja = db.prepare("SELECT COUNT(*) c FROM items WHERE kode_barang LIKE ?").get(KODE_UJI + '-%').c;
  if (tolakCreate.every((r) => r.status === 400 && r.json?.success === false) && dibuatTidakSengaja === 0 && itemValid?.stok === 10) {
    ok('POST /api/items: stok negatif/bukan angka, nama objek, dan jenis kosong ditolak 400 tanpa membuat barang');
  } else {
    bad('POST /api/items validasi input', `status=${tolakCreate.map((r) => r.status).join(',')} dibuat=${dibuatTidakSengaja}`);
  }

  // 2. PUT /api/items: angka negatif / stok bukan angka → 400, data lama tidak berubah
  const putTolak = await req('PUT', `/api/items/${itemValid.id}`, { min_stok: -9, harga_barang: -1, stok: 'abc' });
  const barisUji = db.prepare('SELECT * FROM items WHERE id = ?').get(itemValid.id);
  if (putTolak.status === 400 && barisUji.stok === STOK_UJI && barisUji.min_stok === 2 && barisUji.harga_barang === 10000) {
    ok('PUT /api/items: stok/min stok/harga negatif atau bukan angka ditolak 400 & data lama tetap utuh');
  } else {
    bad('PUT /api/items validasi angka', `HTTP ${putTolak.status} stok=${barisUji?.stok} min=${barisUji?.min_stok} harga=${barisUji?.harga_barang}`);
  }

  // 3. PUT /api/items: koreksi stok dari form edit WAJIB tercatat sebagai mutasi
  const markKoreksi = maxTrxId();
  const putStok = await req('PUT', `/api/items/${itemValid.id}`, { stok: STOK_UJI - 4 });
  const trxKoreksi = trxSince(markKoreksi);
  if (
    putStok.status === 200 && stockOf(KODE_UJI) === STOK_UJI - 4 &&
    trxKoreksi.length === 1 && trxKoreksi[0].jenis === 'KELUAR' &&
    Number(trxKoreksi[0].jumlah) === 4 && trxKoreksi[0].kategori_transaksi === 'Koreksi Stok'
  ) {
    ok('PUT /api/items: koreksi stok dari form edit tercatat sebagai mutasi KELUAR "Koreksi Stok"');
  } else {
    bad('PUT /api/items koreksi stok tercatat', `HTTP ${putStok.status} stok=${stockOf(KODE_UJI)} trx=${JSON.stringify(trxKoreksi.map((t) => [t.jenis, t.jumlah, t.kategori_transaksi]))}`);
  }

  // 4. POST /api/transactions: jenis/jumlah/tanggal/divisi tidak valid → 400 ramah, stok aman
  const stokSebelumTolak = stockOf(KODE_UJI);
  const markTolak = maxTrxId();
  const tolakTrx = await Promise.all([
    req('POST', '/api/transactions', { jenis: 'XYZ', divisi: 'GUDANG', lokasi_penerima: 'Uji', kode_barang: KODE_UJI, jumlah: 1 }),
    req('POST', '/api/transactions', { jenis: 'KELUAR', divisi: 'GUDANG', lokasi_penerima: 'Uji', kode_barang: KODE_UJI, jumlah: 'abc' }),
    req('POST', '/api/transactions', { jenis: 'MASUK', divisi: 'GUDANG', lokasi_penerima: 'Uji', kode_barang: KODE_UJI, jumlah: 1, tanggal: '2026-13-45' }),
    req('POST', '/api/transactions', { jenis: 'MASUK', divisi: 'GUDANG', lokasi_penerima: 'Uji', kode_barang: KODE_UJI, jumlah: 1, tanggal: '2026-02-30' }),
    req('POST', '/api/transactions', { jenis: 'MASUK', divisi: 'PELANGGANXYZ', lokasi_penerima: 'Uji', kode_barang: KODE_UJI, jumlah: 1 }),
  ]);
  const pesanRamah = tolakTrx.every((r) => r.status === 400 && r.json?.success === false
    && !/constraint failed|SQLITE|is not a function|undefined/i.test(r.json?.error || ''));
  if (pesanRamah && stockOf(KODE_UJI) === stokSebelumTolak && trxSince(markTolak).length === 0) {
    ok('POST /api/transactions: jenis/jumlah/tanggal/divisi tidak valid ditolak 400 (pesan ramah, stok & log utuh)');
  } else {
    bad('POST /api/transactions validasi input', `status=${tolakTrx.map((r) => r.status).join(',')} stok=${stockOf(KODE_UJI)}/${stokSebelumTolak} trx=${trxSince(markTolak).length} err=${tolakTrx.map((r) => r.json?.error).join(' | ')}`);
  }

  // 5. Kode barang pada transaksi manual tidak peka huruf besar/kecil
  const rKecil = await req('POST', '/api/transactions', { jenis: 'MASUK', divisi: 'GUDANG', lokasi_penerima: 'Uji Kode Kecil', kode_barang: KODE_UJI.toLowerCase(), jumlah: 2 });
  if (rKecil.status === 201 && stockOf(KODE_UJI) === stokSebelumTolak + 2) ok('POST /api/transactions: kode barang huruf kecil tetap dikenali');
  else bad('POST /api/transactions kode huruf kecil', `HTTP ${rKecil.status} stok=${stockOf(KODE_UJI)}`);

  // 6. Ganti kode barang saat terpasang → rujukan divisi ikut pindah (tidak jadi barang yatim)
  const idPelUji = 'PLG-UJI-VALIDASI';
  const buatPel = await req('POST', '/api/customers', {
    id_pelanggan: idPelUji, nama_pelanggan: 'Pelanggan Uji Validasi', items: [{ kode_barang: KODE_UJI, jumlah: 1 }]
  });
  const pelUji = buatPel.json?.data;
  const KODE_BARU = KODE_UJI + '-BARU';
  const rRename = await req('PUT', `/api/items/${itemValid.id}`, { kode_barang: KODE_BARU });
  const barisTerpasang = db.prepare('SELECT COUNT(*) c FROM customer_items WHERE customer_id = ? AND kode_barang = ?').get(pelUji?.id, KODE_BARU).c;
  const barisYatim = db.prepare('SELECT COUNT(*) c FROM customer_items WHERE UPPER(kode_barang) = UPPER(?)').get(KODE_UJI).c;
  // Bersihkan: hapus pelanggan (stok kembali), kembalikan kode, lalu hapus barang uji
  if (pelUji?.id) await req('DELETE', `/api/customers/${pelUji.id}`);
  await req('PUT', `/api/items/${itemValid.id}`, { kode_barang: KODE_UJI });
  const hapusUji = await req('DELETE', `/api/items/${itemValid.id}`);
  if (rRename.status === 200 && barisTerpasang === 1 && barisYatim === 0 && hapusUji.status === 200) {
    ok('PUT /api/items: ganti kode barang ikut memindahkan rujukan barang terpasang (tanpa baris yatim)');
  } else {
    bad('PUT /api/items ganti kode', `rename=${rRename.status} barisBaru=${barisTerpasang} yatim=${barisYatim} hapus=${hapusUji.status}`);
  }
}

console.log('\n=== 1. PEMASANGAN PELANGGAN (POST /api/customers) ===');
let snap = allStocks();
let mark = maxTrxId();

let r = await req('POST', '/api/customers', {
  id_pelanggan: 'T-OVER', nama_pelanggan: 'Uji Over Stok', infrastruktur: 'optic', paket: 'home',
  items: [{ kode_barang: KODE, jumlah: 999 }],
});
if (r.status >= 400) ok('Pasang melebihi stok ditolak', `HTTP ${r.status}`);
else bad('Pasang melebihi stok ditolak', `HTTP ${r.status} — stok jadi minus!`);
if (stockOf(KODE) === STOK_AWAL) ok('Stok tidak berubah setelah penolakan');
else bad('Stok tidak berubah setelah penolakan', `stok=${stockOf(KODE)}`);

r = await req('POST', '/api/customers', {
  id_pelanggan: 'T-NEG', nama_pelanggan: 'Uji Qty Negatif', infrastruktur: 'optic', paket: 'home',
  items: [{ kode_barang: KODE, jumlah: -5 }],
});
if (r.status >= 400) ok('Jumlah negatif ditolak', `HTTP ${r.status}`);
else bad('Jumlah negatif ditolak', `HTTP ${r.status} — stok naik diam-diam!`);
if (stockOf(KODE) === STOK_AWAL) ok('Stok tidak berubah oleh jumlah negatif');
else bad('Stok tidak berubah oleh jumlah negatif', `stok=${stockOf(KODE)}`);

r = await req('POST', '/api/customers', {
  id_pelanggan: 'T-KODE', nama_pelanggan: 'Uji Kode Salah', infrastruktur: 'optic', paket: 'home',
  items: [{ kode_barang: 'KODE-NGAWUR-999', jumlah: 1 }],
});
if (r.status >= 400) ok('Kode barang tak terdaftar ditolak', `HTTP ${r.status}`);
else bad('Kode barang tak terdaftar ditolak', `HTTP ${r.status}`);

r = await req('POST', '/api/customers', {
  id_pelanggan: 'T-OK', nama_pelanggan: 'Uji Pasang Normal', infrastruktur: 'optic', paket: 'home',
  items: [{ kode_barang: KODE, jumlah: 2 }],
});
const idPelanggan = r.json?.data?.id;
if (r.status === 201) ok('Pemasangan wajar berhasil', `HTTP 201`);
else bad('Pemasangan wajar berhasil', `HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`);
if (stockOf(KODE) === STOK_AWAL - 2) ok('Stok berkurang tepat 2', `stok=${stockOf(KODE)}`);
else bad('Stok berkurang tepat 2', `stok=${stockOf(KODE)}, harap ${STOK_AWAL - 2}`);
const trxMasuk = trxSince(mark);
if (trxMasuk.length === 1 && trxMasuk[0].jenis === 'KELUAR' && Number(trxMasuk[0].jumlah) === 2)
  ok('Mutasi tercatat di transaksi', `1 baris KELUAR jumlah 2`);
else bad('Mutasi tercatat di transaksi', `tercatat ${trxMasuk.length} baris`);

console.log('\n=== 2. EDIT DATA PELANGGAN (PUT /api/customers/:id) ===');
snap = allStocks(); mark = maxTrxId();

r = await req('PUT', `/api/customers/${idPelanggan}`, {
  items: [{ kode_barang: KODE, jumlah: 500 }],
});
if (r.status >= 400) ok('Edit melebihi stok ditolak', `HTTP ${r.status}`);
else bad('Edit melebihi stok ditolak', `HTTP ${r.status} — stok jadi minus!`);
if (stockOf(KODE) === STOK_AWAL - 2) ok('Stok utuh setelah edit ditolak (rollback)');
else bad('Stok utuh setelah edit ditolak', `stok=${stockOf(KODE)}`);

r = await req('PUT', `/api/customers/${idPelanggan}`, {
  items: [{ kode_barang: KODE, jumlah: 1 }],
});
if (r.status === 200) ok('Edit wajar berhasil', `HTTP 200`);
else bad('Edit wajar berhasil', `HTTP ${r.status}`);
if (stockOf(KODE) === STOK_AWAL - 1) ok('Stok menyesuaikan selisih (1 unit kembali)', `stok=${stockOf(KODE)}`);
else bad('Stok menyesuaikan selisih', `stok=${stockOf(KODE)}, harap ${STOK_AWAL - 1}`);
if (trxSince(mark).some(t => t.jenis === 'MASUK' && Number(t.jumlah) === 1))
  ok('Penyesuaian edit tercatat sebagai MASUK 1');
else bad('Penyesuaian edit tercatat sebagai MASUK 1', 'tidak ada mutasi tercatat');

console.log('\n=== 3. DISMANTLE & HAPUS PELANGGAN ===');
snap = allStocks(); mark = maxTrxId();
r = await req('POST', `/api/customers/${idPelanggan}/dismantle`, {});
if (r.status === 200) ok('Dismantle berhasil', `HTTP 200`);
else bad('Dismantle berhasil', `HTTP ${r.status}`);
if (stockOf(KODE) === STOK_AWAL) ok('Stok kembali penuh setelah dismantle', `stok=${stockOf(KODE)}`);
else bad('Stok kembali penuh setelah dismantle', `stok=${stockOf(KODE)}`);

r = await req('DELETE', `/api/customers/${idPelanggan}`);
if (r.status === 200) ok('Hapus pelanggan berhasil', `HTTP 200`);
else bad('Hapus pelanggan berhasil', `HTTP ${r.status}`);
if (stockOf(KODE) === STOK_AWAL) ok('Hapus setelah dismantle tidak menggandakan stok', `stok=${stockOf(KODE)}`);
else bad('Hapus setelah dismantle tidak menggandakan stok', `stok=${stockOf(KODE)}`);

// Pelanggan dengan barang terpasang, langsung dihapus (tanpa dismantle)
r = await req('POST', '/api/customers', {
  id_pelanggan: 'T-DEL', nama_pelanggan: 'Uji Hapus Langsung', infrastruktur: 'optic', paket: 'home',
  items: [{ kode_barang: KODE, jumlah: 3 }],
});
const idDel = r.json?.data?.id;
if (stockOf(KODE) === STOK_AWAL - 3) ok('Pelanggan uji terpasang 3 unit', `stok=${stockOf(KODE)}`);
else bad('Pelanggan uji terpasang 3 unit', `stok=${stockOf(KODE)}`);
await req('DELETE', `/api/customers/${idDel}`);
if (stockOf(KODE) === STOK_AWAL) ok('Hapus pelanggan mengembalikan stok', `stok=${stockOf(KODE)}`);
else bad('Hapus pelanggan mengembalikan stok', `stok=${stockOf(KODE)}, harap ${STOK_AWAL} — stok hilang!`);

console.log('\n=== 4. DIVISI FO (POST/PUT/DELETE /api/fo) ===');
snap = allStocks(); mark = maxTrxId();
r = await req('POST', '/api/fo', { daerah_lokasi: 'UJI-OVER-FO', items: [{ kode_barang: KODE, jumlah: 999 }] });
if (r.status >= 400) ok('FO: pasang melebihi stok ditolak', `HTTP ${r.status}`);
else bad('FO: pasang melebihi stok ditolak', `HTTP ${r.status} — stok minus!`);

r = await req('POST', '/api/fo', { daerah_lokasi: 'UJI-FO', pic_teknisi: 'Teknisi Uji', items: [{ kode_barang: KODE, jumlah: 4 }] });
const idFo = r.json?.data?.id;
if (r.status === 201) ok('FO: pemasangan wajar berhasil', `HTTP 201`);
else bad('FO: pemasangan wajar berhasil', `HTTP ${r.status}`);
if (stockOf(KODE) === STOK_AWAL - 4) ok('FO: stok berkurang 4', `stok=${stockOf(KODE)}`);
else bad('FO: stok berkurang 4', `stok=${stockOf(KODE)}`);

r = await req('PUT', `/api/fo/${idFo}`, { items: [{ kode_barang: KODE, jumlah: 400 }] });
if (r.status >= 400) ok('FO: edit melebihi stok ditolak', `HTTP ${r.status}`);
else bad('FO: edit melebihi stok ditolak', `HTTP ${r.status}`);
if (stockOf(KODE) === STOK_AWAL - 4) ok('FO: stok utuh setelah edit ditolak');
else bad('FO: stok utuh setelah edit ditolak', `stok=${stockOf(KODE)}`);

await req('DELETE', `/api/fo/${idFo}`);
if (stockOf(KODE) === STOK_AWAL) ok('FO: hapus mengembalikan stok', `stok=${stockOf(KODE)}`);
else bad('FO: hapus mengembalikan stok', `stok=${stockOf(KODE)}, harap ${STOK_AWAL} — stok hilang!`);

console.log('\n=== 5. DIVISI TOWER (POST/PUT/DELETE /api/tower) ===');
r = await req('POST', '/api/tower', { daerah_lokasi: 'UJI-OVER-TWR', items: [{ kode_barang: KODE, jumlah: 999 }] });
if (r.status >= 400) ok('Tower: pasang melebihi stok ditolak', `HTTP ${r.status}`);
else bad('Tower: pasang melebihi stok ditolak', `HTTP ${r.status} — stok minus!`);

r = await req('POST', '/api/tower', { daerah_lokasi: 'UJI-TWR', jenis: 'tower', type: 'triangle', items: [{ kode_barang: KODE, jumlah: 5 }] });
const idTower = r.json?.data?.id;
if (r.status === 201) ok('Tower: pemasangan wajar berhasil', `HTTP 201`);
else bad('Tower: pemasangan wajar berhasil', `HTTP ${r.status}`);
if (stockOf(KODE) === STOK_AWAL - 5) ok('Tower: stok berkurang 5', `stok=${stockOf(KODE)}`);
else bad('Tower: stok berkurang 5', `stok=${stockOf(KODE)}`);

r = await req('PUT', `/api/tower/${idTower}`, { items: [{ kode_barang: KODE, jumlah: 900 }] });
if (r.status >= 400) ok('Tower: edit melebihi stok ditolak', `HTTP ${r.status}`);
else bad('Tower: edit melebihi stok ditolak', `HTTP ${r.status}`);

r = await req('DELETE', `/api/tower/${idTower}`);
if (stockOf(KODE) === STOK_AWAL) ok('Tower: hapus mengembalikan stok', `stok=${stockOf(KODE)}`);
else bad('Tower: hapus mengembalikan stok', `stok=${stockOf(KODE)}, harap ${STOK_AWAL} — stok hilang! (id=${idTower}, HTTP ${r.status}: ${r.json?.error || r.json?.message || '-'})`);

console.log('\n=== 6. MUTASI STOK MANUAL & LAIN-LAIN ===');
const itemUji = db.prepare('SELECT * FROM items WHERE kode_barang = ?').get(KODE);

// Penyesuaian stok cepat dari Master Barang
r = await req('POST', `/api/items/${itemUji.id}/stock-adjust`, { jenis: 'MASUK', jumlah: 3, keterangan: 'uji stok masuk' });
if (r.status === 200) ok('Penyesuaian stok MASUK berhasil', `HTTP 200`);
else bad('Penyesuaian stok MASUK berhasil', `HTTP ${r.status} ${r.json?.error || ''}`);
if (stockOf(KODE) === STOK_AWAL + 3) ok('Stok bertambah 3 setelah penyesuaian MASUK', `stok=${stockOf(KODE)}`);
else bad('Stok bertambah 3 setelah penyesuaian MASUK', `stok=${stockOf(KODE)}`);

r = await req('POST', `/api/items/${itemUji.id}/stock-adjust`, { jenis: 'KELUAR', jumlah: 3, keterangan: 'uji stok keluar' });
if (r.status === 200 && stockOf(KODE) === STOK_AWAL) ok('Penyesuaian stok KELUAR mengembalikan stok', `stok=${stockOf(KODE)}`);
else bad('Penyesuaian stok KELUAR mengembalikan stok', `HTTP ${r.status}, stok=${stockOf(KODE)}`);

r = await req('POST', `/api/items/${itemUji.id}/stock-adjust`, { jenis: 'KELUAR', jumlah: -10 });
if (r.status >= 400) ok('Penyesuaian stok negatif ditolak', `HTTP ${r.status}`);
else bad('Penyesuaian stok negatif ditolak', `HTTP ${r.status}`);

r = await req('POST', `/api/items/${itemUji.id}/stock-adjust`, { jenis: 'KELUAR', jumlah: 9999 });
if (r.status >= 400) ok('Penyesuaian melebihi stok ditolak', `HTTP ${r.status}`);
else bad('Penyesuaian melebihi stok ditolak', `HTTP ${r.status}`);

// Catat mutasi manual pada tab "Keluar / Masuk"
r = await req('POST', '/api/transactions', {
  jenis: 'MASUK', kategori_transaksi: 'Pembelian Supplier', divisi: 'GUDANG',
  lokasi_penerima: 'Supplier Uji', kode_barang: KODE, jumlah: 4, keterangan: 'uji mutasi manual',
});
if (r.status === 200 || r.status === 201) ok('Catat mutasi manual berhasil', `HTTP ${r.status}`);
else bad('Catat mutasi manual berhasil', `HTTP ${r.status} ${r.json?.error || ''}`);
if (stockOf(KODE) === STOK_AWAL + 4) ok('Stok bertambah 4 dari mutasi manual', `stok=${stockOf(KODE)}`);
else bad('Stok bertambah 4 dari mutasi manual', `stok=${stockOf(KODE)}`);

r = await req('POST', '/api/transactions', {
  jenis: 'KELUAR', kategori_transaksi: 'Mutasi', divisi: 'GUDANG',
  lokasi_penerima: 'Operasional', kode_barang: KODE, jumlah: 4, keterangan: 'kembalikan',
});
if (stockOf(KODE) === STOK_AWAL) ok('Mutasi manual KELUAR mengembalikan stok', `stok=${stockOf(KODE)}`);
else bad('Mutasi manual KELUAR mengembalikan stok', `stok=${stockOf(KODE)}`);

r = await req('GET', `/api/scanner/lookup/${KODE}`);
if (r.status === 200) ok('Lookup barcode/SN berfungsi', `HTTP 200`);
else bad('Lookup barcode/SN berfungsi', `HTTP ${r.status}`);

console.log('\n=== 6B. SINKRONISASI TANGGAL & WAKTU (semua divisi & mutasi) ===');
{
  // Transaksi terbaru harus memakai tanggal lokal server (bukan UTC)
  const terbaru = db.prepare('SELECT tanggal, waktu FROM transactions ORDER BY id DESC LIMIT 1').get();
  const tglSql = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const fmtWaktuOk = /^\d{2}:\d{2}:\d{2}$/.test(terbaru.waktu);
  if (terbaru.tanggal === tglSql && fmtWaktuOk) {
    ok(`Tanggal transaksi = tanggal lokal server (${terbaru.tanggal} ${terbaru.waktu})`);
  } else {
    bad('Tanggal transaksi = tanggal lokal server', `trx=${terbaru.tanggal} ${terbaru.waktu} vs sql=${tglSql}`);
  }

  // Seluruh transaksi yang dibuat selama pengujian: tanggal & created_at harus hari yang sama (zona lokal)
  const beda = db.prepare(`
    SELECT COUNT(*) AS c FROM transactions
    WHERE id > ? AND tanggal != date(created_at, 'localtime')
  `).get(GLOBAL_MARK).c;
  if (beda === 0) ok('Tanggal vs created_at konsisten untuk semua mutasi uji');
  else bad('Tanggal vs created_at konsisten untuk semua mutasi uji', `${beda} baris beda hari (indikasi campur UTC/lokal)`);

  // Nomor transaksi (YYYYMM) harus selaras dengan tanggal lokalnya
  const salahBulan = db.prepare(`
    SELECT COUNT(*) AS c FROM transactions
    WHERE id > ? AND no_transaksi NOT LIKE '%-' || replace(substr(tanggal, 1, 7), '-', '') || '-%'
  `).get(GLOBAL_MARK).c;
  if (salahBulan === 0) ok('Prefix bulan nomor transaksi selaras dengan tanggal');
  else bad('Prefix bulan nomor transaksi selaras dengan tanggal', `${salahBulan} baris tidak selaras`);
}

console.log('\n=== 7. INVARIANT AKHIR ===');
checkNoNegativeStock('akhir pengujian');
checkInvariant('seluruh pengujian', GLOBAL_SNAP, GLOBAL_MARK);

console.log('\n=== 8. MANAJEMEN USER & HIRARKI PERAN ===');

// Admin bisa melihat daftar user
let createdUserId = null;
{
  const r = await req('GET', '/api/users');
  if (r.status === 200 && Array.isArray(r.json?.data) && r.json.data.length >= 4) {
    ok('Daftar user bisa diambil admin', `${r.json.data.length} user terdaftar`);
  } else {
    bad('Daftar user bisa diambil admin', `status=${r.status}`);
  }
}

// Buat user baru → langsung bisa login
{
  const uname = 'testoperator';
  const r = await req('POST', '/api/users', {
    username: uname, password: 'rahasia1', nama_lengkap: 'Operator Uji Coba', role: 'staff_gudang', status: 'aktif'
  });
  if (r.status === 201 && r.json?.data?.id) {
    createdUserId = r.json.data.id;
    ok('Admin dapat membuat user baru');
  } else {
    bad('Admin dapat membuat user baru', `status=${r.status} ${r.json?.error || ''}`);
  }

  const loginBaru = await req('POST', '/api/auth/login', { username: uname, password: 'rahasia1' }, { noAuth: true });
  if (loginBaru.status === 200 && loginBaru.json?.data?.user?.role === 'staff_gudang') {
    ok('User baru bisa login dengan peran yang benar');
  } else {
    bad('User baru bisa login dengan peran yang benar', `status=${loginBaru.status}`);
  }

  // Token user baru (staff_gudang): boleh tulis items, TIDAK boleh kelola users
  const staffToken = loginBaru.json?.data?.token;
  if (staffToken) {
    const simpanToken = TOKEN;
    TOKEN = staffToken;
    const tulisUsers = await req('POST', '/api/users', { username: 'x12345x', password: 'rahasia1', nama_lengkap: 'Ilegal', role: 'admin' });
    if (tulisUsers.status === 403) ok('Staff gudang ditolak mengelola user (403)');
    else bad('Staff gudang ditolak mengelola user (403)', `status=${tulisUsers.status}`);
    const tulisItem = await req('POST', '/api/items', { kode_barang: 'BRG-UJI-ROLE', nama_barang: 'Uji Hak Staff', jenis_barang: 'Kabel Jaringan', satuan: 'pcs' });
    if (tulisItem.status === 201) {
      ok('Staff gudang boleh menambah barang');
      await req('DELETE', `/api/items/${tulisItem.json.data.id}`);
    } else {
      bad('Staff gudang boleh menambah barang', `status=${tulisItem.status}`);
    }
    TOKEN = simpanToken;
  }
}

// Edit user: ganti nama & peran
if (createdUserId) {
  const r = await req('PUT', `/api/users/${createdUserId}`, { nama_lengkap: 'Operator Uji (Revisi)', role: 'teknisi' });
  if (r.status === 200 && r.json?.data?.role === 'teknisi' && r.json.data.nama_lengkap.includes('Revisi')) {
    ok('Edit user (nama & peran) berhasil');
  } else {
    bad('Edit user (nama & peran) berhasil', `status=${r.status}`);
  }

  // Nonaktifkan → login harus ditolak
  await req('PUT', `/api/users/${createdUserId}`, { status: 'nonaktif' });
  const loginMati = await req('POST', '/api/auth/login', { username: 'testoperator', password: 'rahasia1' }, { noAuth: true });
  if (loginMati.status === 403) ok('User nonaktif tidak bisa login (403)');
  else bad('User nonaktif tidak bisa login (403)', `status=${loginMati.status}`);

  // Hapus user
  const del = await req('DELETE', `/api/users/${createdUserId}`);
  if (del.status === 200) ok('Admin dapat menghapus user');
  else bad('Admin dapat menghapus user', `status=${del.status}`);
}

// Admin tidak bisa menghapus akunnya sendiri
{
  const me = await req('GET', '/api/auth/me');
  const selfId = me.json?.data?.user?.id;
  const del = await req('DELETE', `/api/users/${selfId}`);
  if (del.status === 400) ok('Proteksi: admin tidak bisa menghapus akun sendiri');
  else bad('Proteksi: admin tidak bisa menghapus akun sendiri', `status=${del.status}`);
}

console.log('\n=== 8B. CADANGAN & PEMULIHAN DATABASE (khusus admin) ===');
// Catatan: jalur pemulihan yang SUKSES sengaja tidak diuji di sini — server akan
// keluar (process.exit) agar systemd Restart=always memuat DB baru, dan itu akan
// mematikan server pengujian. Yang diuji: hak akses, cadangan valid, dan semua
// penolakan pemulihan (DB aktif harus tetap utuh).
{
  const { writeFileSync, existsSync, readdirSync, rmSync } = await import('node:fs');
  const os = await import('node:os');
  const tmpDir = os.tmpdir();
  const tmpFiles = [];
  const tmpPath = (nama) => { const p = path.join(tmpDir, `sim-aset-uji-${process.pid}-${nama}`); tmpFiles.push(p); return p; };
  const kirimRestore = async (buf, { konfirmasi = 'PULIHKAN', token = TOKEN } = {}) => {
    const q = konfirmasi === null ? '' : `?konfirmasi=${encodeURIComponent(konfirmasi)}`;
    const res = await fetch(`${API}/api/admin/database/restore${q}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${token}` },
      body: buf
    });
    let json = null; try { json = await res.json(); } catch { /* biarkan */ }
    return { status: res.status, json };
  };
  const sidikJariDb = () => JSON.stringify({ items: allStocks(), cust: db.prepare('SELECT id, nama_pelanggan FROM customers ORDER BY id').all(), trx: maxTrxId() });
  const sidikAwal = sidikJariDb();
  // Berkas sementara (.backup-*/.restore-*) yang sudah ada sebelum seksi ini (mis. dari
  // proses server lain) tidak dihitung — yang diuji adalah kebocoran dari langkah di sini.
  const tempDiData = () => readdirSync(path.dirname(DB_PATH)).filter((f) => f.startsWith('.restore-') || f.startsWith('.backup-'));
  const tempAwal = new Set(tempDiData());

  // 1) Info database untuk admin
  {
    const r = await req('GET', '/api/admin/database/info');
    const d = r.json?.data;
    if (r.status === 200 && d && d.counts?.items === db.prepare('SELECT COUNT(*) c FROM items').get().c && d.kataKonfirmasi === 'PULIHKAN' && typeof d.systemd === 'boolean' && Array.isArray(d.cadangan)) {
      ok('Info database (ukuran, jumlah data, daftar cadangan, deteksi systemd) tersedia untuk admin', `${d.counts.items} barang, journal=${d.journalMode}`);
    } else {
      bad('Info database tersedia untuk admin', `status=${r.status} ${JSON.stringify(r.json)?.slice(0, 160)}`);
    }
  }

  // 2) Peran non-admin ditolak di ketiga endpoint (GET maupun POST)
  {
    const loginStaff = await req('POST', '/api/auth/login', { username: 'gudang', password: 'gudang123' }, { noAuth: true });
    const staffToken = loginStaff.json?.data?.token;
    const simpan = TOKEN; TOKEN = staffToken || '';
    const info = await req('GET', '/api/admin/database/info');
    const unduh = await fetch(`${API}/api/admin/database/backup`, { headers: { Authorization: `Bearer ${staffToken}` } });
    TOKEN = simpan;
    const pulih = await kirimRestore(Buffer.alloc(4096, 1), { token: staffToken });
    if (staffToken && info.status === 403 && unduh.status === 403 && pulih.status === 403) {
      ok('Staff gudang ditolak melihat info, mengunduh cadangan, dan memulihkan database (403)');
    } else {
      bad('Staff gudang ditolak mengelola cadangan database (403)', `info=${info.status} unduh=${unduh.status} pulih=${pulih.status}`);
    }
  }

  // 3) Unduh cadangan: berkas SQLite valid, lolos integrity_check, isi sama dengan DB aktif
  let cadanganBuf = null;
  {
    const res = await fetch(`${API}/api/admin/database/backup`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const disp = res.headers.get('content-disposition') || '';
    cadanganBuf = Buffer.from(await res.arrayBuffer());
    const p = tmpPath('cadangan.db');
    writeFileSync(p, cadanganBuf);
    let integritas = null, jumlahItem = null, jumlahUser = null;
    try {
      const c = new DatabaseSync(p, { readOnly: true });
      integritas = Object.values(c.prepare('PRAGMA integrity_check').get())[0];
      jumlahItem = c.prepare('SELECT COUNT(*) c FROM items').get().c;
      jumlahUser = c.prepare('SELECT COUNT(*) c FROM users').get().c;
      c.close();
    } catch (e) { integritas = `error: ${e.message}`; }
    const itemAktif = db.prepare('SELECT COUNT(*) c FROM items').get().c;
    const header = cadanganBuf.subarray(0, 15).toString('latin1') === 'SQLite format 3';
    if (res.status === 200 && /attachment; filename="sim-aset-\d{8}-\d{6}\.db"/.test(disp) && header && integritas === 'ok' && jumlahItem === itemAktif && jumlahUser >= 4) {
      ok('Unduh cadangan menghasilkan berkas SQLite utuh (integrity_check ok, isi = DB aktif)', `${cadanganBuf.length} byte, ${jumlahItem} barang`);
    } else {
      bad('Unduh cadangan menghasilkan berkas SQLite utuh', `status=${res.status} disp="${disp}" header=${header} integritas=${integritas} item=${jumlahItem}/${itemAktif}`);
    }
  }

  // 4) Pemulihan ditolak tanpa kata konfirmasi & bila berkas bukan SQLite
  {
    const tanpaKonfirmasi = await kirimRestore(cadanganBuf, { konfirmasi: null });
    const kataSalah = await kirimRestore(cadanganBuf, { konfirmasi: 'pulihkan' });
    const bukanSqlite = await kirimRestore(Buffer.from('bukan database sama sekali '.repeat(100)));
    const terlaluKecil = await kirimRestore(Buffer.from('SQLite format 3\u0000'));
    if (tanpaKonfirmasi.status === 400 && kataSalah.status === 400 && bukanSqlite.status === 400 && terlaluKecil.status === 400
      && /PULIHKAN/.test(tanpaKonfirmasi.json?.error || '') && /bukan database SQLite/i.test(bukanSqlite.json?.error || '')) {
      ok('Pemulihan ditolak tanpa konfirmasi PULIHKAN, kata salah, berkas bukan SQLite, atau terlalu kecil (400)');
    } else {
      bad('Pemulihan ditolak tanpa konfirmasi / berkas bukan SQLite (400)', `tanpa=${tanpaKonfirmasi.status} salah=${kataSalah.status} bukan=${bukanSqlite.status} kecil=${terlaluKecil.status}`);
    }
  }

  // 5) Pemulihan ditolak bila SQLite asing (tabel wajib hilang) atau tanpa admin aktif;
  //    DB aktif tidak boleh berubah & tidak ada berkas sementara tertinggal
  {
    const asing = tmpPath('asing.db');
    const a = new DatabaseSync(asing);
    a.exec('CREATE TABLE catatan (isi TEXT)');
    for (let i = 0; i < 200; i++) a.exec(`INSERT INTO catatan VALUES ('baris ${i}')`);
    a.close();
    const tanpaAdmin = tmpPath('tanpa-admin.db');
    writeFileSync(tanpaAdmin, cadanganBuf);
    const n = new DatabaseSync(tanpaAdmin);
    n.exec("UPDATE users SET status = 'nonaktif' WHERE role = 'admin'");
    n.close();

    // Kandidat ber-mode WAL (seperti salinan mentah inventory.db): saat divalidasi SQLite membuat
    // berkas pendamping -wal/-shm — keduanya tidak boleh tertinggal di data/.
    const walMode = tmpPath('wal-tanpa-admin.db');
    writeFileSync(walMode, cadanganBuf);
    const w = new DatabaseSync(walMode);
    w.exec('PRAGMA journal_mode = WAL');
    w.exec("UPDATE users SET status = 'nonaktif' WHERE role = 'admin'");
    w.close();
    for (const ext of ['-wal', '-shm']) { try { rmSync(walMode + ext, { force: true }); } catch { /* abaikan */ } }

    const rAsing = await kirimRestore(readFileSync(asing));
    const rTanpaAdmin = await kirimRestore(readFileSync(tanpaAdmin));
    const rWal = await kirimRestore(readFileSync(walMode));
    const sisaTemp = tempDiData().filter((f) => !tempAwal.has(f)); // termasuk .restore-*.db-wal / -shm
    const serverMasihHidup = (await req('GET', '/api/health', undefined, { noAuth: true })).status === 200;
    if (rAsing.status === 400 && /tabel wajib/i.test(rAsing.json?.error || '')
      && rTanpaAdmin.status === 400 && /Administrator aktif/i.test(rTanpaAdmin.json?.error || '')
      && rWal.status === 400 && /Administrator aktif/i.test(rWal.json?.error || '')
      && sidikJariDb() === sidikAwal && sisaTemp.length === 0 && serverMasihHidup) {
      ok('Pemulihan ditolak untuk SQLite asing (tabel wajib hilang) & cadangan tanpa admin aktif (termasuk ber-mode WAL); DB aktif utuh, tanpa berkas sementara/-wal/-shm');
    } else {
      bad('Pemulihan ditolak untuk SQLite asing / tanpa admin aktif, DB aktif utuh', `asing=${rAsing.status} "${rAsing.json?.error || ''}" wal=${rWal.status} tanpaAdmin=${rTanpaAdmin.status} "${rTanpaAdmin.json?.error || ''}" utuh=${sidikJariDb() === sidikAwal} temp=${sisaTemp.join(',')} hidup=${serverMasihHidup}`);
    }
  }

  for (const f of tmpFiles) { try { if (existsSync(f)) rmSync(f); } catch { /* abaikan */ } }
}

console.log('\n=== 6C. SCAN BARCODE → TRANSAKSI TERTAUT DIVISI (pasang & pengembalian) ===');
{
  // Ambil pelanggan data contoh pertama
  const custRes = await req('GET', '/api/customers');
  const cust = custRes.json?.data?.[0];
  const getCustQty = async () => {
    const c = await req('GET', `/api/customers/${cust.id}`);
    return (c.json?.data?.items || [])
      .filter((it) => it.kode_barang === KODE)
      .reduce((a, it) => a + Number(it.jumlah), 0);
  };

  // 1. KELUAR tertaut (seperti hasil scan stiker di gudang): stok turun + barang tercatat terpasang
  const stokAwalLink = stockOf(KODE);
  const terpasangAwal = await getCustQty();
  let r = await req('POST', '/api/transactions', {
    jenis: 'KELUAR', divisi: 'PELANGGAN', tujuan_id: cust.id, kode_barang: KODE, jumlah: 2, keterangan: 'uji scan pasang'
  });
  const terpasangSesudah = await getCustQty();
  if (r.status === 201 && terpasangSesudah === terpasangAwal + 2 && stockOf(KODE) === stokAwalLink - 2) {
    ok('Scan → KELUAR ke pelanggan: barang tercatat terpasang & stok gudang berkurang');
  } else {
    bad('Scan → KELUAR ke pelanggan', `status=${r.status} terpasang ${terpasangAwal}→${terpasangSesudah} stok ${stokAwalLink}→${stockOf(KODE)}`);
  }

  // Riwayat otomatis memakai nama pelanggan & kategori pemasangan
  const trxTaut = db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 1').get();
  if (trxTaut.divisi === 'PELANGGAN' && trxTaut.kategori_transaksi.includes('Pemasangan') && trxTaut.lokasi_penerima === cust.nama_pelanggan) {
    ok('Riwayat tertaut: divisi + nama pelanggan + kategori Pemasangan otomatis');
  } else {
    bad('Riwayat tertaut otomatis', `divisi=${trxTaut.divisi} kategori=${trxTaut.kategori_transaksi} lokasi=${trxTaut.lokasi_penerima}`);
  }

  // Nilai aset pelanggan (total_harga) sinkron dengan jumlah subtotal barang terpasang
  const sumSub = db.prepare('SELECT COALESCE(SUM(subtotal), 0) AS s FROM customer_items WHERE customer_id = ?').get(cust.id).s;
  const custAfter = await req('GET', `/api/customers/${cust.id}`);
  if (Math.abs(Number(custAfter.json?.data?.total_harga ?? -1) - Number(sumSub)) < 0.01) {
    ok('Nilai aset pelanggan sinkron dengan barang terpasang');
  } else {
    bad('Nilai aset pelanggan sinkron', `total_harga=${custAfter.json?.data?.total_harga} vs sum=${sumSub}`);
  }

  // 2. KELUAR melebihi stok gudang harus ditolak & stok tidak berubah
  const stokSebelumOver = stockOf(KODE);
  r = await req('POST', '/api/transactions', {
    jenis: 'KELUAR', divisi: 'PELANGGAN', tujuan_id: cust.id, kode_barang: KODE, jumlah: stokSebelumOver + 999
  });
  if (r.status === 400 && stockOf(KODE) === stokSebelumOver) {
    ok('KELUAR tertaut melebihi stok gudang ditolak (400), stok aman');
  } else {
    bad('KELUAR tertaut melebihi stok ditolak', `status=${r.status}`);
  }

  // 3. Tujuan divisi tidak ditemukan harus ditolak
  r = await req('POST', '/api/transactions', {
    jenis: 'KELUAR', divisi: 'PELANGGAN', tujuan_id: 999999, kode_barang: KODE, jumlah: 1
  });
  if (r.status === 400) ok('Tujuan divisi tidak ditemukan ditolak (400)');
  else bad('Tujuan divisi tidak ditemukan ditolak', `status=${r.status}`);

  // 4. MASUK tertaut (pengembalian): terpasang berkurang & stok gudang kembali
  const terpasangSebelumBalik = await getCustQty();
  const stokSebelumBalik = stockOf(KODE);
  r = await req('POST', '/api/transactions', {
    jenis: 'MASUK', divisi: 'PELANGGAN', tujuan_id: cust.id, kode_barang: KODE, jumlah: 2
  });
  const terpasangSetelahBalik = await getCustQty();
  if (r.status === 201 && terpasangSetelahBalik === terpasangSebelumBalik - 2 && stockOf(KODE) === stokSebelumBalik + 2) {
    ok('Scan → MASUK dari pelanggan: terpasang berkurang & stok gudang kembali');
  } else {
    bad('Scan → MASUK dari pelanggan', `status=${r.status} terpasang ${terpasangSebelumBalik}→${terpasangSetelahBalik} stok ${stokSebelumBalik}→${stockOf(KODE)}`);
  }

  // 5. Pengembalian melebihi jumlah terpasang ditolak
  r = await req('POST', '/api/transactions', {
    jenis: 'MASUK', divisi: 'PELANGGAN', tujuan_id: cust.id, kode_barang: KODE, jumlah: terpasangSebelumBalik + 99999
  });
  if (r.status === 400) ok('Pengembalian melebihi jumlah terpasang ditolak (400)');
  else bad('Pengembalian melebihi terpasang ditolak', `status=${r.status}`);

  // 6. Site FO: buat site uji kosong, pasang via transaksi scan (dengan SN), lalu gabung baris
  const foRes = await req('POST', '/api/fo', { daerah_lokasi: 'UJI-LINK-FO', tipe_lokasi: 'ODP', items: [] });
  const foId = foRes.json?.data?.id;
  const stokSebelumFo = stockOf(KODE);
  r = await req('POST', '/api/transactions', {
    jenis: 'KELUAR', divisi: 'DIVISI FO', tujuan_id: foId, kode_barang: KODE, jumlah: 1, serial_number: 'SN-UJI-001'
  });
  let foRows = db.prepare('SELECT * FROM fo_items WHERE fo_id = ? AND kode_barang = ?').all(foId, KODE);
  if (foId && r.status === 201 && foRows.length === 1 && Number(foRows[0].jumlah) === 1 && foRows[0].serial_number === 'SN-UJI-001' && stockOf(KODE) === stokSebelumFo - 1) {
    ok('Scan → pasang ke site FO: tercatat di fo_items (+ SN) & stok berkurang');
  } else {
    bad('Scan → pasang ke site FO', `status=${r.status} rows=${foRows.length}`);
  }

  const stokSebelumFo2 = stockOf(KODE);
  r = await req('POST', '/api/transactions', {
    jenis: 'KELUAR', divisi: 'DIVISI FO', tujuan_id: foId, kode_barang: KODE, jumlah: 1, serial_number: 'SN-UJI-001'
  });
  foRows = db.prepare('SELECT * FROM fo_items WHERE fo_id = ? AND kode_barang = ?').all(foId, KODE);
  if (r.status === 201 && foRows.length === 1 && Number(foRows[0].jumlah) === 2 && stockOf(KODE) === stokSebelumFo2 - 1) {
    ok('Pasang kode sama ke site sama: baris digabung (qty +1), tidak dobel');
  } else {
    bad('Baris terpasang digabung', `rows=${foRows.length} qty=${foRows[0]?.jumlah}`);
  }

  const foAfter = db.prepare('SELECT total_harga FROM fo_sites WHERE id = ?').get(foId)?.total_harga;
  const foSum = db.prepare('SELECT COALESCE(SUM(subtotal), 0) AS s FROM fo_items WHERE fo_id = ?').get(foId).s;
  if (Math.abs(Number(foAfter) - Number(foSum)) < 0.01) ok('Nilai aset site FO sinkron');
  else bad('Nilai aset site FO sinkron', `total=${foAfter} vs sum=${foSum}`);

  // 7. Site Tower tertaut: pengembalian menghapus baris saat jumlah habis
  const twRes = await req('POST', '/api/tower', { daerah_lokasi: 'UJI-LINK-TWR', items: [] });
  const twId = twRes.json?.data?.id;
  await req('POST', '/api/transactions', { jenis: 'KELUAR', divisi: 'DIVISI TOWER', tujuan_id: twId, kode_barang: KODE, jumlah: 1 });
  const stokSebelumTwr = stockOf(KODE);
  r = await req('POST', '/api/transactions', { jenis: 'MASUK', divisi: 'DIVISI TOWER', tujuan_id: twId, kode_barang: KODE, jumlah: 1 });
  const twRows = db.prepare('SELECT * FROM tower_items WHERE tower_id = ? AND kode_barang = ?').all(twId, KODE);
  if (twId && r.status === 201 && twRows.length === 0 && stockOf(KODE) === stokSebelumTwr + 1) {
    ok('Tower: pengembalian penuh menghapus baris & stok kembali utuh');
  } else {
    bad('Tower: pengembalian penuh', `status=${r.status} rows=${twRows.length}`);
  }

  // 8. Mode manual GUDANG (tanpa tautan) tetap berfungsi seperti semula
  const stokSebelumManual = stockOf(KODE);
  r = await req('POST', '/api/transactions', {
    jenis: 'MASUK', divisi: 'GUDANG', kategori_transaksi: 'Pembelian Supplier',
    lokasi_penerima: 'PT Supplier Uji', kode_barang: KODE, jumlah: 3
  });
  if (r.status === 201 && stockOf(KODE) === stokSebelumManual + 3) {
    ok('Mode manual GUDANG (tanpa tautan) tetap berfungsi');
  } else {
    bad('Mode manual GUDANG tetap berfungsi', `status=${r.status}`);
  }

  // Mode manual tanpa lokasi/suplayer tetap wajib ditolak
  r = await req('POST', '/api/transactions', { jenis: 'MASUK', divisi: 'GUDANG', kode_barang: KODE, jumlah: 1 });
  if (r.status === 400) ok('Mode manual tanpa lokasi/suplayer ditolak (400)');
  else bad('Mode manual tanpa lokasi ditolak', `status=${r.status}`);
}

console.log('\n=== 6D. KEUNIKAN NOMOR TRANSAKSI & IMPORT MASSAL ===');
{
  // 1. Import massal 200 barang baru dengan stok > 0 dalam satu bulan:
  //    Dulu rawan gagal ~89% ("UNIQUE constraint failed: transactions.no_transaksi")
  //    karena generateTrxNumber memakai acak 4 digit (1000–9999) tanpa cek unik
  //    (akar masalah yang sama dengan flake DELETE /api/tower/:id).
  const JUMLAH_IMPORT = 200;
  const rows = Array.from({ length: JUMLAH_IMPORT }, (_, i) => ({
    kode_barang: `BRG-UJI-IMP-${String(i + 1).padStart(4, '0')}`,
    nama_barang: `Barang Uji Import #${i + 1}`,
    satuan: 'unit',
    jenis_barang: 'Kabel Jaringan',
    stok: 5,
    min_stok: 2,
    harga_barang: 50000,
    referensi_suplayer: 'PT. Uji Import Massal'
  }));
  const markSebelumImport = maxTrxId();
  const imp = await req('POST', '/api/items/import', { rows, mode: 'skip' });
  const trxImport = trxSince(markSebelumImport);
  const unikNoTrx = new Set(trxImport.map((t) => t.no_transaksi)).size;
  if (imp.status === 200 && imp.json?.data?.inserted === JUMLAH_IMPORT && imp.json?.data?.failed === 0
      && trxImport.length === JUMLAH_IMPORT && unikNoTrx === JUMLAH_IMPORT) {
    ok(`Import massal ${JUMLAH_IMPORT} barang + stok awal bebas bentrok no_transaksi`, `${unikNoTrx} no_transaksi unik`);
  } else {
    bad('Import massal bebas bentrok no_transaksi', `status=${imp.status} body=${JSON.stringify(imp.json)?.slice(0, 180)} trx=${trxImport.length} unik=${unikNoTrx}`);
  }

  // 2. Transaksi bertanggal mundur: prefix YYYYMM pada no_transaksi wajib mengikuti tanggal transaksi
  const rBackdate = await req('POST', '/api/transactions', {
    jenis: 'MASUK', divisi: 'GUDANG', kategori_transaksi: 'Pembelian Supplier',
    lokasi_penerima: 'PT Uji Tanggal Mundur', kode_barang: KODE, jumlah: 1, tanggal: '2026-01-15'
  });
  const trxNoMundur = rBackdate.json?.data?.trxNo || '';
  if (rBackdate.status === 201 && /^TRX-IN-202601-\d+$/.test(trxNoMundur)) {
    ok('Prefix YYYYMM no_transaksi mengikuti tanggal transaksi (termasuk tanggal mundur)', trxNoMundur);
  } else {
    bad('Prefix YYYYMM no_transaksi mengikuti tanggal transaksi', `status=${rBackdate.status} trxNo=${trxNoMundur}`);
  }

  // 3. Invariant stok vs log transaksi tetap terjaga setelah 6C & 6D
  checkInvariant('setelah scan tertaut & import massal', GLOBAL_SNAP, GLOBAL_MARK);
}

console.log('\n=== 6E. LAPORAN STOK GUDANG LOGISTIK (STOK TERSEDIA & BARANG STOK MENIPIS) ===');
{
  // 1. Laporan Stok Gudang Keseluruhan yang Tersedia (filter=tersedia)
  const rTersedia = await req('GET', '/api/reports/warehouse-stock?filter=tersedia');
  const dTersedia = rTersedia.json?.data || [];
  const sumTersedia = rTersedia.json?.summary;
  if (
    rTersedia.status === 200 &&
    rTersedia.json?.success &&
    dTersedia.length > 0 &&
    dTersedia.every((it) => Number(it.stok) > 0) &&
    sumTersedia?.sku_tersedia === dTersedia.length &&
    Array.isArray(rTersedia.json?.categories)
  ) {
    ok('Laporan Stok Gudang Keseluruhan yang Tersedia mengembalikan seluruh barang berstok > 0', `${dTersedia.length} SKU tersedia`);
  } else {
    bad('Laporan Stok Gudang Keseluruhan yang Tersedia', `status=${rTersedia.status} len=${dTersedia.length}`);
  }

  // 2. Buat 1 barang uji dengan stok menipis (stok 2 <= min_stok 10), verifikasi muncul di filter=menipis
  const kodeMenipis = 'BRG-UJI-MENIPIS-01';
  const createLow = await req('POST', '/api/items', {
    kode_barang: kodeMenipis,
    nama_barang: 'Patchcord Uji Stok Menipis',
    satuan: 'pcs',
    jenis_barang: 'Aksesoris & Pasif FO',
    stok: 2,
    min_stok: 10,
    harga_barang: 15000,
    referensi_suplayer: 'PT. Uji Logistik'
  });

  const rMenipis = await req('GET', '/api/reports/warehouse-stock?filter=menipis');
  const dMenipis = rMenipis.json?.data || [];
  const itemMenipis = dMenipis.find((it) => it.kode_barang === kodeMenipis);
  if (
    createLow.status === 201 &&
    rMenipis.status === 200 &&
    itemMenipis &&
    itemMenipis.status_stok === 'MENIPIS' &&
    itemMenipis.kekurangan_stok === 8 &&
    dMenipis.every((it) => Number(it.stok) <= Number(it.min_stok))
  ) {
    ok('Laporan Barang Stok Menipis mengembalikan barang dengan stok <= min_stok beserta status & kekurangan', `${dMenipis.length} SKU menipis`);
  } else {
    bad('Laporan Barang Stok Menipis', `status=${rMenipis.status} found=${Boolean(itemMenipis)}`);
  }

  // 3. Filter pencarian & kategori pada laporan stok gudang + dukungan divisi=STOK_MENIPIS di installed-assets
  const rSearch = await req('GET', `/api/reports/warehouse-stock?filter=menipis&search=${encodeURIComponent(kodeMenipis)}&kategori=${encodeURIComponent('Aksesoris & Pasif FO')}`);
  const rSebaranMenipis = await req('GET', '/api/reports/installed-assets?divisi=STOK_MENIPIS');
  if (
    rSearch.status === 200 &&
    rSearch.json?.data?.length === 1 &&
    rSearch.json.data[0].kode_barang === kodeMenipis &&
    rSebaranMenipis.status === 200 &&
    (rSebaranMenipis.json?.data || []).some((it) => it.kode_barang === kodeMenipis)
  ) {
    ok('Filter pencarian/kategori stok gudang & filter STOK_MENIPIS pada sebaran berfungsi akurat');
  } else {
    bad('Filter pencarian/kategori stok gudang', `searchLen=${rSearch.json?.data?.length}`);
  }
}

console.log('\n=== 6F. BON / BARANG BAWAAN TEKNISI (3 tahap: bawa → pasang → kembali) ===');
{
  const ONT = 'BRG-ONT-HG8546M';        // stok seed 45
  const PATCH = 'BRG-FO-PATCH-SC-3M';   // stok seed 180
  const SLING = 'BRG-TWR-SLING-4MM';    // stok seed 650 (meter)
  const sOnt0 = stockOf(ONT), sPatch0 = stockOf(PATCH), sSling0 = stockOf(SLING);
  const markBon = maxTrxId();

  const loginRole = async (username, password) => {
    const lr = await req('POST', '/api/auth/login', { username, password }, { noAuth: true });
    return lr.json?.data?.token;
  };
  const reqAs = async (token, method, url, body) => {
    const res = await fetch(API + url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { /* null */ }
    return { status: res.status, json };
  };

  const cust = (await req('GET', '/api/customers')).json?.data?.[0];
  const fo = (await req('GET', '/api/fo')).json?.data?.[0];
  const twr = (await req('GET', '/api/tower')).json?.data?.[0];

  // --- Tahap 1: validasi penolakan ---
  let rb = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'Budi Santoso', items: [{ kode_barang: ONT, jumlah: 9999 }] });
  if (rb.status === 400 && /Stok gudang tidak mencukupi/.test(rb.json?.error || '') && stockOf(ONT) === sOnt0) ok('Bon: bawa melebihi stok gudang ditolak & stok utuh');
  else bad('Bon: bawa melebihi stok gudang ditolak', `HTTP ${rb.status} ${rb.json?.error}`);

  rb = await req('POST', '/api/technician-loans', { items: [{ kode_barang: ONT, jumlah: 1 }] });
  if (rb.status === 400 && /teknisi/i.test(rb.json?.error || '')) ok('Bon: nama teknisi wajib diisi');
  else bad('Bon: nama teknisi wajib diisi', `HTTP ${rb.status}`);

  rb = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'Budi Santoso', items: [{ kode_barang: 'KODE-NGAWUR', jumlah: 1 }] });
  if (rb.status === 400) ok('Bon: kode barang tak terdaftar ditolak'); else bad('Bon: kode barang tak terdaftar ditolak', `HTTP ${rb.status}`);

  rb = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'Budi Santoso', items: [{ kode_barang: ONT, jumlah: -3 }, { kode_barang: PATCH, jumlah: 0 }] });
  if (rb.status === 400) ok('Bon: jumlah negatif / tanpa barang ditolak'); else bad('Bon: jumlah negatif / tanpa barang ditolak', `HTTP ${rb.status}`);
  if (db.prepare('SELECT COUNT(*) AS c FROM technician_loans').get().c === 0) ok('Bon: penolakan tidak meninggalkan bon setengah jadi');
  else bad('Bon: penolakan tidak meninggalkan bon setengah jadi');

  // --- Tahap 1: bon sah (ONT 5 + PATCH 20 + SLING 100 m); kode ONT dobel digabung ---
  rb = await req('POST', '/api/technician-loans', {
    divisi: 'DIVISI FO', teknisi_nama: 'Budi Santoso', keperluan: 'Instalasi baru Solok Selatan', no_bon: 'bon-uji-001',
    items: [{ kode_barang: ONT, jumlah: 3 }, { kode_barang: PATCH, jumlah: 20 }, { kode_barang: SLING, jumlah: 100 }, { kode_barang: ONT.toLowerCase(), jumlah: 2 }]
  });
  const bon = rb.json?.data;
  if (rb.status === 201 && bon?.no_bon === 'BON-UJI-001' && bon.status === 'AKTIF' && bon.items.length === 3) ok('Bon: dibuat dengan No. Bon, teknisi, & barang digabung per kode', bon?.no_bon);
  else bad('Bon: dibuat dengan No. Bon, teknisi, & barang digabung per kode', `HTTP ${rb.status} ${rb.json?.error}`);
  const liOnt = bon?.items.find((i) => i.kode_barang === ONT);
  const liPatch = bon?.items.find((i) => i.kode_barang === PATCH);
  const liSling = bon?.items.find((i) => i.kode_barang === SLING);
  if (liOnt?.jumlah_dibawa === 5) ok('Bon: kode ONT dobel digabung jadi 5'); else bad('Bon: kode ONT dobel digabung jadi 5', `${liOnt?.jumlah_dibawa}`);

  if (stockOf(ONT) === sOnt0 - 5 && stockOf(PATCH) === sPatch0 - 20 && stockOf(SLING) === sSling0 - 100) ok('Tahap 1: stok gudang berkurang sebesar yang dibawa teknisi');
  else bad('Tahap 1: stok gudang berkurang', `ONT ${stockOf(ONT)}/${sOnt0 - 5} PATCH ${stockOf(PATCH)}/${sPatch0 - 20}`);
  const trx1 = trxSince(markBon);
  if (trx1.length === 3 && trx1.every((t) => t.jenis === 'KELUAR' && t.divisi === 'TEKNISI' && t.kategori_transaksi === 'Bon Teknisi (Dibawa)' && t.ref_id === bon.id)) ok('Tahap 1: 3 mutasi KELUAR (divisi TEKNISI) tercatat di riwayat transaksi');
  else bad('Tahap 1: mutasi KELUAR tercatat', `${trx1.length} baris`);
  const lstItems = (await req('GET', '/api/items')).json?.data || [];
  if (lstItems.find((i) => i.kode_barang === ONT)?.stok_transit === 5 && lstItems.find((i) => i.kode_barang === SLING)?.stok_transit === 100) ok('Master barang menampilkan stok_transit (dibawa teknisi)');
  else bad('Master barang menampilkan stok_transit');

  rb = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'X', no_bon: 'BON-UJI-001', items: [{ kode_barang: PATCH, jumlah: 1 }] });
  if (rb.status === 400 && /sudah digunakan/.test(rb.json?.error || '')) ok('Bon: No. Bon dobel ditolak'); else bad('Bon: No. Bon dobel ditolak', `HTTP ${rb.status}`);

  const auto = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'Rina Wulandari', items: [{ kode_barang: PATCH, jumlah: 1 }] });
  if (auto.status === 201 && /^BON-\d{6}-0001$/.test(auto.json?.data?.no_bon || '')) ok('Bon: No. Bon otomatis BON-YYYYMM-NNNN', auto.json.data.no_bon);
  else bad('Bon: No. Bon otomatis', `${auto.status} ${auto.json?.data?.no_bon}`);

  // --- Hak akses ---
  const tTek = await loginRole('teknisi', 'teknisi123');
  const tView = await loginRole('viewer', 'viewer123');
  let ra = await reqAs(tView, 'POST', '/api/technician-loans', { teknisi_nama: 'X', items: [{ kode_barang: PATCH, jumlah: 1 }] });
  const raView = await reqAs(tView, 'GET', '/api/technician-loans');
  if (ra.status === 403 && raView.status === 200) ok('Hak akses: viewer boleh melihat bon, tidak boleh membuat'); else bad('Hak akses viewer', `${ra.status}/${raView.status}`);
  ra = await reqAs(tTek, 'POST', '/api/technician-loans', { teknisi_nama: 'X', items: [{ kode_barang: PATCH, jumlah: 1 }] });
  const rb2 = await reqAs(tTek, 'POST', `/api/technician-loans/${bon.id}/return`, { semua_sisa: true });
  if (ra.status === 403 && rb2.status === 403) ok('Hak akses: teknisi tidak boleh membuat bon / pengembalian'); else bad('Hak akses teknisi', `${ra.status}/${rb2.status}`);

  // --- Tahap 2: realisasi pemasangan ---
  const sOntSebelumPasang = stockOf(ONT);
  const mark2 = maxTrxId();
  let ri = await req('POST', `/api/technician-loans/${bon.id}/install`, {
    divisi: 'PELANGGAN', tujuan_id: cust.id, teknisi_pemasang: 'Andi Pratama',
    items: [{ loan_item_id: liOnt.id, jumlah: 99 }]
  });
  if (ri.status === 400 && /melebihi sisa/.test(ri.json?.error || '')) ok('Realisasi: melebihi sisa bon ditolak'); else bad('Realisasi: melebihi sisa bon ditolak', `HTTP ${ri.status} ${ri.json?.error}`);

  ri = await req('POST', `/api/technician-loans/${bon.id}/install`, { divisi: 'PELANGGAN', tujuan_id: cust.id, items: [{ loan_item_id: liOnt.id, jumlah: 2, serial_number: 'SN-UJI-AA' }] });
  if (ri.status === 400 && /1 unit per baris/.test(ri.json?.error || '')) ok('Realisasi: SN hanya untuk 1 unit per baris'); else bad('Realisasi: SN 1 unit per baris', `HTTP ${ri.status} ${ri.json?.error}`);

  ri = await req('POST', `/api/technician-loans/${bon.id}/install`, { divisi: 'GUDANG', tujuan_id: cust.id, items: [{ loan_item_id: liOnt.id, jumlah: 1 }] });
  const ri2 = await req('POST', `/api/technician-loans/${bon.id}/install`, { divisi: 'PELANGGAN', tujuan_id: 999999, items: [{ loan_item_id: liOnt.id, jumlah: 1 }] });
  if (ri.status === 400 && ri2.status === 400) ok('Realisasi: divisi tidak valid / tujuan tak ditemukan ditolak'); else bad('Realisasi: divisi/tujuan tidak valid', `${ri.status}/${ri2.status}`);

  const custTotalSebelum = (await req('GET', `/api/customers/${cust.id}`)).json?.data?.total_harga || 0;
  ri = await req('POST', `/api/technician-loans/${bon.id}/install`, {
    divisi: 'PELANGGAN', tujuan_id: cust.id, teknisi_pemasang: 'Andi Pratama', lokasi_tujuan: 'Rumah pelanggan, Jl. Contoh No. 5',
    items: [{ loan_item_id: liOnt.id, jumlah: 1, serial_number: 'SN-UJI-AA' }, { loan_item_id: liPatch.id, jumlah: 2 }]
  });
  const afterPasang = ri.json?.data;
  if (ri.status === 201 && afterPasang?.status === 'SEBAGIAN') ok('Tahap 2: realisasi ke Pelanggan tersimpan, status bon SEBAGIAN'); else bad('Tahap 2: realisasi ke Pelanggan', `HTTP ${ri.status} ${ri.json?.error}`);
  if (stockOf(ONT) === sOntSebelumPasang && trxSince(mark2).length === 0) ok('Tahap 2: stok gudang & riwayat transaksi gudang TIDAK berubah (barang sudah keluar di tahap 1)');
  else bad('Tahap 2: stok gudang tidak berubah', `stok=${stockOf(ONT)} trx=${trxSince(mark2).length}`);
  const ciRow = db.prepare('SELECT * FROM customer_items WHERE customer_id = ? AND serial_number = ?').get(cust.id, 'SN-UJI-AA');
  if (ciRow && ciRow.kode_barang === ONT && ciRow.dipasang_oleh === 'Andi Pratama' && ciRow.no_bon === 'BON-UJI-001') ok('Tahap 2: barang tercatat terpasang di pelanggan lengkap SN, teknisi pemasang & No. Bon');
  else bad('Tahap 2: barang terpasang di pelanggan', JSON.stringify(ciRow));
  const custTotalSesudah = (await req('GET', `/api/customers/${cust.id}`)).json?.data?.total_harga || 0;
  const nilaiPasang = 1 * liOnt.harga_barang + 2 * liPatch.harga_barang;
  if (Math.abs(custTotalSesudah - custTotalSebelum - nilaiPasang) < 0.01) ok('Tahap 2: total nilai aset pelanggan tersinkron'); else bad('Tahap 2: total nilai aset pelanggan', `${custTotalSebelum} → ${custTotalSesudah} (+${nilaiPasang})`);
  const mvPasang = afterPasang?.movements.filter((m) => m.jenis === 'PASANG') || [];
  if (mvPasang.length === 2 && mvPasang.every((m) => m.teknisi_nama === 'Andi Pratama' && m.divisi === 'PELANGGAN' && m.lokasi_tujuan === 'Rumah pelanggan, Jl. Contoh No. 5') && mvPasang.some((m) => m.serial_number === 'SN-UJI-AA')) ok('Tahap 2: riwayat mutasi bon memuat teknisi pemasang, SN & lokasi tujuan');
  else bad('Tahap 2: riwayat mutasi bon', JSON.stringify(mvPasang).slice(0, 200));

  ri = await req('POST', `/api/technician-loans/${bon.id}/install`, { divisi: 'DIVISI FO', tujuan_id: fo.id, items: [{ loan_item_id: liOnt.id, jumlah: 1, serial_number: 'sn-uji-aa' }] });
  if (ri.status === 400 && /sudah tercatat terpasang/.test(ri.json?.error || '')) ok('Realisasi: SN yang sudah terpasang ditolak (tanpa peduli huruf besar/kecil)'); else bad('Realisasi: SN dobel', `HTTP ${ri.status} ${ri.json?.error}`);

  // teknisi lapangan boleh mencatat realisasi sendiri: ke FO (patch) & Tower (sling)
  ri = await reqAs(tTek, 'POST', `/api/technician-loans/${bon.id}/install`, { divisi: 'DIVISI FO', tujuan_id: fo.id, items: [{ loan_item_id: liPatch.id, jumlah: 5 }] });
  const ri3 = await reqAs(tTek, 'POST', `/api/technician-loans/${bon.id}/install`, { divisi: 'DIVISI TOWER', tujuan_id: twr.id, teknisi_pemasang: 'Tim Tower', items: [{ kode_barang: SLING, jumlah: 40.5 }] });
  if (ri.status === 201 && ri3.status === 201) ok('Tahap 2: teknisi mencatat realisasi ke Divisi FO & Divisi Tower (jumlah desimal)'); else bad('Tahap 2: realisasi FO/Tower oleh teknisi', `${ri.status}/${ri3.status} ${ri.json?.error || ri3.json?.error}`);
  const foRow = db.prepare('SELECT * FROM fo_items WHERE fo_id = ? AND kode_barang = ? AND no_bon = ?').get(fo.id, PATCH, 'BON-UJI-001');
  const twRow = db.prepare('SELECT * FROM tower_items WHERE tower_id = ? AND kode_barang = ? AND no_bon = ?').get(twr.id, SLING, 'BON-UJI-001');
  if (foRow?.jumlah === 5 && twRow?.jumlah === 40.5 && twRow.dipasang_oleh === 'Tim Tower') ok('Tahap 2: baris terpasang FO & Tower mencatat bon + teknisi pemasang'); else bad('Tahap 2: baris terpasang FO/Tower', JSON.stringify([foRow, twRow]));

  // PUT pelanggan tidak menghapus jejak teknisi pemasang
  {
    const cur = (await req('GET', `/api/customers/${cust.id}`)).json?.data;
    const put = await req('PUT', `/api/customers/${cust.id}`, { items: cur.items.map((i) => ({ kode_barang: i.kode_barang, jumlah: i.jumlah, serial_number: i.serial_number })) });
    const masih = db.prepare('SELECT * FROM customer_items WHERE customer_id = ? AND serial_number = ?').get(cust.id, 'SN-UJI-AA');
    if (put.status === 200 && masih?.dipasang_oleh === 'Andi Pratama' && masih?.no_bon === 'BON-UJI-001') ok('Edit pelanggan mempertahankan jejak teknisi pemasang & No. Bon'); else bad('Edit pelanggan mempertahankan jejak', `HTTP ${put.status} ${JSON.stringify(masih)}`);
  }

  // Hapus barang master yang masih dibawa teknisi ditolak
  {
    const idSling = lstItems.find((i) => i.kode_barang === SLING).id;
    const del = await req('DELETE', `/api/items/${idSling}`);
    if (del.status === 400) ok('Barang yang masih dibawa teknisi tidak bisa dihapus dari master'); else bad('Hapus barang yang masih dibawa teknisi', `HTTP ${del.status}`);
  }

  // Scanner: aset yang dibawa teknisi tetap terhitung
  {
    const sc = await req('GET', `/api/scanner/lookup/${ONT}`);
    const d = sc.json?.data?.distribution;
    if (sc.status === 200 && d?.transit_teknisi === 4 && d.total_keseluruhan === d.gudang_stock + d.total_installed + 4) ok('Scanner: stok dibawa teknisi ikut dihitung dalam total aset'); else bad('Scanner: stok dibawa teknisi', JSON.stringify(d));
  }

  // --- Tahap 3: pengembalian sisa ---
  // sisa: ONT 5-1=4, PATCH 20-2-5=13, SLING 100-40.5=59.5
  const sBefore = { ont: stockOf(ONT), patch: stockOf(PATCH), sling: stockOf(SLING) };
  const mark3 = maxTrxId();
  let rr = await req('POST', `/api/technician-loans/${bon.id}/return`, { items: [{ loan_item_id: liOnt.id, jumlah: 5 }] });
  if (rr.status === 400 && /melebihi sisa/.test(rr.json?.error || '') && stockOf(ONT) === sBefore.ont) ok('Pengembalian: melebihi sisa ditolak & stok utuh'); else bad('Pengembalian: melebihi sisa ditolak', `HTTP ${rr.status}`);

  rr = await req('POST', `/api/technician-loans/${bon.id}/return`, { items: [{ loan_item_id: liOnt.id, jumlah: 3 }, { loan_item_id: liSling.id, jumlah: 19.5 }], keterangan: 'Sisa dikembalikan sore' });
  if (rr.status === 201 && rr.json?.data?.status === 'SEBAGIAN' && stockOf(ONT) === sBefore.ont + 3 && stockOf(SLING) === sBefore.sling + 19.5) ok('Tahap 3: pengembalian sebagian menambah stok gudang, bon tetap SEBAGIAN'); else bad('Tahap 3: pengembalian sebagian', `HTTP ${rr.status} ${rr.json?.error}`);
  const trx3 = trxSince(mark3);
  if (trx3.length === 2 && trx3.every((t) => t.jenis === 'MASUK' && t.divisi === 'TEKNISI' && t.kategori_transaksi === 'Pengembalian Bon Teknisi')) ok('Tahap 3: mutasi MASUK pengembalian tercatat'); else bad('Tahap 3: mutasi MASUK tercatat', `${trx3.length}`);

  rr = await req('POST', `/api/technician-loans/${bon.id}/return`, { semua_sisa: true });
  const selesai = rr.json?.data;
  if (rr.status === 201 && selesai?.status === 'SELESAI' && selesai.summary.total_sisa === 0 && stockOf(ONT) === sBefore.ont + 4 && stockOf(PATCH) === sBefore.patch + 13 && stockOf(SLING) === sBefore.sling + 59.5) ok('Tahap 3: "kembalikan semua sisa" → bon SELESAI, stok gudang tepat'); else bad('Tahap 3: kembalikan semua sisa', `HTTP ${rr.status} ${rr.json?.error} status=${selesai?.status}`);
  rr = await req('POST', `/api/technician-loans/${bon.id}/return`, { semua_sisa: true });
  if (rr.status === 400) ok('Bon SELESAI tidak bisa direalisasikan lagi'); else bad('Bon SELESAI tidak bisa direalisasikan lagi', `HTTP ${rr.status}`);
  // keseimbangan: dibawa = terpasang + kembali
  if (selesai?.items.every((i) => Math.abs(i.jumlah_dibawa - i.jumlah_terpasang - i.jumlah_kembali) < 1e-9)) ok('Keseimbangan bon: dibawa = terpasang + kembali untuk semua barang'); else bad('Keseimbangan bon');
  const mvTypes = selesai?.movements.map((m) => m.jenis) || [];
  if (['BAWA', 'PASANG', 'KEMBALI'].every((j) => mvTypes.includes(j))) ok('Riwayat mutasi bon memuat BAWA, PASANG, dan KEMBALI', `${mvTypes.length} entri`); else bad('Riwayat mutasi bon', mvTypes.join(','));

  // --- Pembatalan bon ---
  {
    const sP = stockOf(PATCH);
    const c = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'Rina Wulandari', items: [{ kode_barang: PATCH, jumlah: 10 }] });
    const cb = await req('POST', `/api/technician-loans/${c.json.data.id}/cancel`, { alasan: 'Tidak jadi berangkat' });
    if (cb.status === 200 && cb.json.data.status === 'BATAL' && stockOf(PATCH) === sP) ok('Pembatalan bon (belum dipasang) mengembalikan seluruh barang ke gudang'); else bad('Pembatalan bon', `HTTP ${cb.status} ${cb.json?.error} stok=${stockOf(PATCH)}/${sP}`);

    const d = await req('POST', '/api/technician-loans', { divisi: 'DIVISI FO', teknisi_nama: 'Rina Wulandari', items: [{ kode_barang: PATCH, jumlah: 4 }] });
    await req('POST', `/api/technician-loans/${d.json.data.id}/install`, { divisi: 'DIVISI FO', tujuan_id: fo.id, items: [{ kode_barang: PATCH, jumlah: 1 }] });
    const cb2 = await req('POST', `/api/technician-loans/${d.json.data.id}/cancel`, {});
    if (cb2.status === 400 && /sudah ada realisasi/.test(cb2.json?.error || '')) ok('Pembatalan bon yang sudah ada realisasi pemasangan ditolak'); else bad('Pembatalan bon dengan realisasi', `HTTP ${cb2.status}`);
    await req('POST', `/api/technician-loans/${d.json.data.id}/return`, { semua_sisa: true });
  }

  // --- Laporan, daftar, dan riwayat ---
  {
    const rep = await req('GET', '/api/technician-loans/report');
    const dr = rep.json?.data;
    const bonRow = dr?.loans.find((l) => l.id === bon.id);
    const perTek = dr?.per_teknisi.find((t) => t.teknisi_nama === 'Budi Santoso');
    const nilaiDibawa = 5 * liOnt.harga_barang + 20 * liPatch.harga_barang + 100 * liSling.harga_barang;
    if (rep.status === 200 && Math.abs(bonRow?.nilai_dibawa - nilaiDibawa) < 0.01 && perTek?.jumlah_bon === 1 && dr.per_divisi.length === 3 && dr.per_barang.length >= 3 && dr.summary.total_bon >= 3) ok('Laporan bon: ringkasan, per teknisi, per barang & per divisi tujuan akurat', `${dr.summary.total_bon} bon`);
    else bad('Laporan bon', `HTTP ${rep.status} ${JSON.stringify(dr?.summary)}`);
    const pem = dr?.per_pemasang.map((p) => p.teknisi_nama) || [];
    if (pem.includes('Andi Pratama') && pem.includes('Tim Tower')) ok('Laporan bon: rekap per teknisi pemasang'); else bad('Laporan bon: rekap per pemasang', pem.join(','));

    const f = await req('GET', '/api/technician-loans/report?status=SELESAI&teknisi=budi%20santoso');
    if (f.json?.data?.loans.length === 1 && f.json.data.loans[0].id === bon.id) ok('Laporan bon: filter status & teknisi (tidak peka huruf besar/kecil)'); else bad('Laporan bon: filter', `${f.json?.data?.loans?.length}`);

    const mv = await req('GET', `/api/technician-loans/movements?search=${encodeURIComponent('SN-UJI-AA')}`);
    if (mv.status === 200 && mv.json.data.length === 1 && mv.json.data[0].no_bon === 'BON-UJI-001') ok('Riwayat mutasi lintas bon bisa dicari lewat SN'); else bad('Riwayat mutasi lintas bon', `${mv.json?.data?.length}`);

    const stk = await req('GET', '/api/technician-loans/stock');
    if (stk.status === 200 && stk.json.data.rows.every((r) => r.jumlah_sisa > 0) && !stk.json.data.rows.some((r) => r.loan_id === bon.id)) ok('Stok sedang dibawa teknisi tidak memuat bon yang sudah selesai'); else bad('Stok sedang dibawa teknisi');

    const dash = await req('GET', '/api/reports/dashboard-summary');
    if (dash.json?.data?.teknisi && typeof dash.json.data.teknisi.nilai_transit === 'number') ok('Dashboard memuat ringkasan stok dibawa teknisi'); else bad('Dashboard memuat ringkasan teknisi');
  }

  // --- Invarian & reset ---
  await req('POST', `/api/technician-loans/${auto.json.data.id}/return`, { semua_sisa: true }); // tuntaskan bon otomatis tadi
  checkInvariant('setelah bon teknisi (bawa, pasang, kembali, batal)', GLOBAL_SNAP, GLOBAL_MARK);
  checkNoNegativeStock('setelah bon teknisi');
  {
    const aktif = db.prepare("SELECT COUNT(*) AS c FROM technician_loans WHERE status IN ('AKTIF','SEBAGIAN')").get().c;
    if (aktif === 0) ok('Seluruh bon uji tuntas (tidak ada sisa tertahan di teknisi)'); else bad('Seluruh bon uji tuntas', `${aktif} bon masih aktif`);
  }
  // Reset data contoh ikut membersihkan bon
  const rs = await req('POST', '/api/reset-seed');
  const sisaBon = db.prepare('SELECT COUNT(*) AS c FROM technician_loans').get().c;
  const sisaMv = db.prepare('SELECT COUNT(*) AS c FROM technician_loan_movements').get().c;
  if (rs.status === 200 && sisaBon === 0 && sisaMv === 0) ok('Reset data contoh membersihkan bon & riwayat mutasinya'); else bad('Reset data contoh membersihkan bon', `HTTP ${rs.status} bon=${sisaBon} mutasi=${sisaMv}`);
}

console.log('\n=== 6G. DATA TEKNISI & DIVISI PADA BON (pilih divisi → nama teknisi) ===');
{
  const PATCH = 'BRG-FO-PATCH-SC-3M';
  const loginRole = async (username, password) => (await req('POST', '/api/auth/login', { username, password }, { noAuth: true })).json?.data?.token;
  const reqAs = async (token, method, url, body) => {
    const res = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* null */ }
    return { status: res.status, json };
  };
  const tTek = await loginRole('teknisi', 'teknisi123');
  const tView = await loginRole('viewer', 'viewer123');

  // --- CRUD Data Teknisi ---
  let r = await req('POST', '/api/teknisi', { nama: '  Andi   Uji  ', divisi: 'divisi fo', no_hp: '0812-0000' });
  const andi = r.json?.data;
  if (r.status === 201 && andi?.nama === 'Andi Uji' && andi.divisi === 'DIVISI FO' && andi.status === 'aktif') ok('Teknisi: tambah (spasi dirapikan, divisi dinormalkan, default aktif)');
  else bad('Teknisi: tambah', `HTTP ${r.status} ${r.json?.error}`);
  r = await req('POST', '/api/teknisi', { nama: 'ANDI UJI', divisi: 'DIVISI TOWER' });
  if (r.status === 400 && /sudah ada/.test(r.json?.error || '')) ok('Teknisi: nama dobel ditolak (tidak peka huruf besar/kecil)'); else bad('Teknisi: nama dobel', `HTTP ${r.status}`);
  r = await req('POST', '/api/teknisi', { nama: 'Tanpa Divisi', divisi: 'GUDANG' });
  if (r.status === 400 && /Divisi harus/.test(r.json?.error || '')) ok('Teknisi: divisi di luar Pelanggan/FO/Tower ditolak'); else bad('Teknisi: divisi tidak valid', `HTTP ${r.status}`);
  r = await req('POST', '/api/teknisi', { nama: '   ', divisi: 'DIVISI FO' });
  if (r.status === 400) ok('Teknisi: nama kosong ditolak'); else bad('Teknisi: nama kosong', `HTTP ${r.status}`);
  const tower = (await req('POST', '/api/teknisi', { nama: 'Tono Uji', divisi: 'DIVISI TOWER' })).json?.data;
  const plg = (await req('POST', '/api/teknisi', { nama: 'Pelan Uji', divisi: 'PELANGGAN' })).json?.data;

  const lf = await req('GET', '/api/teknisi?divisi=DIVISI%20TOWER');
  if (lf.status === 200 && lf.json.data.some((t) => t.id === tower.id) && lf.json.data.every((t) => t.divisi === 'DIVISI TOWER')) ok('Teknisi: daftar bisa difilter per divisi'); else bad('Teknisi: filter divisi');

  r = await reqAs(tTek, 'POST', '/api/teknisi', { nama: 'Ilegal', divisi: 'DIVISI FO' });
  const r2 = await reqAs(tView, 'DELETE', `/api/teknisi/${andi.id}`);
  const rg = await reqAs(tView, 'GET', '/api/teknisi');
  if (r.status === 403 && r2.status === 403 && rg.status === 200) ok('Teknisi: hanya admin/staff gudang yang boleh mengubah; viewer boleh melihat'); else bad('Teknisi: hak akses', `${r.status}/${r2.status}/${rg.status}`);

  // --- Bon wajib divisi; teknisi dari Data Teknisi ---
  r = await req('POST', '/api/technician-loans', { teknisi_nama: 'Tanpa Divisi', items: [{ kode_barang: PATCH, jumlah: 1 }] });
  if (r.status === 400 && /Divisi wajib/.test(r.json?.error || '')) ok('Bon: divisi wajib bila teknisi diketik manual'); else bad('Bon: divisi wajib', `HTTP ${r.status} ${r.json?.error}`);
  r = await req('POST', '/api/technician-loans', { divisi: 'GUDANG', teknisi_nama: 'X', items: [{ kode_barang: PATCH, jumlah: 1 }] });
  if (r.status === 400 && /Divisi harus/.test(r.json?.error || '')) ok('Bon: divisi tidak valid ditolak'); else bad('Bon: divisi tidak valid', `HTTP ${r.status}`);
  r = await req('POST', '/api/technician-loans', { teknisi_ref_id: 999999, items: [{ kode_barang: PATCH, jumlah: 1 }] });
  if (r.status === 400 && /tidak ditemukan/.test(r.json?.error || '')) ok('Bon: teknisi_ref_id tak dikenal ditolak'); else bad('Bon: teknisi_ref_id tak dikenal', `HTTP ${r.status}`);

  r = await req('POST', '/api/technician-loans', { teknisi_ref_id: andi.id, divisi: 'DIVISI FO', items: [{ kode_barang: PATCH, jumlah: 2 }] });
  const bonA = r.json?.data;
  if (r.status === 201 && bonA?.teknisi_nama === 'Andi Uji' && bonA.divisi === 'DIVISI FO' && bonA.teknisi_ref_id === andi.id) ok('Bon: nama & divisi dari Data Teknisi tersimpan di bon', bonA.no_bon);
  else bad('Bon: dari Data Teknisi', `HTTP ${r.status} ${r.json?.error}`);
  r = await req('POST', '/api/technician-loans', { teknisi_ref_id: tower.id, items: [{ kode_barang: PATCH, jumlah: 1 }] });
  const bonT = r.json?.data;
  if (r.status === 201 && bonT?.divisi === 'DIVISI TOWER') ok('Bon: divisi otomatis mengikuti divisi teknisi bila tidak dikirim'); else bad('Bon: divisi otomatis', `HTTP ${r.status} ${r.json?.error}`);

  // --- Filter & laporan per divisi ---
  const ld = await req('GET', '/api/technician-loans?divisi=DIVISI%20TOWER');
  if (ld.status === 200 && ld.json.data.length === 1 && ld.json.data[0].id === bonT.id) ok('Daftar bon: filter divisi'); else bad('Daftar bon: filter divisi', `${ld.json?.data?.length}`);
  const rep = await req('GET', '/api/technician-loans/report');
  const pdv = rep.json?.data?.per_divisi_bon || [];
  if (pdv.find((d) => d.divisi === 'DIVISI FO')?.jumlah_bon >= 1 && pdv.find((d) => d.divisi === 'DIVISI TOWER')?.jumlah_bon === 1 && rep.json.data.per_teknisi.find((t) => t.teknisi_nama === 'Andi Uji')?.divisi === 'DIVISI FO') ok('Laporan bon: rekap per divisi pembawa & divisi di rekap teknisi'); else bad('Laporan bon: per divisi pembawa', JSON.stringify(pdv));
  const rf = await req('GET', '/api/technician-loans/report?divisi=PELANGGAN');
  if (rf.json?.data?.loans.length === 0) ok('Laporan bon: filter divisi tanpa data → kosong'); else bad('Laporan bon: filter divisi');

  // --- Ganti nama, nonaktif, hapus ---
  r = await req('PUT', `/api/teknisi/${andi.id}`, { nama: 'Andi Pratama Uji' });
  const detA = (await req('GET', `/api/technician-loans/${bonA.id}`)).json?.data;
  const mvA = detA?.movements.filter((m) => m.jenis === 'BAWA').every((m) => m.teknisi_nama === 'Andi Pratama Uji');
  if (r.status === 200 && detA?.teknisi_nama === 'Andi Pratama Uji' && mvA) ok('Teknisi: ganti nama ikut memperbarui bon & riwayat mutasi lama'); else bad('Teknisi: ganti nama berantai', `HTTP ${r.status} bon=${detA?.teknisi_nama}`);
  r = await req('DELETE', `/api/teknisi/${andi.id}`);
  if (r.status === 400 && /nonaktif/.test(r.json?.error || '')) ok('Teknisi: yang sudah tercatat di bon tidak bisa dihapus (disarankan nonaktif)'); else bad('Teknisi: hapus yang terpakai', `HTTP ${r.status}`);
  r = await req('PUT', `/api/teknisi/${plg.id}`, { status: 'nonaktif' });
  const rn = await req('POST', '/api/technician-loans', { teknisi_ref_id: plg.id, items: [{ kode_barang: PATCH, jumlah: 1 }] });
  if (r.status === 200 && rn.status === 400 && /nonaktif/.test(rn.json?.error || '')) ok('Teknisi nonaktif tidak bisa dipilih di bon baru'); else bad('Teknisi nonaktif di bon', `HTTP ${rn.status}`);
  r = await req('DELETE', `/api/teknisi/${plg.id}`);
  if (r.status === 200) ok('Teknisi: yang belum pernah dipakai bisa dihapus'); else bad('Teknisi: hapus yang belum dipakai', `HTTP ${r.status}`);
  r = await req('PUT', '/api/teknisi/999999', { nama: 'Hantu' });
  if (r.status === 404) ok('Teknisi: ubah id tak dikenal → 404'); else bad('Teknisi: 404', `HTTP ${r.status}`);

  // Bersihkan: kembalikan sisa bon uji, lalu reset (menghapus bon) dan hapus teknisi uji
  for (const b of [bonA, bonT]) await req('POST', `/api/technician-loans/${b.id}/return`, { semua_sisa: true });
  checkNoNegativeStock('setelah Data Teknisi');
  await req('POST', '/api/reset-seed');
  for (const t of [andi, tower]) await req('DELETE', `/api/teknisi/${t.id}`);
  const sisa = db.prepare('SELECT COUNT(*) AS c FROM technicians').get().c;
  if (sisa === 0) ok('Teknisi uji dibersihkan setelah tes'); else bad('Teknisi uji dibersihkan', `${sisa} tersisa`);
}

console.log('\n=== PEMBERSIHAN: reset ke data contoh ===');
await req('POST', '/api/reset-seed');
const setelahReset = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
if (setelahReset > 0) ok('Data contoh berhasil dipulihkan', `${setelahReset} pelanggan`);
else bad('Data contoh berhasil dipulihkan', 'database kosong');

db.close();
console.log(`\n========== HASIL: ${pass} lolos, ${fail} gagal ==========`);
if (fail) {
  console.log('Yang masih bermasalah:');
  failures.forEach(f => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
