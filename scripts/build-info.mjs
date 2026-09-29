/**
 * Info versi build — satu sumber untuk Vite (frontend) dan server.
 *
 * - Vite memanggil getBuildInfo() saat `npm run build` / `npm run dev`, lalu:
 *     1) menanam hasilnya ke bundle sebagai konstanta __APP_BUILD__
 *     2) menulis dist/build-info.json (dibaca server untuk /api/version)
 * - Server memanggil getGitInfo() saat start untuk mengetahui commit yang
 *   benar-benar ter-checkout di mesin (bisa berbeda dari commit saat build).
 *
 * Catatan: dist/ ikut di-commit, jadi `commit` di build-info.json adalah
 * commit INDUK dari commit yang memuat build tsb. (build dibuat sebelum
 * commit). Commit yang sedang berjalan di server ada di `runtime.commit`.
 *
 * Semua pemanggilan git dibungkus try/catch: di server tanpa git atau di
 * arsip hasil unduhan ZIP, nilainya cukup menjadi null.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, cwd = ROOT) {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Stempel waktu lokal "YYYY-MM-DD HH:MM:SS" pada zona waktu aplikasi (default WIB). */
export function localStamp(date = new Date(), timeZone = process.env.APP_TZ || 'Asia/Jakarta') {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${pad2(parts.hour)}:${parts.minute}:${parts.second}`;
}

export function readPackageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Info git dari working tree saat ini (null bila git tidak tersedia). */
export function getGitInfo(cwd = ROOT) {
  const commit = git(['rev-parse', 'HEAD'], cwd);
  if (!commit) return { commit: null, commitShort: null, branch: null, commitDate: null };
  return {
    commit,
    commitShort: commit.slice(0, 7),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    commitDate: git(['log', '-1', '--format=%cI'], cwd)
  };
}

/** Info lengkap sebuah build frontend. */
export function getBuildInfo() {
  const g = getGitInfo();
  const now = new Date();
  return {
    version: readPackageVersion(),
    commit: g.commit,
    commitShort: g.commitShort,
    branch: g.branch,
    commitDate: g.commitDate,
    builtAt: now.toISOString(),
    builtAtLocal: localStamp(now)
  };
}
