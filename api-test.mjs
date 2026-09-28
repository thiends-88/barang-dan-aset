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

async function req(method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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

// ============================================================
console.log('\n=== PERSIAPAN ===');
await req('POST', '/api/reset-seed');
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

await req('DELETE', `/api/tower/${idTower}`);
if (stockOf(KODE) === STOK_AWAL) ok('Tower: hapus mengembalikan stok', `stok=${stockOf(KODE)}`);
else bad('Tower: hapus mengembalikan stok', `stok=${stockOf(KODE)}, harap ${STOK_AWAL} — stok hilang!`);

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

console.log('\n=== 7. INVARIANT AKHIR ===');
checkNoNegativeStock('akhir pengujian');
checkInvariant('seluruh pengujian', GLOBAL_SNAP, GLOBAL_MARK);

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
