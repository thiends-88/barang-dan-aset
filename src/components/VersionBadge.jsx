import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GitCommitHorizontal, RefreshCw, X } from 'lucide-react';
import { CLIENT_BUILD, versionLabel, isClientOutdated } from '../utils/buildInfo';

// Cek ulang versi server berkala supaya pengguna tahu bila ada update
const POLL_MS = 5 * 60 * 1000;
// Di mode dev (Vite) build-info di server pasti berbeda → jangan tampilkan peringatan palsu
const IS_PROD = Boolean(import.meta.env?.PROD);

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-4 py-1 border-b border-slate-100 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-800 text-right break-all">{value || '—'}</span>
    </div>
  );
}

/**
 * Lencana versi aplikasi (footer). Menampilkan versi + commit build frontend,
 * detail build/server saat diklik, dan tombol "Muat ulang" bila server sudah
 * menyajikan build yang lebih baru dari yang sedang dibuka browser.
 */
export default function VersionBadge({ className = '' }) {
  const [server, setServer] = useState(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      const json = await res.json();
      if (json?.success) setServer(json.data);
    } catch {
      /* server tak terjangkau — biarkan info lokal saja */
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // Tutup panel saat klik di luar
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const outdated = IS_PROD && isClientOutdated(server?.build);

  return (
    <div ref={boxRef} className={`relative inline-flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-mono text-slate-500 transition"
        title={CLIENT_BUILD.builtAtLocal ? `Build ${CLIENT_BUILD.builtAtLocal} WIB` : 'Info versi aplikasi'}
        aria-label="Info versi aplikasi"
        aria-expanded={open}
      >
        <GitCommitHorizontal className="w-3.5 h-3.5" />
        <span>{versionLabel(CLIENT_BUILD)}</span>
      </button>

      {outdated && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300 text-[11px] font-bold transition"
          title="Server sudah diperbarui — muat ulang untuk memakai versi terbaru"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Versi baru — muat ulang</span>
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Detail versi"
          className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 z-50 w-72 max-w-[calc(100vw-1.5rem)] bg-white border border-slate-200 rounded-xl shadow-xl p-3 text-[11px] text-left"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-slate-800 text-xs">Info Versi</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="p-1 rounded hover:bg-slate-100 text-slate-400"
              aria-label="Tutup"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="font-semibold text-slate-600 mb-1">Aplikasi di browser</div>
          <Row label="Versi" value={`v${CLIENT_BUILD.version}`} />
          <Row label="Commit build" value={CLIENT_BUILD.commitShort} />
          <Row label="Waktu build" value={CLIENT_BUILD.builtAtLocal && `${CLIENT_BUILD.builtAtLocal} WIB`} />

          <div className="font-semibold text-slate-600 mt-3 mb-1">Server</div>
          {server ? (
            <>
              <Row label="Commit berjalan" value={server.runtime?.commitShort} />
              <Row label="Branch" value={server.runtime?.branch} />
              <Row label="Build tersaji" value={server.build?.builtAtLocal && `${server.build.builtAtLocal} WIB`} />
              <Row label="Aktif sejak" value={server.runtime?.startedAt && `${server.runtime.startedAt} WIB`} />
              <Row label="Node.js" value={server.runtime?.node} />
            </>
          ) : (
            <div className="text-slate-400 py-1">Memuat info server…</div>
          )}

          {outdated && (
            <p className="mt-2 text-amber-700 font-semibold">
              Server menyajikan build yang lebih baru. Muat ulang halaman untuk memperbarui.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
