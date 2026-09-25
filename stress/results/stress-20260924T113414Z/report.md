# Almadel API stress report stress-20260924T113414Z

## Executive Summary

- Overall for this API run: one or more stages crossed fail thresholds, or an inventory check did not match. See the stop conditions and stage tables below.
- This is an **API request scalability** report. It measures real HTTP traffic against the stress API. It is not the database growth-curve report.
- Profile used: **standard**. Base URL: http://127.0.0.1:4010.
- Highest concurrency exercised in a completed stage: **100**.
- Highest concurrency that still graded PASS: **100**.
- 11 stage(s) graded WARNING (slower or noisier, but not a hard fail).
- Ramp stopped 1 time(s). First stop: **business-create** at concurrency **50** because p95 6369ms exceeded 5000ms. That stop point is useful evidence of where request scalability begins to degrade for that operation.
- Inventory correctness checks matched expected stock under the concurrent update cases that ran.
- How to read the grades: PASS means error rate under 1% and p95 under 1s. WARNING means error rate 1–5% or p95 1–3s. FAIL means error rate above 5%, p95 above 3s, or a data-integrity failure. The ramp also stops early if error rate exceeds the configured max or p95 exceeds 5s.

## What this report tested

- This run sent real HTTP requests to the Almadel stress API.
- Business creation used owner sign-up plus `POST /business/setup`.
- Team creation used `POST /admin/staff` for staff and accountant roles on one business.
- Product and stock suites used the live product and inventory endpoints.
- Mixed traffic combined reads and writes to approximate normal usage.
- Concurrency was ramped in stages. If a stage became unhealthy, later stages for that suite were skipped.

## Environment

- Date: 2026-09-24T11:34:14.795Z
- Profile: standard
- Base URL: http://127.0.0.1:4010
- Git: 4bbff74
- Node: v22.23.1
- Host: ubuntu-8gb-hel1-1 (linux 7.0.0-27-generic)
- CPUs: 4
- Memory free / total MB: 3664 / 7746
- PostgreSQL: PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1) on x86_64-pc-linux-gnu
- Database connections (active/idle/total): 3 / 2 / 5
- Cache hit ratio: 1
- Deadlocks counter: 0

- PM2: almadel-api online restarts 362245 cpu 0.2 mem 72mb; almadel-backend online restarts 11 cpu 0.2 mem 163mb

## Dataset

- stress businesses: 11190
- stress memberships: 22486
- stress products: 11636
- stress stock logs: 12030

## Business API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 10 | 100 | 100 | 0 | 10 | 998 | 1249 | 1704 | WARNING |
| 500 | 25 | 400 | 400 | 0 | 10.54 | 2371 | 2948 | 4057 | WARNING |
| 1000 | 50 | 500 | 494 | 6 | 10.67 | 4682 | 6369 | 8347 | FAIL |

Average time inside the business flow is split below. Signup includes password hashing. Setup is the business transaction.

- Stage 100: signup 452 ms, setup 546 ms
- Stage 500: signup 992 ms, setup 1379 ms
- Stage 1000: signup 1959 ms, setup 2723 ms

## Team-Member API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 10 | 100 | 100 | 0 | 10.72 | 933 | 1024 | 1119 | WARNING |
| 1000 | 25 | 900 | 900 | 0 | 10.74 | 2325 | 2572 | 2760 | WARNING |
| GET /admin/staff | 1 | 1 | 1 | 0 | 31.99 | 30 | 30 | 30 | PASS |
| GET /admin/staff | 10 | 10 | 10 | 0 | 52.46 | 151 | 188 | 188 | PASS |
| GET /admin/staff | 50 | 50 | 50 | 0 | 61.23 | 739 | 809 | 812 | PASS |
| GET /admin/staff | 100 | 100 | 100 | 0 | 59.66 | 1486 | 1660 | 1665 | WARNING |

