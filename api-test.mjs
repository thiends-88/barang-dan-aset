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
