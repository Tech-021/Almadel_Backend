# API changelog — performance pagination & slim payloads

Addresses stress failures from unbounded lists, fat dashboard/report JSON, and sequential CSV import/export.

## Breaking / contract changes

### List endpoints (always paginated)

| Endpoint | Default | Max | Response |
| --- | --- | --- | --- |
| `GET /customers` | `page=1`, `limit=50` | 100 | `{ customers, pagination, total, page, limit }` |
| `GET /customers/:id/history` | `page=1`, `limit=50` | 100 | `{ customer, sales, pagination }` |
| `GET /products` | `page=1`, `limit=50` | 250 | `{ products, pagination }` (`?legacy=1` → bare array) |
| `GET /admin/staff` | `page=1`, `limit=50` | 100 | `{ staff, pagination }` |
| `GET /logs` | `page=1`, `limit=50` | 100 | `{ logs, pagination, … }` |

`pagination` shape: `{ page, limit, total, totalPages }`.

### Dashboard

`GET /dashboard` returns summary metrics, recent sales (20), top 5 sellers, top 10 low-stock. Does **not** embed the full product catalog. Optional short TTL cache (~20s).

### Reports

- `GET /reports/products` — default last 30 days (`from`/`to`); max range 366 days; top-N best/least sellers; DB aggregates.
- `GET /reports/stock` — summary + capped low/out lists (50); not a full inventory dump.
- `GET /reports/sales` — summary aggregates; sale detail rows paginated (`page`/`limit`).

### Import / export

- `POST /products/import` — max **2000** rows per request (`413` above cap); batched create/update.
- `GET /products/export` — streamed CSV (chunked cursor).

### Auth

- Sign-up routes rate-limited (IP + email). Staff create rate-limited by IP.
- Stress API should set `AUTH_RATE_LIMIT_DISABLED=true`.
- `PASSWORD_HASH_ROUNDS` documents bcrypt cost (default 10).

## Frontend updates needed

1. Product list: read `body.products` (not a bare array) unless using `?legacy=1`.
2. Wire `page`/`limit` controls for customers, products, staff, logs.
3. Dashboard: stop assuming `products.length === catalog size`; use `inventoryValue` / `lowStockCount` / `lowStockProducts` when present.
4. Reports: pass `from`/`to` for wider windows; expect smaller `bestSelling` / `leastSelling` / stock lists.
5. Import UI: show max-rows message on 413.
