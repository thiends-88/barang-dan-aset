import crypto from 'crypto';

// ============================================================
// Otentikasi sederhana & aman untuk aplikasi internal:
// - Password di-hash dengan scrypt + salt acak (bawaan Node.js)
// - Sesi memakai token bertanda tangan HMAC (stateless, tanpa library)
// ============================================================

const SECRET = process.env.AUTH_SECRET || 'sim-aset-secret-dev-ganti-di-produksi';
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

/** Daftar peran yang valid beserta label tampilannya. */
export const ROLES = {
  admin: 'Administrator',
  staff_gudang: 'Staff Gudang',
  teknisi: 'Teknisi Lapangan',
  viewer: 'Viewer (Hanya Lihat)'
};

/** Hash password → "salt:hash" (hex). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Verifikasi password terhadap hash tersimpan (aman timing). */
export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/** Buat token sesi: payload(user id + kedaluwarsa) + tanda tangan HMAC. */
export function signToken(userId) {
  const payload = base64url(JSON.stringify({ uid: userId, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verifikasi token → { uid } atau null bila palsu/kedaluwarsa. */
export function verifyToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.uid || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}
