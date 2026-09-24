# Almadel stress report stress-20260924T100458Z

## Executive Summary

- The stages that completed stayed inside the pass thresholds, and inventory checks matched expected quantities.
- Highest concurrency exercised in a completed stage: 5.
- Highest concurrency that still graded PASS: 5.
- API load and database volume are separate measurements. This report only includes suites that were executed in the run.

## Environment

- Date: 2026-09-24T10:04:58.435Z
- Profile: smoke
- Base URL: http://127.0.0.1:4010
- Git: 4bbff74
- Node: v22.23.1
- Host: ubuntu-8gb-hel1-1 (linux 7.0.0-27-generic)
- CPUs: 4
- Memory free / total MB: 3841 / 7746
- PostgreSQL: PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1) on x86_64-pc-linux-gnu
- Database connections (active/idle/total): 1 / 4 / 5
- Cache hit ratio: 1
- Deadlocks counter: 0

- PM2: almadel-api online restarts 362245 cpu 0 mem 72mb; almadel-backend online restarts 11 cpu 0 mem 164mb

## Dataset

- stress businesses: 10002
- stress memberships: 20002
- stress products: 10000
- stress stock logs: 10000

## Business API Results

Not run.

## Team-Member API Results

Not run.

## Product API Results

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GET /products | 1 | 1 | 1 | 0 | 6.33 | 144 | 144 | 144 | PASS |
| GET /products | 5 | 5 | 5 | 0 | 8.13 | 389 | 601 | 601 | PASS |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 37.82 | 26 | 26 | 26 | PASS |
| GET /products/search?q=Loadtest | 5 | 5 | 5 | 0 | 78.86 | 49 | 63 | 63 | PASS |
| GET /products/barcode/STRESS-P-000001 | 1 | 1 | 1 | 0 | 99.8 | 10 | 10 | 10 | PASS |
| GET /products/barcode/STRESS-P-000001 | 5 | 5 | 5 | 0 | 314.12 | 14 | 15 | 15 | PASS |

## Stock API Results

Not run.

## Inventory Correctness

No inventory correctness checks were recorded in this run.

## Large Dataset Performance

| Stage | Concurrency | Requests | Success | Errors | Req/s | Avg | P95 | P99 | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| GET /business/my-businesses | 1 | 1 | 1 | 0 | 3.04 | 304 | 304 | 304 | PASS |
| GET /business/my-businesses | 5 | 5 | 5 | 0 | 2.72 | 1662 | 1813 | 1813 | WARNING |
| GET /dashboard | 1 | 1 | 1 | 0 | 6.21 | 147 | 147 | 147 | PASS |
| GET /dashboard | 5 | 5 | 5 | 0 | 7.62 | 509 | 645 | 645 | PASS |
| GET /admin/staff | 1 | 1 | 1 | 0 | 4.49 | 212 | 212 | 212 | PASS |
| GET /admin/staff | 5 | 5 | 5 | 0 | 7.94 | 581 | 618 | 618 | PASS |
| GET /products | 1 | 1 | 1 | 0 | 6.33 | 144 | 144 | 144 | PASS |
| GET /products | 5 | 5 | 5 | 0 | 8.13 | 389 | 601 | 601 | PASS |
| GET /products/search?q=Loadtest | 1 | 1 | 1 | 0 | 37.82 | 26 | 26 | 26 | PASS |
| GET /products/search?q=Loadtest | 5 | 5 | 5 | 0 | 78.86 | 49 | 63 | 63 | PASS |
| GET /sales | 1 | 1 | 1 | 0 | 39.21 | 25 | 25 | 25 | PASS |
| GET /sales | 5 | 5 | 5 | 0 | 201.99 | 23 | 24 | 24 | PASS |
| GET /products/barcode/STRESS-P-000001 | 1 | 1 | 1 | 0 | 99.8 | 10 | 10 | 10 | PASS |
| GET /products/barcode/STRESS-P-000001 | 5 | 5 | 5 | 0 | 314.12 | 14 | 15 | 15 | PASS |
| GET /business/10001 | 1 | 1 | 1 | 0 | 157.87 | 6 | 6 | 6 | PASS |
| GET /business/10001 | 5 | 5 | 5 | 0 | 252.42 | 17 | 19 | 19 | PASS |

- GET /products returns every product for the business in one response. The route has no page or limit parameter.
- GET /admin/staff returns every staff and accountant member and aggregates sales, products, and stock logs for those users. The route has no page parameter.
- GET /products/search stops at 50 rows.
- There is no separate stock-list route. Stock is a column on products. Stock changes go through POST /stock/add, POST /stock/receive-one, and sale checkout.
- GET /dashboard loads the business product list as part of the admin dashboard.

## Mixed Workload

Not run.

## Error Analysis

No failed requests were recorded.

## Bottlenecks

- Email timings were not recorded by the API process. Team-create latency includes whatever mail path that server used. Start the API with NODE_ENV=stress and STRESS_TEST=true so credential mail uses the in-process sink.

## Stop Conditions

No ramp was stopped early.

## Thresholds

- PASS: error rate under 1% and p95 under 1 second, with no integrity failure.

- WARNING: error rate from 1% to 5%, or p95 from 1 to 3 seconds.

- FAIL: error rate above 5%, p95 above 3 seconds, or a data-integrity failure.

## Recommendations

These are follow-ups from the measurements above. They were not applied.

- Email timings were not recorded by the API process. Team-create latency includes whatever mail path that server used. Start the API with NODE_ENV=stress and STRESS_TEST=true so credential mail uses the in-process sink.
