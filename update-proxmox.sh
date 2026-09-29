#!/usr/bin/env bash
# =============================================================================
#  update-proxmox.sh — perbarui SIM-ASET di server (Proxmox/LXC) dengan aman
# =============================================================================
#  Urutan kerja:
#    1. cek prasyarat (git, node >= 22, npm, unit systemd)
#    2. git fetch & tampilkan commit yang akan masuk (+ peringatan soal DB)
#    3. hentikan layanan systemd (agar tidak ada tulisan baru ke DB)
#    4. CADANGKAN data/inventory.db (salinan konsisten via SQLite VACUUM INTO,
#       lolos integrity_check) + simpan perubahan lokal (bila ada) sebagai .patch
#    5. git reset --hard origin/<branch>, lalu pulihkan DB dari cadangan bila
#       hilang/tertimpa; bandingkan isi DB sebelum vs sesudah
#    6. npm install --omit=dev
#    7. jalankan ulang layanan + cek /api/version (commit berjalan = target?)
#    8. rapikan cadangan lama (simpan N terbaru di data/backups/)
#
#  Pemakaian:
#    ./update-proxmox.sh --dry-run      # tampilkan rencana, TIDAK mengubah apa pun
#    sudo ./update-proxmox.sh           # jalankan update sungguhan
#
#  Update PERTAMA (server masih di versi lama yang belum punya skrip ini):
#    cd /opt/barang-dan-aset && git fetch origin main
#    git show origin/main:update-proxmox.sh > /tmp/update-proxmox.sh
#    bash /tmp/update-proxmox.sh --dir /opt/barang-dan-aset --dry-run
#    sudo bash /tmp/update-proxmox.sh --dir /opt/barang-dan-aset
#
#  Opsi:
#    -d, --dir FOLDER     folder aplikasi (default: folder tempat skrip ini berada)
#    -n, --dry-run        hanya tampilkan langkah (git fetch tetap dijalankan agar
#                         daftar commit yang masuk akurat; working tree tidak disentuh)
#    -b, --branch NAMA    branch sumber (default: main, atau env BRANCH)
#    -s, --service NAMA   nama unit systemd (default: barang-dan-aset, atau env SERVICE)
#    -p, --port PORT      port aplikasi untuk cek kesehatan (default: dari unit systemd
#                         atau env PORT, lalu 3000)
#    -k, --keep N         jumlah cadangan DB yang disimpan (default: 20)
#        --no-restart     jangan hentikan/jalankan layanan (mis. dijalankan manual)
#    -f, --force          tetap jalankan walau tidak ada commit baru
#    -y, --yes            jangan minta konfirmasi
#    -h, --help           tampilkan bantuan ini
#
#  PENTING (update pertama setelah PR "lepas pelacakan DB"):
#    commit tersebut menghapus data/inventory.db dari git, sehingga `git reset --hard`
#    AKAN MENGHAPUS berkas database. Skrip ini memulihkannya otomatis dari cadangan
#    langkah 4 — itu sebabnya langkah cadangan tidak bisa dilewati.
# =============================================================================
set -Eeuo pipefail

# Jalankan dari salinan sementara: `git reset --hard` bisa mengganti berkas skrip
# ini di tengah eksekusi, dan bash membaca skrip sedikit demi sedikit.
if [[ -z "${SIMASET_UPDATE_REEXEC:-}" ]]; then
  SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TMP_SELF="$(mktemp "${TMPDIR:-/tmp}/update-proxmox.XXXXXX.sh")"
  cp "${BASH_SOURCE[0]}" "$TMP_SELF"
  SIMASET_UPDATE_REEXEC="$TMP_SELF" SIMASET_SELF_DIR="$SELF_DIR" exec bash "$TMP_SELF" "$@"
fi
trap 'rm -f "$SIMASET_UPDATE_REEXEC"' EXIT

# ---------- konfigurasi & argumen ----------
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-barang-dan-aset}"
PORT_OPT="${PORT:-}"
KEEP=20
DRY_RUN=0
NO_RESTART=0
FORCE=0
ASSUME_YES=0
APP_DIR="${APP_DIR:-$SIMASET_SELF_DIR}"

