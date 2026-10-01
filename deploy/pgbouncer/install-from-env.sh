#!/usr/bin/env bash
# Apply PgBouncer settings from Almadel .env to /etc/pgbouncer/pgbouncer.ini
# Run as root: sudo bash deploy/pgbouncer/install-from-env.sh /var/www/Almadel_Backend/.env

set -euo pipefail

ENV_FILE="${1:-/var/www/Almadel_Backend/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

env_val() {
  node -e "
    require('dotenv').config({ path: process.argv[1], quiet: true });
    const k = process.argv[2];
    const v = process.env[k];
    if (v == null || v === '') process.exit(2);
    process.stdout.write(String(v));
  " "$ENV_FILE" "$1" 2>/dev/null || true
}

PG_HOST="$(env_val PGBOUNCER_HOST)"
PG_HOST="${PG_HOST:-127.0.0.1}"
PG_PORT="$(env_val PGBOUNCER_PORT)"
PG_PORT="${PG_PORT:-6432}"
PG_DB="$(env_val PGBOUNCER_DATABASE)"
PG_DB="${PG_DB:-almadel}"
PG_BACKEND_HOST="$(env_val PGBOUNCER_BACKEND_HOST)"
PG_BACKEND_HOST="${PG_BACKEND_HOST:-127.0.0.1}"
PG_BACKEND_PORT="$(env_val PGBOUNCER_BACKEND_PORT)"
PG_BACKEND_PORT="${PG_BACKEND_PORT:-5432}"
MAX_CLIENT="$(env_val PGBOUNCER_MAX_CLIENT_CONN)"
MAX_CLIENT="${MAX_CLIENT:-2000}"
DEFAULT_POOL="$(env_val PGBOUNCER_DEFAULT_POOL_SIZE)"
DEFAULT_POOL="${DEFAULT_POOL:-25}"
MIN_POOL="$(env_val PGBOUNCER_MIN_POOL_SIZE)"
MIN_POOL="${MIN_POOL:-5}"
RESERVE_POOL="$(env_val PGBOUNCER_RESERVE_POOL_SIZE)"
RESERVE_POOL="${RESERVE_POOL:-5}"

DB_USER="$(node -e "
  require('dotenv').config({ path: process.argv[1], quiet: true });
  const direct = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL || '';
  try { process.stdout.write(decodeURIComponent(new URL(direct).username)); } catch { process.exit(1); }
" "$ENV_FILE")"

INI="/etc/pgbouncer/pgbouncer.ini"
USERLIST="/etc/pgbouncer/userlist.txt"

if [[ ! -f "$INI" ]]; then
  echo "Install pgbouncer package first (apt install pgbouncer)." >&2
  exit 1
fi

upsert_ini() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key} = " "$INI"; then
    sed -i "s|^${key} = .*|${key} = ${value}|" "$INI"
  elif grep -qE "^;${key} = " "$INI"; then
    sed -i "s|^;${key} = .*|${key} = ${value}|" "$INI"
  else
    printf '\n%s = %s\n' "$key" "$value" >> "$INI"
  fi
}

if grep -qE '^almadel = ' "$INI"; then
  sed -i "s|^almadel = .*|almadel = host=${PG_BACKEND_HOST} port=${PG_BACKEND_PORT} dbname=${PG_DB}|" "$INI"
else
  sed -i "/^\[databases\]/a almadel = host=${PG_BACKEND_HOST} port=${PG_BACKEND_PORT} dbname=${PG_DB}" "$INI"
fi

upsert_ini "listen_addr" "${PG_HOST}"
upsert_ini "listen_port" "${PG_PORT}"
upsert_ini "auth_type" "scram-sha-256"
upsert_ini "auth_file" "${USERLIST}"
upsert_ini "pool_mode" "transaction"
upsert_ini "max_client_conn" "${MAX_CLIENT}"
upsert_ini "default_pool_size" "${DEFAULT_POOL}"
upsert_ini "min_pool_size" "${MIN_POOL}"
upsert_ini "reserve_pool_size" "${RESERVE_POOL}"
upsert_ini "ignore_startup_parameters" "extra_float_digits,search_path,application_name"

if [[ -n "${DB_USER}" ]]; then
  sudo -u postgres psql -tAc "SELECT '\"' || usename || '\" \"' || passwd || '\"' FROM pg_shadow WHERE usename='${DB_USER}';" > "${USERLIST}.tmp"
  mv "${USERLIST}.tmp" "${USERLIST}"
  chown postgres:postgres "${USERLIST}"
  chmod 640 "${USERLIST}"
fi

systemctl restart pgbouncer
systemctl is-active --quiet pgbouncer && echo "PgBouncer active on ${PG_HOST}:${PG_PORT} -> ${PG_BACKEND_HOST}:${PG_BACKEND_PORT}/${PG_DB}"
