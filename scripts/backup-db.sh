#!/bin/sh
# Neon PostgreSQL-dən gündəlik backup (yalnız oxuma, prod DB-yə heç bir yazı etmir).
# VM-də cron ilə işə salınması tövsiyə olunur, məsələn:
#   0 3 * * * /opt/magaza-pos/scripts/backup-db.sh >> /opt/magaza-pos/backups/backup.log 2>&1
set -e

if [ -z "$DATABASE_URL" ]; then
  if [ -f "$(dirname "$0")/../.env" ]; then
    set -a
    . "$(dirname "$0")/../.env"
    set +a
  fi
fi

if [ -z "$DATABASE_URL" ]; then
  echo "[backup-db] DATABASE_URL tapılmadı, dayandırılır." >&2
  exit 1
fi

BACKUP_DIR="$(dirname "$0")/../backups"
mkdir -p "$BACKUP_DIR"

STAMP=$(date +%F_%H%M%S)
FILE="$BACKUP_DIR/magaza-pos-$STAMP.sql.gz"

echo "[backup-db] Backup başladı: $FILE"
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$FILE"
echo "[backup-db] Backup tamamlandı: $FILE"

# 14 gündən köhnə backup-ları sil
find "$BACKUP_DIR" -name 'magaza-pos-*.sql.gz' -mtime +14 -delete
echo "[backup-db] Köhnə backup-lar (14+ gün) təmizləndi."