usage() { awk 'NR==1{next} !/^#/{exit} !/^# =====/' "$SIMASET_UPDATE_REEXEC" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--dry-run)  DRY_RUN=1 ;;
    -d|--dir)      APP_DIR="${2:?--dir butuh nilai}"; shift ;;
    -b|--branch)   BRANCH="${2:?--branch butuh nilai}"; shift ;;
    -s|--service)  SERVICE="${2:?--service butuh nilai}"; shift ;;
    -p|--port)     PORT_OPT="${2:?--port butuh nilai}"; shift ;;
    -k|--keep)     KEEP="${2:?--keep butuh nilai}"; shift ;;
    --no-restart)  NO_RESTART=1 ;;
    -f|--force)    FORCE=1 ;;
    -y|--yes)      ASSUME_YES=1 ;;
    -h|--help)     usage; exit 0 ;;
    *) echo "Opsi tidak dikenal: $1 (lihat --help)" >&2; exit 2 ;;
  esac
  shift
done
[[ "$KEEP" =~ ^[0-9]+$ && "$KEEP" -ge 1 ]] || { echo "--keep harus angka >= 1" >&2; exit 2; }

# ---------- utilitas tampilan ----------
if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; C=$'\e[36m'; N=$'\e[0m'; else B=; G=; Y=; R=; C=; N=; fi
step() { echo; echo "${B}${C}==> $*${N}"; }
info() { echo "    $*"; }
ok()   { echo "    ${G}✓${N} $*"; }
warn() { echo "    ${Y}!${N} $*"; }
die() {
  echo; echo "${R}${B}✗ $*${N}" >&2
  # Belum ada kode/DB yang diubah → nyalakan lagi layanan yang sempat dihentikan
  if [[ ${SERVICE_STOPPED:-0} -eq 1 && ${RESET_DONE:-0} -eq 0 ]]; then
    echo "    menyalakan kembali layanan $SERVICE ..." >&2
    systemctl start "$SERVICE" || true
  fi
  exit 1
}

# Jalankan perintah, atau hanya tampilkan bila --dry-run
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '    %s[dry-run]%s' "$Y" "$N"; printf ' %q' "$@"; echo
  else
    printf '    %s$%s' "$C" "$N"; printf ' %q' "$@"; echo
    LAST_CMD="$*"
    "$@"
    LAST_CMD=""
  fi
}

# ---------- lokasi ----------
[[ -d "$APP_DIR" ]] || { echo "Folder aplikasi tidak ditemukan: $APP_DIR" >&2; exit 2; }
APP_DIR="$(cd "$APP_DIR" && pwd)"
cd "$APP_DIR"
DB_REL="data/inventory.db"
DB="$APP_DIR/$DB_REL"
BACKUP_DIR="$APP_DIR/data/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/inventory-$STAMP.db"

OLD_COMMIT=""
LAST_CMD=""
RESTORE_NEEDED_HINT=""
SERVICE_STOPPED=0
RESET_DONE=0
SUMMARY_BEFORE=""

# Petunjuk pemulihan bila ada langkah yang gagal di tengah jalan
on_error() {
  local code=$? cmd="${LAST_CMD:-$BASH_COMMAND}"
  echo
  echo "${R}${B}✗ Update GAGAL (kode $code) saat menjalankan: ${cmd}${N}" >&2
  [[ $SERVICE_STOPPED -eq 1 ]] && echo "  ${Y}Layanan $SERVICE masih BERHENTI.${N}" >&2
  if [[ $DRY_RUN -eq 0 && -n "$OLD_COMMIT" ]]; then
    echo "  Cara kembali ke kondisi sebelum update:" >&2
    echo "    cd $APP_DIR" >&2
    echo "    git reset --hard $OLD_COMMIT" >&2
    [[ -f "$BACKUP_FILE" ]] && echo "    rm -f $DB_REL-wal $DB_REL-shm && cp $BACKUP_FILE $DB_REL" >&2
    echo "    npm install --omit=dev" >&2
    [[ $SERVICE_STOPPED -eq 1 ]] && echo "    systemctl start $SERVICE" >&2
  fi
  exit "$code"
}
trap on_error ERR

have_systemd_unit() {
  command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE" >/dev/null 2>&1
}

unit_env() { # nilai Environment=KEY=... dari unit systemd
  have_systemd_unit || return 0
  systemctl show -p Environment --value "$SERVICE" 2>/dev/null | tr ' ' '\n' | sed -n "s/^$1=//p" | tail -n1
}

