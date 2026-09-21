# Database Stress Test Report

**Date:** 2026-09-18  
**Application:** Almadel Backend  
**Database tested:** `almadel_stress` (PostgreSQL 18.6)  
**Production database:** `almadel` (not used for these database queries or test writes)

## Objective

Establish a database query-performance baseline with 30,000 synthetic product records and inspect PostgreSQL query plans for common product lookups and searches.

## Test setup

- Applied the backend Prisma migrations to the separate `almadel_stress` database.
- Added 30,000 synthetic products under business ID `1` using `npm run db:stress:seed`.
- Verified `current_database()` returned `almadel_stress` and the product count was `30,000`.
- Ran `ANALYZE products` before measuring query plans.
- Queries were run with PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)`.

The dataset contains 30,000 products for **one synthetic business**. It does not yet contain synthetic sales, customers, or ledger activity.

## Results

### Exact barcode lookup

Query filtered by `businessId` and an exact barcode. PostgreSQL used the composite business/barcode index (`Index Cond` included both predicates).

| Measure | Result |
|---|---:|
| Rows returned | 1 |
| Execution time | 0.254 ms |
| Shared buffers hit | 3 |
| Index searches | 1 |

**Finding:** The exact barcode lookup used an index and completed quickly in this test.

### Product listing by name

Query filtered to business ID `1`, sorted by product name, and limited to 50 rows. PostgreSQL used `products_name_idx`; it applied `businessId = 1` as a filter and did not need a separate sort step.

| Measure | Result |
|---|---:|
| Rows returned | 50 |
| Execution time | 0.139 ms |
| Shared buffers hit | 4 |
| Plan | Index scan on `products_name_idx`, then business filter |

**Finding:** This listing was fast for the one-business dataset. Because all 30,000 rows belong to that business, this test does not show how the plan behaves when products from many businesses share the table.

### Substring search with no matches

Query used `ILIKE '%definitely-no-such-string%'` across product name, category, barcode, SKU, and QR code, matching the backend's contains-style search shape. Before adding trigram indexes, PostgreSQL performed a sequential scan and sort.

| Measure | Result |
|---|---:|
| Rows returned | 0 |
| Rows removed by filter | 30,000 |
| Execution time | 111.650 ms |
| Shared buffers hit | 667 |
| Plan | Sequential scan, followed by sort |

**Finding:** This no-match substring search examined every product. The 667 shared buffer hits indicate the blocks were in PostgreSQL's shared cache during this run; this is a warm-cache measurement.

## Indexes added for follow-up comparison

In `almadel_stress` only, the `pg_trgm` extension and these GIN indexes were created successfully:

- `stress_products_name_trgm_idx`
- `stress_products_category_trgm_idx`
- `stress_products_barcode_trgm_idx`
- `stress_products_sku_trgm_idx`
- `stress_products_qrcode_trgm_idx`

`ANALYZE products` was run after creating them. The same substring-search `EXPLAIN (ANALYZE, BUFFERS)` query has **not yet been rerun**, so there is no measured before/after result. Do not treat the indexes as a production recommendation until their read benefit and write/storage costs have been measured.

## Scope not covered

This session did not test:

- Concurrent users, connections, requests, or operations per second.
- API-level Prisma latency or full HTTP response serialization.
- Checkout idempotency, concurrent stock updates, or business transaction correctness.
- Query performance with multi-business, sales, customer, or ledger datasets.
- WebSockets or Socket.IO. Socket.IO is not currently implemented in the backend.
- Trigram-index performance after index creation.

## Recommended next steps

1. Rerun the exact same substring-search query and compare plan, execution time, and buffers with the pre-index baseline.
2. Test a matching search term as well as a no-match term; note that the current synthetic category and name values are repetitive.
3. Build a multi-business dataset and repeat the listing/search tests to evaluate tenant filtering.
4. Add synthetic sales, customers, and ledger records before benchmarking those API paths.
5. Measure write cost and index size before deciding whether any trigram index belongs in production.
6. After database query baselines are complete, run staged HTTP/Prisma load tests. Test Socket.IO separately after its server implementation exists.

## Application status after testing

The `almadel-api` PM2 process was restarted against its original application environment after the stress seed work. It was reported online, and `http://127.0.0.1:4000/health` returned `{"ok":true}`.
