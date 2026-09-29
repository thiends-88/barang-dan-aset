/**
 * Smoke test render (SSR) — memuat setiap komponen dengan DATA ASLI dari API
 * untuk memastikan tidak ada crash saat render tabel, kartu, dan modal.
 *
 * Jalankan: node ssr-test.mjs   (server API harus hidup di port 3001)
 */
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';
import fs from 'node:fs';

const API = 'http://127.0.0.1:3001';

// API kini terproteksi login — ambil token admin terlebih dahulu
const loginRes = await fetch(API + '/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin123' }),
});
const loginJson = await loginRes.json();
if (!loginJson.success) {
  console.error('Gagal login admin untuk SSR test:', loginJson.error || 'unknown');
  process.exit(1);
}
const AUTH_HEADER = { Authorization: `Bearer ${loginJson.data.token}` };

async function get(path) {
  const res = await fetch(API + path, { headers: AUTH_HEADER });
  const json = await res.json();
  return json.success ? json.data : [];
}

const [items, customers, foSites, towerSites] = await Promise.all([
  get('/api/items'),
  get('/api/customers'),
  get('/api/fo'),
  get('/api/tower'),
]);

console.log(`Data uji: ${items.length} barang, ${customers.length} pelanggan, ${foSites.length} FO, ${towerSites.length} tower\n`);