# Salinan DB yang konsisten walau server masih berjalan (mode WAL)
backup_db() {
  local src="$1" dst="$2"
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const [src, dst] = process.argv.slice(1);
    const db = new DatabaseSync(src);
    db.exec("VACUUM INTO " + "\x27" + dst.replace(/\x27/g, "\x27\x27") + "\x27");
    db.close();
  ' "$src" "$dst" 2>/dev/null && return 0
  # Cadangan jalur kedua: salin berkas mentah (+ WAL/SHM bila ada)
  warn "VACUUM INTO gagal — memakai salinan berkas mentah"
  cp -p "$src" "$dst"
  [[ -f "$src-wal" ]] && cp -p "$src-wal" "$dst-wal"
  [[ -f "$src-shm" ]] && cp -p "$src-shm" "$dst-shm"
  return 0
}

# Cek integritas + ringkasan isi DB; mencetak "ok|<barang>|<pelanggan>|<transaksi>|<user>"
db_summary() {
  node --no-warnings -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(process.argv[1], { readOnly: true });
    const q = (s) => { try { return db.prepare(s).get().c; } catch { return "?"; } };
    const integ = db.prepare("PRAGMA integrity_check").get();
    console.log([Object.values(integ)[0], q("SELECT COUNT(*) c FROM items"), q("SELECT COUNT(*) c FROM customers"),
      q("SELECT COUNT(*) c FROM transactions"), q("SELECT COUNT(*) c FROM users")].join("|"));
    db.close();
  ' "$1"
}

print_summary() { # $1 = label, $2 = output db_summary
  local integ items cust trx users
  IFS='|' read -r integ items cust trx users <<<"$2"
  info "$1: integritas=${integ}, barang=${items}, pelanggan=${cust}, transaksi=${trx}, user=${users}"
  [[ "$integ" == "ok" ]]
}

confirm() {
  [[ $ASSUME_YES -eq 1 || $DRY_RUN -eq 1 ]] && return 0
  if [[ ! -t 0 ]]; then die "Butuh konfirmasi tetapi tidak ada terminal. Pakai --yes untuk melanjutkan."; fi
  read -r -p "    Lanjutkan update? [y/N] " ans
  [[ "$ans" =~ ^[YyJj]$ ]] || die "Dibatalkan oleh pengguna."
}

[[ $DRY_RUN -eq 1 ]] && echo "${Y}${B}*** MODE DRY-RUN: tidak ada berkas, database, atau layanan yang diubah ***${N}"

# =============================================================================
step "1/8 Cek prasyarat"
command -v git  >/dev/null || die "git tidak ditemukan."
command -v node >/dev/null || die "node tidak ditemukan (butuh Node.js 22+)."
command -v npm  >/dev/null || die "npm tidak ditemukan."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP_DIR bukan repository git."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node.js $(node -v) terlalu lama — butuh 22+ (modul node:sqlite)."
ok "folder aplikasi : $APP_DIR"
ok "node $(node -v), npm $(npm -v), git $(git --version | awk '{print $3}')"

if have_systemd_unit; then
  ok "layanan systemd : $SERVICE"
else
  warn "unit systemd '$SERVICE' tidak ditemukan — layanan harus dijalankan ulang manual."
  NO_RESTART=1
fi
APP_PORT="${PORT_OPT:-$(unit_env PORT)}"; APP_PORT="${APP_PORT:-3000}"
info "port cek kesehatan: $APP_PORT"

CURRENT_RUNNING=""
if command -v curl >/dev/null 2>&1; then
  CURRENT_RUNNING="$(curl -fsS --max-time 3 "http://127.0.0.1:$APP_PORT/api/version" 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.data?.runtime?.commitShort||"")}catch{}})' || true)"
  [[ -n "$CURRENT_RUNNING" ]] && info "commit yang sedang berjalan: $CURRENT_RUNNING"
fi

# =============================================================================
step "2/8 Ambil pembaruan dari origin/$BRANCH"
OLD_COMMIT="$(git rev-parse HEAD)"
info "commit lokal saat ini: $(git log -1 --format='%h %s (%cd)' --date=format:'%Y-%m-%d %H:%M')"
git fetch --prune origin "$BRANCH"
TARGET="origin/$BRANCH"
NEW_COMMIT="$(git rev-parse "$TARGET")"
info "commit target       : $(git log -1 --format='%h %s (%cd)' --date=format:'%Y-%m-%d %H:%M' "$TARGET")"

