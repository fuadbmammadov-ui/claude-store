#!/bin/sh
set -e

echo "[entrypoint] Prisma migrate deploy başladılır..."
npx prisma migrate deploy

if [ "$RUN_STARTUP_SCRIPTS" = "true" ]; then
  echo "[entrypoint] RUN_STARTUP_SCRIPTS=true — seed.js işə salınır..."
  node prisma/seed.js || echo "[entrypoint] seed.js xəta ilə bitdi, davam edilir (idempotent skript)."

  echo "[entrypoint] RUN_STARTUP_SCRIPTS=true — import-legacy.js işə salınır..."
  node prisma/import-legacy.js || echo "[entrypoint] import-legacy.js xəta ilə bitdi, davam edilir (idempotent skript)."
else
  echo "[entrypoint] RUN_STARTUP_SCRIPTS aktiv deyil — seed/import-legacy skriptləri buraxılır."
fi

echo "[entrypoint] Tətbiq işə salınır: $@"
exec "$@"