### Stage 100 by role

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| staff | 10 | 50 | 50 | 0 | 0 | 934 | 1021 | 1049 |  |
| accountant | 10 | 50 | 50 | 0 | 0 | 931 | 1106 | 1189 |  |

### Stage 1000 by role

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| staff | 25 | 450 | 450 | 0 | 0 | 2326 | 2576 | 2801 |  |
| accountant | 25 | 450 | 450 | 0 | 0 | 2323 | 2568 | 2719 |  |

## Product API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 10 | 100 | 100 | 0 | 548.77 | 17 | 23 | 27 | PASS |
| 1000 | 25 | 900 | 900 | 0 | 645.19 | 38 | 51 | 72 | PASS |
| GET /products | 1 | 1 | 1 | 0 | 43.21 | 22 | 22 | 22 | PASS |
| GET /products | 10 | 10 | 10 | 0 | 59.11 | 103 | 167 | 167 | PASS |
| GET /products | 50 | 50 | 50 | 0 | 57.01 | 463 | 835 | 871 | PASS |
| GET /products | 100 | 100 | 100 | 0 | 62.09 | 848 | 1528 | 1590 | WARNING |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 127.17 | 8 | 8 | 8 | PASS |
| GET /products/search?q=Loadtest | 10 | 10 | 10 | 0 | 359.57 | 22 | 27 | 27 | PASS |
| GET /products/search?q=Loadtest | 50 | 50 | 50 | 0 | 413.69 | 90 | 117 | 118 | PASS |
| GET /products/search?q=Loadtest | 100 | 100 | 100 | 0 | 455.18 | 157 | 210 | 213 | PASS |
| GET /products/barcode/LOADTEST-STOCK-1863-000001 | 1 | 1 | 1 | 0 | 224.59 | 4 | 4 | 4 | PASS |
| GET /products/barcode/LOADTEST-STOCK-1863-000001 | 10 | 10 | 10 | 0 | 614.53 | 14 | 16 | 16 | PASS |
| GET /products/barcode/LOADTEST-STOCK-1863-000001 | 50 | 50 | 50 | 0 | 626.73 | 68 | 74 | 74 | PASS |
| GET /products/barcode/LOADTEST-STOCK-1863-000001 | 100 | 100 | 100 | 0 | 758.48 | 113 | 125 | 125 | PASS |
| GET /products | 1 | 1 | 1 | 0 | 37.12 | 25 | 25 | 25 | PASS |
| GET /products | 10 | 10 | 10 | 0 | 61.12 | 94 | 161 | 161 | PASS |
| GET /products | 50 | 50 | 50 | 0 | 54.6 | 486 | 865 | 912 | PASS |
| GET /products | 100 | 100 | 100 | 0 | 54.33 | 980 | 1750 | 1815 | WARNING |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 129.24 | 8 | 8 | 8 | PASS |
| GET /products/search?q=Loadtest | 10 | 10 | 10 | 0 | 351.59 | 23 | 28 | 28 | PASS |
| GET /products/search?q=Loadtest | 50 | 50 | 50 | 0 | 475.82 | 81 | 100 | 102 | PASS |
| GET /products/search?q=Loadtest | 100 | 100 | 100 | 0 | 455.14 | 154 | 211 | 214 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 1 | 1 | 1 | 0 | 256.08 | 4 | 4 | 4 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 10 | 10 | 10 | 0 | 558.14 | 16 | 17 | 17 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 50 | 50 | 50 | 0 | 764.23 | 57 | 63 | 63 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 100 | 100 | 100 | 0 | 714.41 | 120 | 132 | 135 | PASS |

## Stock API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| POST /stock/add | 100 | 1000 | 1000 | 0 | 393.44 | 246 | 295 | 315 | PASS |
| POST /sales/checkout | 10 | 10 | 10 | 0 | 76.34 | 96 | 131 | 131 | PASS |
| POST /sales/checkout | 50 | 50 | 50 | 0 | 128.25 | 228 | 378 | 392 | PASS |
| POST /sales/checkout | 100 | 100 | 100 | 0 | 138.3 | 418 | 696 | 719 | PASS |

