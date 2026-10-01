# Redis (complement to PostgreSQL)

Redis is used by `almadel-backend` as a **complement** to PostgreSQL — never as a durable store for business data.

## Roles

| Concern | Store |
| --- | --- |
| Sales, stock, payments, ledger, balances | **PostgreSQL only** |
| Socket.IO fan-out across connections/processes | Redis adapter |
| Dashboard / reports soft read cache | Redis (fallback: in-memory) |
| Payment idempotency early hint | Redis (Postgres remains authoritative) |

## Enable / disable

```env
REDIS_URL=redis://127.0.0.1:6379
ENABLE_REDIS=true
REDIS_KEY_PREFIX=almadel:
```

- `ENABLE_REDIS=false` (or unset) → Socket.IO uses in-memory adapter; caches use process memory only.
- API **must boot** even if Redis is down. Failures are logged and ignored for request success.

## Key patterns

Prefix defaults to `almadel:`.

| Pattern | TTL | Purpose |
| --- | --- | --- |
| `almadel:cache:dashboard:admin:{businessId}` | ~20s | Admin dashboard |
| `almadel:cache:dashboard:my:{businessId}:{userId}` | ~20s | Staff dashboard |
| `almadel:cache:report:products:{businessId}:{from}:{to}:{top}` | ~45s | Product report |
| `almadel:cache:report:stock:{businessId}` | ~45s | Stock report |
| `almadel:idem:payment:{businessId}:{key}` | 24h | Idempotency hint |

TTL overrides:

```env
REDIS_CACHE_TTL_DASHBOARD_MS=20000
REDIS_CACHE_TTL_REPORTS_MS=45000
```

## Invalidation

After checkout, stock add/receive, payment, and expense create, soft caches for that `businessId` are busted best-effort. Short TTL remains the safety net.

## Fallback

1. Redis enabled + healthy → use Redis  
2. Redis disabled / down / timeout → in-memory Map for cache; Socket.IO in-memory adapter  

## Ops

Restart with live env loaded into the shell (avoid stale PM2 stress env):

```bash
cd /var/www/Almadel_Backend
node -e "require('dotenv').config({path:'.env',override:true}); require('child_process').spawnSync('pm2',['restart','almadel-backend','--update-env'],{stdio:'inherit',env:process.env})"
pm2 save
```

Look for: `Socket.IO Redis adapter enabled` and `Redis connected`.

Health: `curl -sS http://127.0.0.1:4001/health`