INCOMING="$(git log --oneline "$OLD_COMMIT..$NEW_COMMIT" || true)"
if [[ -z "$INCOMING" ]]; then
  if [[ "$OLD_COMMIT" == "$NEW_COMMIT" ]]; then
    ok "sudah versi terbaru."
  else
    warn "commit lokal tidak ada di $TARGET (akan diganti dengan $TARGET)."
  fi
  if [[ $FORCE -eq 0 && "$OLD_COMMIT" == "$NEW_COMMIT" ]]; then
    info "Tidak ada yang perlu dilakukan. Pakai --force untuk tetap menjalankan ulang langkah install/restart."
    exit 0
  fi
else
  info "commit yang akan masuk:"
  echo "$INCOMING" | sed 's/^/      /'
fi

# Perubahan lokal pada berkas terlacak akan hilang oleh reset --hard
LOCAL_CHANGES="$(git status --porcelain --untracked-files=no -- . ":(exclude)$DB_REL" || true)"
if [[ -n "$LOCAL_CHANGES" ]]; then
  warn "ada perubahan lokal yang AKAN DIBUANG oleh reset --hard:"
  echo "$LOCAL_CHANGES" | sed 's/^/      /'
  info "(akan disimpan dulu sebagai $BACKUP_DIR/local-changes-$STAMP.patch)"
fi

DB_TRACKED_NOW=0; DB_TRACKED_TARGET=0
git ls-files --error-unmatch "$DB_REL" >/dev/null 2>&1 && DB_TRACKED_NOW=1
git cat-file -e "$NEW_COMMIT:$DB_REL" 2>/dev/null && DB_TRACKED_TARGET=1
if [[ $DB_TRACKED_NOW -eq 1 && $DB_TRACKED_TARGET -eq 0 ]]; then
  warn "update ini MELEPAS $DB_REL dari git → reset --hard akan MENGHAPUS berkas DB."
  info "  database akan dipulihkan otomatis dari cadangan (langkah 5)."
  RESTORE_NEEDED_HINT="lepas-pelacakan"
elif [[ $DB_TRACKED_TARGET -eq 1 ]]; then
  warn "commit target masih melacak $DB_REL → reset --hard akan MENIMPA DB dengan data contoh."
  info "  database akan dipulihkan otomatis dari cadangan (langkah 5)."
  RESTORE_NEEDED_HINT="tertimpa"
fi

confirm

# =============================================================================
step "3/8 Hentikan layanan"
if [[ $NO_RESTART -eq 0 ]]; then
  run systemctl stop "$SERVICE"
  [[ $DRY_RUN -eq 0 ]] && SERVICE_STOPPED=1
else
  info "dilewati (--no-restart / tanpa systemd). Pastikan aplikasi tidak sedang menulis ke DB."
fi

# =============================================================================
step "4/8 Cadangkan database"
HAS_DB=0
if [[ -f "$DB" ]]; then
  HAS_DB=1
  if [[ $DRY_RUN -eq 1 ]]; then
    print_summary "DB saat ini" "$(db_summary "$DB")" || warn "integrity_check DB saat ini tidak 'ok'!"
    info "[dry-run] cadangan akan dibuat di: $BACKUP_FILE"
  else
    mkdir -p "$BACKUP_DIR"
    backup_db "$DB" "$BACKUP_FILE"
    SUMMARY_BEFORE="$(db_summary "$BACKUP_FILE")"
    print_summary "cadangan" "$SUMMARY_BEFORE" || die "Cadangan gagal lolos integrity_check — update dihentikan, tidak ada yang diubah."
    ok "cadangan: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
  fi
else
  warn "$DB_REL belum ada — dilewati (server akan membuat DB baru berisi data contoh)."
fi

