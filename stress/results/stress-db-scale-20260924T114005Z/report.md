# Almadel Database Scalability Report
**Report ID:** stress-db-scale-20260924T114005Z

## 1. Purpose

This report measures how database query cost and stock correctness change as Almadel data grows. Unlike a single snapshot against an already-full database, this run grows the stress dataset through checkpoints and measures the same queries at each size. That produces a scalability curve.

## 2. Bottom line

Checkpoints measured: **4**. PASS: **4**. WARNING: **0**. FAIL: **0**.

Across the measured sizes, query timings stayed inside pass thresholds and concurrent stock decrements remained correct.

## 3. How the test worked

For each checkpoint size, the suite grew businesses, team members, products, and stock logs to that size inside `almadel_stress`, then timed the same Prisma queries and ran a concurrent stock-decrement isolation check. API HTTP load was not part of this report.

Profile: **standard**. Worst-case business id: **7**.

## 4. Checkpoint summary

| Size | Businesses | Team | Products | Stock logs | Checkpoint grade | Isolation |
| ---: | ---: | ---: | ---: | ---: | --- | --- |
| 100 | 100 | 100 | 100 | 100 | PASS | PASS (5 writers) |
| 1000 | 1000 | 1000 | 1000 | 1000 | PASS | PASS (50 writers) |
| 5000 | 5000 | 5000 | 5000 | 5000 | PASS | PASS (50 writers) |
| 10000 | 10000 | 10000 | 10000 | 10000 | PASS | PASS (50 writers) |

## 5. Scalability curves

The tables below show how p95 latency changed as row counts increased. Rising p95 with size is expected for unbounded list queries. A sharp jump is more important than a small absolute number.

### list all products

| Dataset size | Avg | P95 | Rows | Grade |
| ---: | ---: | ---: | ---: | --- |
| 100 | 2 ms | 2 ms | 100 | PASS |
| 1000 | 3 ms | 5 ms | 1000 | PASS |
| 5000 | 19 ms | 23 ms | 5000 | PASS |
| 10000 | 31 ms | 34 ms | 10000 | PASS |

From size **100** to **10000**, p95 moved from **2 ms** to **34 ms** (about **17.0x**).

### list team members

| Dataset size | Avg | P95 | Rows | Grade |
| ---: | ---: | ---: | ---: | --- |
| 100 | 4 ms | 7 ms | 100 | PASS |
| 1000 | 8 ms | 9 ms | 1000 | PASS |
| 5000 | 44 ms | 47 ms | 5000 | PASS |
| 10000 | 88 ms | 93 ms | 10000 | PASS |

From size **100** to **10000**, p95 moved from **7 ms** to **93 ms** (about **13.3x**).

### owner business list

| Dataset size | Avg | P95 | Rows | Grade |
| ---: | ---: | ---: | ---: | --- |
| 100 | 5 ms | 8 ms | 101 | PASS |
| 1000 | 21 ms | 25 ms | 1001 | PASS |
| 5000 | 105 ms | 111 ms | 5001 | PASS |
| 10000 | 217 ms | 283 ms | 10001 | PASS |

From size **100** to **10000**, p95 moved from **8 ms** to **283 ms** (about **35.4x**).

### search products

| Dataset size | Avg | P95 | Rows | Grade |
| ---: | ---: | ---: | ---: | --- |
| 100 | 3 ms | 4 ms | 50 | PASS |
| 1000 | 2 ms | 3 ms | 50 | PASS |
| 5000 | 7 ms | 7 ms | 50 | PASS |
| 10000 | 14 ms | 16 ms | 50 | PASS |

From size **100** to **10000**, p95 moved from **4 ms** to **16 ms** (about **4.0x**).

### barcode lookup

| Dataset size | Avg | P95 | Rows | Grade |
| ---: | ---: | ---: | ---: | --- |
| 100 | 1 ms | 2 ms | 1 | PASS |
| 1000 | 1 ms | 1 ms | 1 | PASS |
| 5000 | 1 ms | 1 ms | 1 | PASS |
| 10000 | 1 ms | 1 ms | 1 | PASS |

From size **100** to **10000**, p95 moved from **2 ms** to **1 ms** (about **0.5x**).

### stock aggregate

| Dataset size | Avg | P95 | Rows | Grade |
| ---: | ---: | ---: | ---: | --- |
| 100 | 1 ms | 2 ms | 100 | PASS |
| 1000 | 1 ms | 2 ms | 1000 | PASS |
| 5000 | 2 ms | 2 ms | 5000 | PASS |
| 10000 | 3 ms | 4 ms | 10000 | PASS |

From size **100** to **10000**, p95 moved from **2 ms** to **4 ms** (about **2.0x**).

## 6. Isolation / inventory correctness during growth

At every checkpoint, many writers decremented the same product using conditional updates. Expected final stock had to equal starting stock minus successful decrements.

| Size | Writers | Successful | Expected stock | Actual stock | Result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 5 | 5 | 995 | 995 | PASS |
| 1000 | 50 | 50 | 950 | 950 | PASS |
| 5000 | 50 | 50 | 950 | 950 | PASS |
| 10000 | 50 | 50 | 950 | 950 | PASS |

## 7. What this proves

- Database query cost can be compared across growing dataset sizes.
- Stock isolation behavior was checked while the tenant was large, not only on a tiny sample.
- This is not an HTTP concurrency result. Use the API scalability report for request ramps.

## 8. Environment

- Date: 2026-09-24T11:40:05.948Z
- PostgreSQL: PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1) on x86_64-pc-linux-gnu
- Host: ubuntu-8gb-hel1-1
- Node: v22.23.1

