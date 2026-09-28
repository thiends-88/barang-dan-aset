/**
 * Smoke test render (SSR) — memuat setiap komponen dengan DATA ASLI dari API
 * untuk memastikan tidak ada crash saat render tabel, kartu, dan modal.
 *
 * Jalankan: node ssr-test.mjs   (server API harus hidup di port 3001)
 */
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const API = 'http://127.0.0.1:3001';

async function get(path) {
  const res = await fetch(API + path);
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

await vite.close();
console.log(`\nHasil: ${pass} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);
