# Database sharding (optional)

Sharding splits **tenant data** across multiple PostgreSQL databases. Default **`SHARD_COUNT=1`** (single DB — no behavior change).

## Routing rules

| Data | Database |
| --- | --- |
| Users, sign-in, `business_members` lookup | **Shard 0** (`DATABASE_URL`) |
| Tenant operations after `requireBusiness` | Shard `businessId % SHARD_COUNT` |

When `SHARD_COUNT > 1`, set:

```env
SHARD_COUNT=2
DATABASE_URL=postgresql://...@primary-shard0/almadel?...
DATABASE_SHARD_1_URL=postgresql://...@primary-shard1/almadel?...

# Optional read replica per shard
DATABASE_READ_URL=postgresql://...@replica0/almadel?...
DATABASE_SHARD_1_READ_URL=postgresql://...@replica1/almadel?...
```

New businesses are assigned by **`businessId % SHARD_COUNT`** once created (IDs are global; plan capacity per shard).

## Migrations

Run on **every** shard primary (direct URL, not PgBouncer):

```bash
bash deploy/sharding/migrate-all-shards.sh /var/www/Almadel_Backend/.env
```

## Moving a business to another shard

Not automated in v1. Requires export/import or logical replication per business. Prefer increasing **vertical scale + read replicas** before sharding.

## Health

`GET /health/ready` with `SHARD_COUNT>1` returns a `shards[]` array with primary/read status per shard.

## When to shard

- Single primary exhausts **write** IOPS/connections after PgBouncer, vertical scale, and read replicas.
- Not a substitute for pagination, indexes, or API horizontal scale.

See also `docs/SCALING.md`.
