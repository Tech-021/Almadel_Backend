# Almadel scaling rollout (pooling → replica → vertical → horizontal → Elasticsearch)

This document matches the implementation in this repo. Apply **in order** on the server; each phase has a gate before the next.

---

## Phase 1 — Connection pooling (PgBouncer + app pool limits)

**Goal:** Many API processes share a bounded number of Postgres connections.

### App (done in code)

- `db.js` uses `node-pg` `Pool` with `DB_POOL_MAX` (default **10** per process).
- Formula: `Postgres max_connections ≥ (PM2 instances × DB_POOL_MAX) + admin headroom`.

### Server

1. Install PgBouncer (`deploy/pgbouncer/pgbouncer.ini` template).
2. Point **`DATABASE_URL`** at PgBouncer:  
   `postgresql://USER:PASS@127.0.0.1:6432/almadel?pgbouncer=true`
3. Run **migrations on direct Postgres** (not through transaction pool):

```bash
cd /var/www/Almadel_Backend
DATABASE_URL="$DATABASE_DIRECT_URL" npx prisma migrate deploy
```

Set `DATABASE_DIRECT_URL` to `127.0.0.1:5432` (real Postgres).

### Env

```env
DB_POOL_MAX=10
DB_POOL_IDLE_MS=30000
DB_POOL_CONNECT_MS=10000
PGBOUNCER=true
DATABASE_DIRECT_URL=postgresql://...@127.0.0.1:5432/almadel
```

**Gate:** `/health/ready` → `db.primary: up`; no `too many connections` in logs under stress.

---

## Phase 2 — Read replica

See **`deploy/postgresql/read-replica.md`**. Set `DATABASE_READ_URL` on the app; code already uses `prismaRead` for reports, dashboard, lists, log reads.

## Phase 2b — Sharding (optional)

See **`deploy/sharding/README.md`**. Set `SHARD_COUNT` and `DATABASE_SHARD_n_URL`. Tenant routes auto-route via `requireBusiness` + `businessId % SHARD_COUNT`. Auth stays on shard 0.

## Phase 3 — Vertical scale (Postgres / VM)

**Goal:** More CPU, RAM, and IOPS on one primary (and replica).

- Resize VPS or move to managed Postgres (RDS, Supabase, etc.).
- Apply `deploy/postgresql/tuning.conf.example` with your DBA.
- Re-run `npm run stress:db:scale` and gap suites; record p95.

**Gate:** Checkout and product list p95 within SLO under target concurrency.

---

## Phase 4 — Horizontal API scale

**Goal:** Multiple Node workers behind Nginx; shared Redis for Socket.IO + rate limits.

### App (done in code)

- `ecosystem.config.js` — PM2 **cluster** (`PM2_INSTANCES`, default 2).
- Redis rate limit store when `ENABLE_REDIS=true` (disable with `AUTH_RATE_LIMIT_REDIS=false`).
- `/health/live` — liveness; `/health/ready` — DB (+ Redis if enabled).
- Socket.IO Redis adapter (already in `modules/realtime/socket.js`).

### Server

```bash
cd /var/www/Almadel_Backend
PM2_INSTANCES=2 pm2 start ecosystem.config.js --update-env
pm2 save
```

Optional Nginx upstream (multiple ports) — see `nginx/almadel-backend-lb.conf.example`.

**Gate:** `stress:all` / gap suites pass with `PM2_INSTANCES≥2`; no auth rate-limit bypass across workers.

---

## Phase 5 — Elasticsearch (optional search)

**Goal:** Faster full-text product search across large catalogs; Postgres remains source of truth.

### Env

```env
ELASTICSEARCH_URL=https://your-es-host:9200
ELASTICSEARCH_API_KEY=
ELASTICSEARCH_PRODUCTS_INDEX=almadel-products
```

### App

- `modules/search/elasticsearch.js` — search helper; **falls back to Postgres** if ES is down or unset.
- Wire indexing (sync job / queue) is a follow-up when ES cluster exists.

**Gate:** Product search works with ES off (Postgres) and with ES on (A/B latency).

---

## Sharding (future — not in this rollout)

If a single primary exhausts **write** throughput after phases 1–4, shard by `businessId`. That is a separate design; do not shard before measuring primary limits.

---

## Quick reference

| Env | Purpose |
| --- | --- |
| `DB_POOL_MAX` | PG pool size per Node process |
| `DATABASE_READ_URL` | Read replica (optional) |
| `DATABASE_DIRECT_URL` | Direct Postgres for migrations when using PgBouncer |
| `PM2_INSTANCES` | Cluster worker count |
| `AUTH_RATE_LIMIT_REDIS` | Set `false` to keep in-memory limits (single instance only) |
| `ELASTICSEARCH_URL` | Enable ES search complement |
