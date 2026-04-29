#!/bin/sh
set -e

PRISMA="node /app/node_modules/prisma/build/index.js"

if [ -d /app/prisma/migrations ] && [ -n "$(ls -A /app/prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] running prisma migrate deploy..."
  $PRISMA migrate deploy
else
  echo "[entrypoint] no migrations present, running prisma db push..."
  $PRISMA db push --skip-generate --accept-data-loss
fi

echo "[entrypoint] starting Next.js..."
exec node server.js
