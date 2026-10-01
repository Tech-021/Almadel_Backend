#!/usr/bin/env bash
# Run Prisma migrations on primary + optional extra shards (direct Postgres, not PgBouncer).
# Usage: bash deploy/sharding/migrate-all-shards.sh [/var/www/Almadel_Backend/.env]

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${1:-$ROOT/.env}"
cd "$ROOT"

migrate_url() {
  local label="$1"
  local url="$2"
  echo "==> migrate deploy ($label)"
  DATABASE_URL="$url" npx prisma migrate deploy
}

DIRECT_URL="$(node -e "
  require('dotenv').config({ path: process.argv[1], quiet: true });
  const direct = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
  if (!direct) throw new Error('DATABASE_DIRECT_URL or DATABASE_URL required');
  process.stdout.write(direct);
" "$ENV_FILE")"

migrate_url "shard-0-primary" "$DIRECT_URL"

SHARD_COUNT="$(node -e "
  require('dotenv').config({ path: process.argv[1], quiet: true });
  process.stdout.write(String(Number(process.env.SHARD_COUNT || 1)));
" "$ENV_FILE")"

for ((i=1; i<SHARD_COUNT; i++)); do
  SHARD_URL="$(node -e "
    require('dotenv').config({ path: process.argv[1], quiet: true });
    const i = process.argv[2];
    const k = 'DATABASE_SHARD_' + i + '_URL';
    const v = process.env[k];
    if (!v) { console.error('Missing ' + k); process.exit(1); }
    process.stdout.write(v);
  "$ENV_FILE" "$i")"
  migrate_url "shard-$i-primary" "$SHARD_URL"
done

echo "All shard migrations complete."
