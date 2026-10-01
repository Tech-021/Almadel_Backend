# Almadel performance work — brief for leadership

**What we did:** Fixed the slowdowns that showed up in stress testing when a shop has a large catalog (~10k products/customers) and many people hit the API at once.

**Bottom line:** The app was failing because it was sending *too much data* on every request. We stopped dumping full tables into JSON, added pagination and smarter database queries, and retested. The previously failing screens now pass under normal concurrent load. Separately, we confirmed the server itself still has a hard ceiling around ~1,000 simultaneous users on this machine — that is capacity, not a leftover “return 10,000 rows” bug.

---

## The problem (in plain terms)

Stress reports showed:

1. **List screens** (customers, products, staff) returned *everything* — thousands of rows, multi‑megabyte responses. At 50–100 concurrent users, latency jumped to several seconds and stages failed.
2. **Dashboard** embedded huge product/history payloads (~3.6 MB). Same failure pattern once history grew.
3. **Reports** (products/stock) loaded the full catalog into Node to “aggregate,” then sent it back — again ~3 MB and timeouts under concurrency.
4. **CSV import** did one database round‑trip per row; **export** built one giant string in memory.
5. **Sign-up / staff create** was slow under heavy concurrency mainly because of password hashing (CPU), not SQL — we hardened that path with rate limits and non-blocking email.

This was a **single-shop scale** problem (one business with large data), not “10,000 businesses × 10,000 staff.”

---

## Techniques we applied

### 1. Pagination by default
Every major list now returns a **page** of results (typically 50 rows, hard caps so clients cannot ask for 10,000). Responses include simple pagination metadata (`page`, `limit`, `total`, `totalPages`).

**Why it helps:** The UI and API never transfer megabytes of unused rows. Concurrent readers stay fast because each request is small.

### 2. Slim payloads (send summaries, not dumps)
- **Dashboard:** metrics + “top N” sellers / low-stock items + a short recent-sales list. No full product catalog.
- **My businesses:** only the fields the client needs for one membership (one-business-per-user model).
- **Staff list:** slim user fields + stats for the current page only.

**Why it helps:** Less JSON to build, serialize, and download — especially under concurrency.

### 3. Database aggregation instead of “load all, then count in Node”
Reports for products and stock now use **SQL / Prisma aggregates** (group by, sums, counts) with a **default 30-day window** (wider ranges only when explicitly requested, capped at ~1 year). Sales reports keep a fast summary and paginate the detail lines.

**Why it helps:** Postgres does the heavy math close to the data. Node no longer holds 10k product objects just to compute a chart.

### 4. Short in-memory caching
Dashboard and heavy reports cache per-business results for a few dozen seconds.

**Why it helps:** Bursts of identical refreshes (many tabs / concurrent users) hit memory instead of repeating the same expensive queries.

### 5. Indexes on hot filters
Added composite indexes such as `(businessId, createdAt)` on sales/products/logs and `(businessId, name)` on customers — matching how list and report queries actually filter and sort.

**Why it helps:** Paginated “newest first” and date-bounded reports use index scans instead of scanning whole tables.

### 6. Streamed export + batched import
- **Export:** write CSV in chunks as rows are read (no one giant buffer).
- **Import:** max 2,000 rows per request; look up existing barcodes once; create/update in batches.

**Why it helps:** Large catalogs no longer risk memory spikes or multi-minute sequential loops.

### 7. Auth / onboarding hardening
Rate-limit sign-up and staff create; send credential email **after** the response (don’t block on SMTP); only call Stripe for real subscription IDs (ignore fake stress/load-test IDs).

**Why it helps:** Protects the API from signup stampedes and removes noisy Stripe errors during load tests.

### 8. Tenant safety unchanged
Every query still scopes to the member’s business. No global “admin bypass.” We did **not** redesign into multi-business nesting.

---

## What improved after the changes

Retests were run against the stress database (`almadel_stress`) with the **new API process** loaded (an older process on port 4010 initially still served the old report code — after restart, reports passed).

### Lists & dashboard (the original “FAIL” stories)

| What we measure | Before | After |
| --- | --- | --- |
| Customer list @ 50 concurrent users | ~10,000 rows, multi‑second / FAIL | 50 rows, ~170 ms, **PASS** |
| Product list @ 50 | ~3.5 MB / FAIL | ~22 KB, ~100 ms, **PASS** |
| Staff list @ 50 | ~2 MB / FAIL | Slim page, ~100 ms, **PASS** |
| Dashboard under large history @ 100 | ~3.6 MB / FAIL | ~100 KB class payload, **PASS** |
| Activity logs @ 100 | FAIL (~3 s p95) | **PASS** (~200 ms class) |

Gap “list growth” and “history” suites: previously heavy FAIL → **all stages PASS** in the Sep 29 retest batch.

### Reports (worst previous failures)

| Report | Before | After |
| --- | --- | --- |
| Products report @ 50–100 concurrent | ~3 MB, 5–10 s / timeouts / FAIL | ~16 KB, ~50–130 ms, **PASS** |
| Stock report @ 50–100 | Same pattern / FAIL | ~15 KB, **PASS** |

Roughly a **~200× smaller** response and out of the failure band for standard concurrency.

### Full standard retest (after restart)

Customers, reports, reads, and gap suites on Sep 29: **every measured stage PASS** at the previous “standard” concurrency levels (up to 100, and gap high-concurrency up to 300).

---

## What we deliberately stress-tested beyond that

We also pushed **1,000 → 10,000 simultaneous clients** on this 4‑CPU / 8 GB server.

- Around **1,000**: still serving, but slower (warnings).
- Around **2,500+**: latency exceeds our pass bar.
- Around **5,000–10,000**: many timeouts/errors — the single Node process saturates.

**Lead takeaway:** We fixed the “return the whole database” class of bugs. Handling tens of thousands of *simultaneous* users would need more infrastructure (more API instances, load balancer, etc.), not more pagination.

---

## How to talk about this in one paragraph

> Stress tests showed Almadel was shipping full catalogs and fat dashboards/reports, so concurrent users timed out. We paginated lists, slimmed dashboard/report payloads, moved aggregations into SQL, added indexes, streamed CSV export and batched import, and rate-limited signup. Retests on the stress environment now pass the stages that previously failed. Separately, a 10k-client probe shows this host’s concurrent ceiling is about a thousand users — a capacity topic, not an unbounded-list bug.

---

## Where to look for detail

| Item | Location |
| --- | --- |
| API shape changes for frontend | `docs/API_PAGINATION_CHANGELOG.md` |
| Passing retest pack | `stress/results/stress-20260929T134738Z` (customers), `…134742Z` (reports), `…134746Z` (reads), `gap-20260929T134749Z` |
| 10k concurrency probe | `stress/results/gap-20260929T143758Z/high-concurrency/` |
| Earlier FAIL baselines | `stress/results/gap-20260924T135037Z/` (list-growth / history) |
