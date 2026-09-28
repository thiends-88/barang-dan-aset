/**
 * Notifikasi in-app sederhana.
 *
 * Komponen mana pun bisa memanggil `notify('pesan', 'error')` tanpa perlu
 * menerima prop dari App. App berlangganan (subscribe) dan menampilkan toast.
 */

const listeners = new Set();

/** Daftarkan pendengar notifikasi. Mengembalikan fungsi untuk berhenti berlangganan. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Kirim notifikasi ke seluruh pendengar. type: 'success' | 'error' */
export function notify(message, type = 'success') {
  const pesan = String(message || '').trim();
  if (!pesan) return;
  listeners.forEach((listener) => listener({ message: pesan, type }));
}
