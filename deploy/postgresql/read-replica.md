# Read replica (PostgreSQL streaming)

Use a **read replica** to offload reports, dashboards, and paginated lists. Writes and checkout always use the **primary**.

## App configuration

In `.env`:

```env
# Primary (via PgBouncer for the app)
DATABASE_URL=postgresql://...@127.0.0.1:6432/almadel?pgbouncer=true&schema=public

# Direct primary (migrations only)
DATABASE_DIRECT_URL=postgresql://...@127.0.0.1:5432/almadel?schema=public

# Read replica (direct to replica host/port — not through PgBouncer transaction pool)
DATABASE_READ_URL=postgresql://...@<replica-host>:5432/almadel?schema=public
```

Code routes **`prismaRead`** to `DATABASE_READ_URL` for reports, dashboard, product/customer lists, activity log reads. If unset, reads use the primary.

Health: `GET /health/ready` → `readReplicaConfigured: true`, `db.read: up`.

## Same-server replica (lab / small VPS)

On the **primary** (`postgresql.conf`):

```ini
wal_level = replica
max_wal_senders = 5
max_replication_slots = 5
```

`pg_hba.conf` (example):

```
host replication replicator 127.0.0.1/32 scram-sha-256
```

Create replication user:

```sql
CREATE USER replicator WITH REPLICATION PASSWORD 'strong-password';
```

On a **second data directory** (example port 5433) or another VM, bootstrap standby:

```bash
sudo -u postgres pg_basebackup -h 127.0.0.1 -D /var/lib/postgresql/18/replica -U replicator -Fp -Xs -P -R
# Edit replica postgresql.conf: port = 5433, hot_standby = on
# Start second instance (distro-specific)
```

Point app:

```env
DATABASE_READ_URL=postgresql://almadel_app:...@127.0.0.1:5433/almadel?schema=public
```

Use a **read-only** DB role on the replica if you create a dedicated user.

## Production pattern

- Primary + replica on managed Postgres (RDS read replica, etc.), or primary on VPS + replica on second VPS.
- Run migrations only on **primary** (`DATABASE_DIRECT_URL` or `migrate-all-shards.sh`).
- Replica catches up via streaming; expect **small lag** (ms–s). Do not run checkout on replica.

## Verify replication

On primary:

```sql
SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn
FROM pg_stat_replication;
```

On replica:

```sql
SELECT pg_is_in_recovery();
-- should be true
```

## PgBouncer note

Configure PgBouncer **`almadel`** pool to primary only. App **`DATABASE_READ_URL`** connects **directly** to the replica (separate pool in Node).
