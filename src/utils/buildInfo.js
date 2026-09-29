/**
 * Info build frontend yang tertanam di bundle (lihat vite.config.js → define __APP_BUILD__).
 * Aman dipakai di SSR test maupun bila konstanta tidak terdefinisi.
 */
/* global __APP_BUILD__ */
const EMPTY = {
  version: '0.0.0',
  commit: null,
  commitShort: null,
  branch: null,
  commitDate: null,
  builtAt: null,
  builtAtLocal: null
};

export const CLIENT_BUILD = (() => {
  try {
    return typeof __APP_BUILD__ !== 'undefined' && __APP_BUILD__ ? { ...EMPTY, ...__APP_BUILD__ } : EMPTY;
  } catch {
    return EMPTY;
  }
})();

/** Label ringkas, mis. "v1.0.0 · a1b2c3d". */
export function versionLabel(info = CLIENT_BUILD) {
  const v = `v${info?.version || '0.0.0'}`;
  return info?.commitShort ? `${v} · ${info.commitShort}` : v;
}

/**
 * true bila server sudah menyajikan build frontend yang berbeda dari yang
 * sedang dimuat browser (artinya ada update → pengguna perlu muat ulang).
 */
export function isClientOutdated(serverBuild, clientBuild = CLIENT_BUILD) {
  if (!serverBuild?.builtAt || !clientBuild?.builtAt) return false;
  return serverBuild.builtAt !== clientBuild.builtAt;
}
