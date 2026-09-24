# Almadel stress report stress-20260924T101131Z

## Executive Summary

- The stages that completed stayed inside the pass thresholds, and inventory checks matched expected quantities.
- Highest concurrency exercised in a completed stage: 5.
- Highest concurrency that still graded PASS: 5.
- Inventory correctness checks matched expected stock.
- API load and database volume are separate measurements. This report only includes suites that were executed in the run.

## Environment

- Date: 2026-09-24T10:11:31.863Z
- Profile: smoke
- Base URL: http://127.0.0.1:4010
- Git: 4bbff74
- Node: v22.23.1
- Host: ubuntu-8gb-hel1-1 (linux 7.0.0-27-generic)
- CPUs: 4
- Memory free / total MB: 3817 / 7746
- PostgreSQL: PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1) on x86_64-pc-linux-gnu
- Database connections (active/idle/total): 2 / 3 / 5
- Cache hit ratio: 1
- Deadlocks counter: 0

- PM2: almadel-api online restarts 362245 cpu 0.2 mem 72mb; almadel-backend online restarts 11 cpu 0 mem 164mb

## Dataset

- stress businesses: 10054
- stress memberships: 20137
- stress products: 10176
- stress stock logs: 10310

## Business API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 10 | 5 | 10 | 10 | 0 | 9.97 | 497 | 888 | 888 | PASS |

Average time inside the business flow is split below. Signup includes password hashing. Setup is the business transaction.

- Stage 10: signup 331 ms, setup 167 ms

## Team-Member API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 20 | 5 | 20 | 20 | 0 | 10.55 | 473 | 492 | 496 | PASS |
| GET /admin/staff | 1 | 1 | 1 | 0 | 111.97 | 9 | 9 | 9 | PASS |
| GET /admin/staff | 5 | 5 | 5 | 0 | 142.69 | 30 | 35 | 35 | PASS |

### Stage 20 by role

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| staff | 5 | 10 | 10 | 0 | 0 | 474 | 496 | 496 |  |
| accountant | 5 | 10 | 10 | 0 | 0 | 473 | 492 | 492 |  |

## Product API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 50 | 5 | 50 | 50 | 0 | 320.96 | 15 | 21 | 22 | PASS |
| GET /products | 1 | 1 | 1 | 0 | 139.12 | 7 | 7 | 7 | PASS |
| GET /products | 5 | 5 | 5 | 0 | 287.63 | 14 | 17 | 17 | PASS |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 116.08 | 8 | 8 | 8 | PASS |
| GET /products/search?q=Loadtest | 5 | 5 | 5 | 0 | 282.56 | 15 | 17 | 17 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 1 | 1 | 1 | 0 | 231.06 | 4 | 4 | 4 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 5 | 5 | 5 | 0 | 378.86 | 11 | 13 | 13 | PASS |
| GET /products | 1 | 1 | 1 | 0 | 178.05 | 5 | 5 | 5 | PASS |
| GET /products | 5 | 5 | 5 | 0 | 344.19 | 12 | 14 | 14 | PASS |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 185.39 | 5 | 5 | 5 | PASS |
| GET /products/search?q=Loadtest | 5 | 5 | 5 | 0 | 349.04 | 11 | 14 | 14 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 1 | 1 | 1 | 0 | 246.23 | 4 | 4 | 4 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 5 | 5 | 5 | 0 | 578.33 | 7 | 8 | 8 | PASS |

## Stock API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| POST /stock/add | 5 | 100 | 100 | 0 | 253.46 | 19 | 27 | 34 | PASS |
| POST /sales/checkout | 5 | 5 | 5 | 0 | 55.3 | 69 | 91 | 91 | PASS |

## Inventory Correctness

| Test | Initial | Successful | Failed | Expected | Actual | Result |

| --- | ---: | ---: | ---: | ---: | ---: | --- |

| 20 products x 5 concurrent increments | per-product opening stock |  |  | opening stock + successful increments for that product | matched | PASS |

| 5 concurrent sale decrements | 1000 | 5 | 0 | 995 | 995 | PASS |

## Large Dataset Performance

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GET /business/my-businesses | 1 | 1 | 1 | 0 | 211.05 | 5 | 5 | 5 | PASS |
| GET /business/my-businesses | 5 | 5 | 5 | 0 | 449.49 | 9 | 11 | 11 | PASS |
| GET /dashboard | 1 | 1 | 1 | 0 | 99.74 | 10 | 10 | 10 | PASS |
| GET /dashboard | 5 | 5 | 5 | 0 | 166.02 | 25 | 29 | 29 | PASS |
| GET /admin/staff | 1 | 1 | 1 | 0 | 139.33 | 7 | 7 | 7 | PASS |
| GET /admin/staff | 5 | 5 | 5 | 0 | 275.17 | 16 | 18 | 18 | PASS |
| GET /products | 1 | 1 | 1 | 0 | 178.05 | 5 | 5 | 5 | PASS |
| GET /products | 5 | 5 | 5 | 0 | 344.19 | 12 | 14 | 14 | PASS |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 185.39 | 5 | 5 | 5 | PASS |
| GET /products/search?q=Loadtest | 5 | 5 | 5 | 0 | 349.04 | 11 | 14 | 14 | PASS |
| GET /sales | 1 | 1 | 1 | 0 | 170.53 | 6 | 6 | 6 | PASS |
| GET /sales | 5 | 5 | 5 | 0 | 343.22 | 12 | 14 | 14 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 1 | 1 | 1 | 0 | 246.23 | 4 | 4 | 4 | PASS |
| GET /products/barcode/LOADTEST-1863-000001 | 5 | 5 | 5 | 0 | 578.33 | 7 | 8 | 8 | PASS |
| GET /business/10002 | 1 | 1 | 1 | 0 | 245.12 | 4 | 4 | 4 | PASS |
| GET /business/10002 | 5 | 5 | 5 | 0 | 524.62 | 8 | 9 | 9 | PASS |

- GET /products returns every product for the business in one response. The route has no page or limit parameter.
- GET /admin/staff returns every staff and accountant member and aggregates sales, products, and stock logs for those users. The route has no page parameter.
- GET /products/search stops at 50 rows.
- There is no separate stock-list route. Stock is a column on products. Stock changes go through POST /stock/add, POST /stock/receive-one, and sale checkout.
- GET /dashboard loads the business product list as part of the admin dashboard.

## Mixed Workload

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| mixed | 5 | 2099 | 2099 | 0 | 136.65 | 28 | 29 | 466 | PASS |

## Error Analysis

No failed requests were recorded.

## Bottlenecks

- Observed: local bcrypt sample averaged 93 ms at 10 rounds. The last team-create stage averaged 30 ms per request. Local bcrypt sample in the test process. It is not the server measurement. Compare it with endpoint latency.
- Observed: the API process recorded 83 stress-sink credential emails with average 0 ms spent building the message. Real SMTP was not used for those calls.

## Stop Conditions

No ramp was stopped early.

## Thresholds

- PASS: error rate under 1% and p95 under 1 second, with no integrity failure.

- WARNING: error rate from 1% to 5%, or p95 from 1 to 3 seconds.

- FAIL: error rate above 5%, p95 above 3 seconds, or a data-integrity failure.

## Recommendations

These are follow-ups from the measurements above. They were not applied.

- Observed: local bcrypt sample averaged 93 ms at 10 rounds. The last team-create stage averaged 30 ms per request. Local bcrypt sample in the test process. It is not the server measurement. Compare it with endpoint latency.
- Observed: the API process recorded 83 stress-sink credential emails with average 0 ms spent building the message. Real SMTP was not used for those calls.