## Inventory Correctness

| Test | Initial | Successful | Failed | Expected | Actual | Result |

| --- | ---: | ---: | ---: | ---: | ---: | --- |

| 100 products x 10 concurrent increments | per-product opening stock |  |  | opening stock + successful increments for that product | matched | PASS |

| 10 concurrent sale decrements | 1000 | 10 | 0 | 990 | 990 | PASS |

| 50 concurrent sale decrements | 1000 | 50 | 0 | 950 | 950 | PASS |

| 100 concurrent sale decrements | 1000 | 100 | 0 | 900 | 900 | PASS |

## Large Dataset Performance

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GET /business/my-businesses | 1 | 1 | 1 | 0 | 219.74 | 4 | 4 | 4 | PASS |
| GET /business/my-businesses | 10 | 10 | 10 | 0 | 833.08 | 10 | 11 | 11 | PASS |
| GET /business/my-businesses | 50 | 50 | 50 | 0 | 804.54 | 52 | 60 | 60 | PASS |
| GET /business/my-businesses | 100 | 100 | 100 | 0 | 827.21 | 96 | 112 | 114 | PASS |
| GET /dashboard | 1 | 1 | 1 | 0 | 36.72 | 26 | 26 | 26 | PASS |
| GET /dashboard | 10 | 10 | 10 | 0 | 52.78 | 111 | 187 | 187 | PASS |
| GET /dashboard | 50 | 50 | 50 | 0 | 47.77 | 560 | 1002 | 1042 | WARNING |
| GET /dashboard | 100 | 100 | 100 | 0 | 46.53 | 1189 | 2060 | 2137 | WARNING |
| GET /admin/staff | 1 | 1 | 1 | 0 | 37.67 | 25 | 25 | 25 | PASS |
| GET /admin/staff | 10 | 10 | 10 | 0 | 71.88 | 109 | 137 | 137 | PASS |
| GET /admin/staff | 50 | 50 | 50 | 0 | 64.77 | 713 | 765 | 769 | PASS |
| GET /admin/staff | 100 | 100 | 100 | 0 | 58.48 | 1562 | 1684 | 1697 | WARNING |
| GET /products | 1 | 1 | 1 | 0 | 37.12 | 25 | 25 | 25 | PASS |
| GET /products | 10 | 10 | 10 | 0 | 61.12 | 94 | 161 | 161 | PASS |
| GET /products | 50 | 50 | 50 | 0 | 54.6 | 486 | 865 | 912 | PASS |
| GET /products | 100 | 100 | 100 | 0 | 54.33 | 980 | 1750 | 1815 | WARNING |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 129.24 | 8 | 8 | 8 | PASS |
| GET /products/search?q=Loadtest | 10 | 10 | 10 | 0 | 351.59 | 23 | 28 | 28 | PASS |
| GET /products/search?q=Loadtest | 50 | 50 | 50 | 0 | 475.82 | 81 | 100 | 102 | PASS |
| GET /products/search?q=Loadtest | 100 | 100 | 100 | 0 | 455.14 | 154 | 211 | 214 | PASS |
| GET /sales | 1 | 1 | 1 | 0 | 186.72 | 5 | 5 | 5 | PASS |
| GET /sales | 10 | 10 | 10 | 0 | 362.33 | 23 | 27 | 27 | PASS |
| GET /sales | 50 | 50 | 50 | 0 | 438.36 | 96 | 111 | 112 | PASS |
| GET /sales | 100 | 100 | 100 | 0 | 442.43 | 185 | 218 | 220 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 1 | 1 | 1 | 0 | 256.08 | 4 | 4 | 4 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 10 | 10 | 10 | 0 | 558.14 | 16 | 17 | 17 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 50 | 50 | 50 | 0 | 764.23 | 57 | 63 | 63 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 100 | 100 | 100 | 0 | 714.41 | 120 | 132 | 135 | PASS |
| GET /business/10002 | 1 | 1 | 1 | 0 | 238.75 | 4 | 4 | 4 | PASS |
| GET /business/10002 | 10 | 10 | 10 | 0 | 745.3 | 11 | 13 | 13 | PASS |
| GET /business/10002 | 50 | 50 | 50 | 0 | 761.46 | 54 | 63 | 64 | PASS |
| GET /business/10002 | 100 | 100 | 100 | 0 | 756.37 | 109 | 121 | 122 | PASS |