const vite = await createServer({
  root: process.cwd(),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

let pass = 0, fail = 0;

async function check(name, path, props) {
  try {
    const mod = await vite.ssrLoadModule(path);
    const Comp = mod.default;
    const html = renderToString(React.createElement(Comp, props || {}));
    // Pastikan ada isi, bukan render kosong
    if (!html || html.length < 50) throw new Error('render terlalu pendek / kosong');
    console.log(`OK   ${name} (${html.length} karakter HTML)`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${name}: ${String(e.message).split('\n')[0]}`);
    fail++;
  }
}

await check('App', '/src/App.jsx');
await check('Navbar', '/src/components/Navbar.jsx', {
  currentTab: 'master', onSelectTab() {}, onOpenScanner() {}, onResetSeed() {}, isResetting: false,
});
await check('Dashboard', '/src/components/Dashboard.jsx', {
  onNavigate() {}, onOpenScanner() {}, onRefreshAll() {},
});
await check('MasterBarang', '/src/components/MasterBarang.jsx', {
  items, onRefresh() {}, onOpenBarcodeModal() {}, onOpenScanner() {},
});
await check('DivisiPelanggan', '/src/components/DivisiPelanggan.jsx', {
  customers, items, onRefresh() {}, onOpenBarcodeModal() {},
});
await check('DivisiFO', '/src/components/DivisiFO.jsx', {
  foSites, items, onRefresh() {},
});
await check('DivisiTower', '/src/components/DivisiTower.jsx', {
  towerSites, items, onRefresh() {},
});
await check('KeluarMasukBarang', '/src/components/KeluarMasukBarang.jsx', {
  items, onRefreshMaster() {},
});
await check('Laporan', '/src/components/Laporan.jsx', { onRefreshData() {} });
await check('BarcodeScannerModal', '/src/components/BarcodeScannerModal.jsx', {
  isOpen: true, onClose() {}, onPrintBarcode() {}, onStockAdjust() {},
});
await check('BarcodeLabelModal', '/src/components/BarcodeLabelModal.jsx', {
  isOpen: true, onClose() {}, item: items[0],
});
await check('CategoryManagerModal', '/src/components/CategoryManagerModal.jsx', {
  isOpen: true, onClose() {}, categories: [{ id: 1, nama_kategori: 'Kabel Fiber Optic' }],
  items, onRefreshCategories() {}, onRefreshItems() {},
});
await check('WorkOrderPrintModal (berita acara pelanggan)', '/src/components/WorkOrderPrintModal.jsx', {
  isOpen: true, onClose() {}, type: 'pelanggan', data: customers[0],
});
await check('WorkOrderPrintModal (berita acara FO)', '/src/components/WorkOrderPrintModal.jsx', {
  isOpen: true, onClose() {}, type: 'fo', data: foSites[0],
});
await check('LoginPage', '/src/components/LoginPage.jsx', { onLogin() {} });
await check('UserManagement', '/src/components/UserManagement.jsx', {
  currentUser: { id: 1, username: 'admin', nama_lengkap: 'Administrator Sistem', role: 'admin' },
});
await check('VersionBadge', '/src/components/VersionBadge.jsx', {});
await check('ImportDataModal (barang)', '/src/components/ImportDataModal.jsx', {
  isOpen: true, onClose() {}, type: 'items', onImported() {},
});

// ============================================================
// 19. ReGRESI TAMPILAN NAVBAR — menu utama tidak boleh tertimpa
// ============================================================
// Bug yang pernah terjadi (29 Sep 2026): pada lebar laptop 1100–1535px menu
// utama tergeser keluar kotaknya & tertimpa tombol "Pindai Barcode".
// Akar masalahnya classy `min-[1100px]:hidden` yang KALAH URUTAN dari
// `sm:`/`md:`/`2xl:` pada CSS hasil build Tailwind v4, sehingga aturan
// "sembunyikan label di 1100–1535px" sama sekali tidak berlaku.
// Tes di bawah mengunci aturan yang membuat bug itu tidak bisa kembali diam-diam.
console.log('\n=== 19. Regresi tampilan Navbar (menu utama tidak tertimpa) ===');

const navbarSrc = fs.readFileSync('src/components/Navbar.jsx', 'utf-8');
const cssSrc = fs.readFileSync('src/index.css', 'utf-8');

function sectionOk(msg) { console.log(`OK   ${msg}`); pass++; }
function sectionBad(msg) { console.log(`FAIL ${msg}`); fail++; }

// 19.1 --breakpoint-nav harus terdaftar, jika tidak varian `nav:` tidak dikompilasi
if (/--breakpoint-nav\s*:\s*\d+px/.test(cssSrc)) {
  sectionOk('19.1 --breakpoint-nav terdaftar di src/index.css (varian `nav:` terkompilasi)');
} else {
  sectionBad('19.1 --breakpoint-nav tidak ada di src/index.css — varian `nav:` tidak akan berfungsi');
}

// 19.2 Larangan varian arbitrer untuk tampil/sembunyi digabung breakpoint standar.
//      Kombinasi `min-[1100px]:hidden sm:inline` TIDAK menyembunyikan apa pun
//      karena `sm:` ditulis belakangan di CSS dan menang dengan spesifisitas sama.
const classLiterals = [...navbarSrc.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)]
  .map((m) => m[1] || m[2] || m[3] || '')
  .filter(Boolean);
const badCombos = classLiterals.filter((c) =>
  /(?:^|\s)(?:min|max)-\[[^\]]+\]:/.test(c) &&
  /(?:^|\s)(?:sm|md|lg|xl|2xl):(?:block|inline|inline-block|flex|hidden|grid|inline-flex)(?:\s|$)/.test(c)
);
if (badCombos.length === 0) {
  sectionOk(`19.2 tidak ada varian arbitrer dicampur breakpoint standar (${classLiterals.length} className diperiksa)`);
} else {
  sectionBad(`19.2 ${badCombos.length} className mencampur min-[…]/max-[…] dengan sm:/md:/2xl: → ${badCombos[0]}`);
}

// 19.3 Tepat SATU elemen yang dinyalakan `nav:flex` (menu utama) dan TEPAT SATU
//      yang dimatikan `nav:hidden` (baris geser). Kalau keduanya `nav:flex`, atau
//      baris geser juga `nav:flex`, maka DUA baris menu tampil bertumpuk.
const navFlexCount = (navbarSrc.match(/(?:^|\s)nav:flex(?:\s|$)/g) || []).length;
const navHiddenCount = (navbarSrc.match(/(?:^|\s)nav:hidden(?:\s|$)/g) || []).length;
if (navFlexCount === 1 && navHiddenCount === 1) {
  sectionOk('19.3 tepat satu menu utama (nav:flex) + satu baris geser (nav:hidden)');
} else {
  sectionBad(`19.3 jumlah salah → nav:flex=${navFlexCount} (harus 1), nav:hidden=${navHiddenCount} (harus 1)`);
}

// 19.4 Setiap menu wajib punya `label` (baris geser + tooltip) dan `short`
//      (baris utama). `short` terlalu panjang = menu tidak muat satu baris = bug awal.
const menuItems = [...navbarSrc.matchAll(/\{ id: '([a-z]+)', label: '([^']+)', short: '([^']+)'/g)]
  .map((m) => ({ id: m[1], label: m[2], short: m[3] }));
const itemProblems = [];
if (menuItems.length !== 8) itemProblems.push(`jumlah menu ${menuItems.length} ≠ 8`);
for (const it of menuItems) {
  if (!it.label || !it.short) itemProblems.push(`${it.id} tidak punya label/short`);
  else if (it.short.length > 10) itemProblems.push(`${it.id} short "${it.short}" ${it.short.length} karakter (>10)`);
  else if (it.label.length < it.short.length) itemProblems.push(`${it.id} short "${it.short}" lebih panjang dari label`);
}
if (itemProblems.length === 0) {
  sectionOk(`19.4 8 menu punya label + short ringkas (terpanjang: "${menuItems.map((i) => i.short).sort((a, b) => b.length - a.length)[0]}")`);
} else {
  sectionBad(`19.4 ${itemProblems.join('; ')}`);
}

// 19.5 Kelas bantu buatan sendiri WAJIB terdefinisi di index.css (konvensi §5.5 handoff)
for (const cls of ['justify-center-safe', 'scrollbar-none']) {
  if (new RegExp('\\.' + cls + '\\b').test(cssSrc)) sectionOk(`19.5 kelas .${cls} terdefinisi di src/index.css`);
  else sectionBad(`19.5 kelas .${cls} dipakai di Navbar tapi tidak terdefinisi di src/index.css`);
}

// 19.6 Render nyata: jumlah menu mengikuti peran, dan baris utama memakai `short`
const NavbarMod = await vite.ssrLoadModule('/src/components/Navbar.jsx');
const Navbar = NavbarMod.default;
const renderNav = (role) => renderToString(React.createElement(Navbar, {
  currentTab: 'dashboard', onSelectTab() {}, onOpenScanner() {}, onResetSeed() {},
  isResetting: false, user: { id: 1, username: 'u', nama_lengkap: 'Uji Peran', role }, onLogout() {},
}));
const countLabel = (html, label) => html.split(`title="${label}"`).length - 1;

const EXPECT = { admin: 8, staff_gudang: 7, teknisi: 6, viewer: 6 };
for (const [role, expected] of Object.entries(EXPECT)) {
  const html = renderNav(role);
  // Atribut `title` hanya dipakai menu utama, jadi jumlahnya = jumlah menu peran tsb
  const total = menuItems.reduce((n, it) => n + countLabel(html, it.label), 0);
  if (total === expected) sectionOk(`19.6 peran ${role}: ${total} menu sesuai MENU_ACCESS`);
  else sectionBad(`19.6 peran ${role}: ${total} menu, harusnya ${expected}`);
}

const adminHtml = renderNav('admin');
const viewerHtml = renderNav('viewer');
const shortProblems = [];
for (const it of menuItems) {
  if (!adminHtml.includes(`<span>${it.short}</span>`)) shortProblems.push(`short "${it.short}" tidak dirender di menu utama`);
}
for (const it of menuItems) {
  if (!adminHtml.includes(`<span>${it.label}</span>`)) shortProblems.push(`label "${it.label}" tidak dirender di baris geser`);
}
if (countLabel(viewerHtml, 'Manajemen User') > 0) shortProblems.push('viewer melihat menu "User"');
if (countLabel(viewerHtml, 'Keluar / Masuk') > 0) shortProblems.push('viewer melihat menu "Mutasi"');
if ((adminHtml.match(/aria-label="Menu utama"/g) || []).length !== 2) shortProblems.push('harus ada tepat 2 baris menu (utama + geser)');
if (shortProblems.length === 0) sectionOk('19.6 menu utama memakai `short`, baris geser memakai `label` penuh, peran terbatas benar');
else sectionBad(`19.6 ${shortProblems.join('; ')}`);

await vite.close();
console.log(`\nHasil: ${pass} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);
