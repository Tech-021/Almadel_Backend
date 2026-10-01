# PgBouncer (systemd) — Almadel

PgBouncer runs under **systemctl**, not PM2. The Node app connects via `DATABASE_URL` (port **6432**).

## Env vars (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | App → PgBouncer (`pgbouncer=true` in query string) |
| `DATABASE_DIRECT_URL` | — | Migrations / `prisma migrate` → Postgres **5432** |
| `PGBOUNCER` | `true` | App flag when using pooler |
| `DB_POOL_MAX` | `10` | node-pg pool size **per** API process |
| `DB_POOL_IDLE_MS` | `30000` | Client pool idle timeout |
| `DB_POOL_CONNECT_MS` | `10000` | Client connect timeout |
| `PGBOUNCER_HOST` | `127.0.0.1` | PgBouncer listen address (install script) |
| `PGBOUNCER_PORT` | `6432` | PgBouncer listen port |
| `PGBOUNCER_DATABASE` | `almadel` | Logical database name in `[databases]` |
| `PGBOUNCER_BACKEND_HOST` | `127.0.0.1` | Real Postgres host |
| `PGBOUNCER_BACKEND_PORT` | `5432` | Real Postgres port |
| `PGBOUNCER_MAX_CLIENT_CONN` | `2000` | Max client connections to PgBouncer |
| `PGBOUNCER_DEFAULT_POOL_SIZE` | `25` | Server connections per db/user pool |
| `PGBOUNCER_MIN_POOL_SIZE` | `5` | Warm pool |
| `PGBOUNCER_RESERVE_POOL_SIZE` | `5` | Burst reserve |

**Sizing:** With one API process and `DB_POOL_MAX=10`, PgBouncer `default_pool_size=25` is plenty. With PM2 cluster (`PM2_INSTANCES=2`), aim for `2 × DB_POOL_MAX ≤ default_pool_size` (plus margin for admin tools).

## Apply config from `.env`

```bash
sudo bash /var/www/Almadel_Backend/deploy/pgbouncer/install-from-env.sh /var/www/Almadel_Backend/.env
```

Then restart the API (load `.env` into PM2):

```bash
cd /var/www/Almadel_Backend
node -e "require('dotenv').config({path:'.env',override:true}); require('child_process').spawnSync('pm2',['restart','almadel-backend','--update-env'],{stdio:'inherit',env:process.env})"
```

## Migrations

```bash
DATABASE_URL="$DATABASE_DIRECT_URL" npx prisma migrate deploy
```

## Checks

```bash
systemctl status pgbouncer
curl -sS http://127.0.0.1:4001/health/ready
```