- GET /products returns every product for the business in one response. The route has no page or limit parameter.
- GET /admin/staff returns every staff and accountant member and aggregates sales, products, and stock logs for those users. The route has no page parameter.
- GET /products/search stops at 50 rows.
- There is no separate stock-list route. Stock is a column on products. Stock changes go through POST /stock/add, POST /stock/receive-one, and sale checkout.
- GET /dashboard loads the business product list as part of the admin dashboard.

## Mixed Workload

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| mixed | 10 | 1906 | 1906 | 0 | 63.36 | 149 | 471 | 557 | PASS |
| mixed | 25 | 1799 | 1799 | 0 | 59.09 | 414 | 686 | 976 | PASS |
| mixed | 50 | 1742 | 1742 | 0 | 56.74 | 862 | 1365 | 1509 | WARNING |
| mixed | 100 | 1744 | 1744 | 0 | 55.98 | 1745 | 3021 | 3147 | FAIL |

## Error Analysis

| Class | Count | Example |

| --- | ---: | --- |

| server | 6 | Failed to setup business. |

## Bottlenecks

- Observed: local bcrypt sample averaged 92 ms at 10 rounds. The last team-create stage averaged 1486 ms per request. Local bcrypt sample in the test process. It is not the server measurement. Compare it with endpoint latency.
- Observed: the API process recorded 1213 stress-sink credential emails with average 0 ms spent building the message. Real SMTP was not used for those calls.
- Observed: GET /admin/staff p95 was 1660 ms at concurrency 100, rows returned 1083. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
- Observed: GET /products p95 was 1528 ms at concurrency 100, rows returned 1176. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
- Observed: GET /admin/staff p95 was 1684 ms at concurrency 100, rows returned 1083. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
- Observed: GET /products p95 was 1750 ms at concurrency 100, rows returned 1279. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.

## Stop Conditions

- 2026-09-24T11:35:50.113Z business-create stage 1000 concurrency 50 error 1.20% p95 6369 ms. p95 6369ms exceeded 5000ms

## Thresholds

- PASS: error rate under 1% and p95 under 1 second, with no integrity failure.

- WARNING: error rate from 1% to 5%, or p95 from 1 to 3 seconds.

- FAIL: error rate above 5%, p95 above 3 seconds, or a data-integrity failure.

## Recommendations

These are follow-ups from the measurements above. They were not applied.

- Observed: local bcrypt sample averaged 92 ms at 10 rounds. The last team-create stage averaged 1486 ms per request. Local bcrypt sample in the test process. It is not the server measurement. Compare it with endpoint latency.
- Observed: the API process recorded 1213 stress-sink credential emails with average 0 ms spent building the message. Real SMTP was not used for those calls.
- Observed: GET /admin/staff p95 was 1660 ms at concurrency 100, rows returned 1083. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
- Observed: GET /products p95 was 1528 ms at concurrency 100, rows returned 1176. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
- Observed: GET /admin/staff p95 was 1684 ms at concurrency 100, rows returned 1083. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
- Observed: GET /products p95 was 1750 ms at concurrency 100, rows returned 1279. Possible cause: the handler loads the full collection for the business in one response. Suggested investigation: add pagination and review the staff aggregate queries.