if [[ -n "$LOCAL_CHANGES" ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    info "[dry-run] git diff HEAD > $BACKUP_DIR/local-changes-$STAMP.patch"
  else
    mkdir -p "$BACKUP_DIR"
    git diff HEAD -- . ":(exclude)$DB_REL" > "$BACKUP_DIR/local-changes-$STAMP.patch"
    ok "perubahan lokal disimpan: $BACKUP_DIR/local-changes-$STAMP.patch"
  fi
fi

# =============================================================================
step "5/8 Terapkan kode terbaru & jaga database"
run git reset --hard "$NEW_COMMIT"
[[ $DRY_RUN -eq 0 ]] && RESET_DONE=1

if [[ $HAS_DB -eq 1 ]]; then
  if [[ $DRY_RUN -eq 1 ]]; then
    if [[ -n "$RESTORE_NEEDED_HINT" ]]; then
      info "[dry-run] DB akan dipulihkan dari $BACKUP_FILE ($RESTORE_NEEDED_HINT)"
    else
      info "[dry-run] DB tidak dilacak git → tidak tersentuh reset; akan diverifikasi setelah update."
    fi
  else
    if [[ ! -f "$DB" || -n "$RESTORE_NEEDED_HINT" ]]; then
      # WAL/SHM lama milik DB sebelumnya harus dibuang: cadangan VACUUM INTO sudah utuh
      rm -f "$DB-wal" "$DB-shm"
      cp -p "$BACKUP_FILE" "$DB"
      [[ -f "$BACKUP_FILE-wal" ]] && cp -p "$BACKUP_FILE-wal" "$DB-wal"
      [[ -f "$BACKUP_FILE-shm" ]] && cp -p "$BACKUP_FILE-shm" "$DB-shm"
      ok "database dipulihkan dari cadangan"
    else
      ok "database tidak tersentuh reset (tidak dilacak git)"
    fi
    SUMMARY_AFTER="$(db_summary "$DB")"
    print_summary "DB setelah update" "$SUMMARY_AFTER" || die "DB setelah update gagal integrity_check!"
    [[ "$SUMMARY_AFTER" == "$SUMMARY_BEFORE" ]] && ok "isi DB identik dengan sebelum update" \
      || warn "ringkasan isi DB berbeda dari cadangan — periksa! (cadangan: $BACKUP_FILE)"
  fi
fi

# =============================================================================
step "6/8 Pasang dependensi runtime"
run npm install --omit=dev --no-audit --no-fund

# =============================================================================
step "7/8 Jalankan ulang & cek kesehatan"
if [[ $NO_RESTART -eq 0 ]]; then
  run systemctl start "$SERVICE"
  SERVICE_STOPPED=0
  if [[ $DRY_RUN -eq 0 ]]; then
    if command -v curl >/dev/null 2>&1; then
      RUNNING=""
      for _ in $(seq 1 20); do
        sleep 1
        RUNNING="$(curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/api/version" 2>/dev/null \
          | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.data?.runtime?.commit||"")}catch{}})' || true)"
        [[ -n "$RUNNING" ]] && break
      done
      if [[ -z "$RUNNING" ]]; then
        warn "aplikasi belum menjawab di port $APP_PORT. Cek log: journalctl -u $SERVICE -n 50"
      elif [[ "$RUNNING" == "$NEW_COMMIT" ]]; then
        ok "aplikasi aktif, commit berjalan = target (${NEW_COMMIT:0:7})"
      else
        warn "aplikasi aktif tetapi commit berjalan ${RUNNING:0:7} ≠ target ${NEW_COMMIT:0:7}"
      fi
    else
      systemctl is-active --quiet "$SERVICE" && ok "layanan aktif" || warn "layanan tidak aktif — cek: journalctl -u $SERVICE -n 50"
    fi
  fi
else
  info "jalankan ulang aplikasi secara manual, mis.: npm start"
fi

# =============================================================================
step "8/8 Rapikan cadangan lama (simpan $KEEP terbaru)"
if [[ -d "$BACKUP_DIR" ]]; then
  mapfile -t OLD_BACKUPS < <(ls -1t "$BACKUP_DIR"/inventory-*.db 2>/dev/null | tail -n +"$((KEEP + 1))")
  if [[ ${#OLD_BACKUPS[@]} -gt 0 ]]; then
    for f in "${OLD_BACKUPS[@]}"; do run rm -f "$f" "$f-wal" "$f-shm"; done
  else
    info "tidak ada cadangan yang perlu dihapus."
  fi
fi

# ---------- pengingat keamanan ----------
if have_systemd_unit && [[ -z "$(unit_env AUTH_SECRET)" ]]; then
  echo
  warn "${B}AUTH_SECRET belum di-set di unit $SERVICE${N} — token login memakai kunci bawaan pengembangan."
  info "  tambahkan di [Service]: Environment=AUTH_SECRET=<string-acak-panjang>"
  info "  (buat dengan: openssl rand -hex 32), lalu: systemctl daemon-reload && systemctl restart $SERVICE"
fi

echo
if [[ $DRY_RUN -eq 1 ]]; then
  echo "${G}${B}Dry-run selesai.${N} Jalankan tanpa --dry-run untuk menerapkan update."
else
  echo "${G}${B}Update selesai:${N} ${OLD_COMMIT:0:7} → ${NEW_COMMIT:0:7}"
  [[ -f "$BACKUP_FILE" ]] && info "cadangan DB: $BACKUP_FILE"
fi
