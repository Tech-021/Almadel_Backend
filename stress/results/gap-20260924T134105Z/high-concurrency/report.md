# Almadel Gap Test Report: Hundreds of concurrent users
**Report ID:** gap-20260924T134105Z-high-concurrency

## Purpose

Measure absolute request-handling capacity at hundreds of concurrent clients. This closes the earlier gap where only lower concurrency baselines existed.

## Bottom line

**PASS.** All 18 measured stages stayed inside pass thresholds.

This is request scalability under many simultaneous clients, not database row-growth scalability.

## What was tested

Concurrent GET traffic against health, products, staff, dashboard, and business list, plus mixed search/stock bursts at 100 / 200 / 300 concurrent users (or until stop thresholds).

## Results

| Stage | Concurrency | Requests | Success | Errors | Avg | P95 | Bytes | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| high-concurrency /health | 100 | 100 | 100 | 0 | 49 | 53 | 11 | PASS |
| high-concurrency /products | 100 | 100 | 100 | 0 | 239 | 256 | 2 | PASS |
| high-concurrency /admin/staff | 100 | 100 | 100 | 0 | 244 | 264 | 12 | PASS |
| high-concurrency /dashboard | 100 | 100 | 100 | 0 | 319 | 390 | 148 | PASS |
| high-concurrency /business/my-businesses | 100 | 100 | 100 | 0 | 146 | 171 | 1001 | PASS |
| high-concurrency mixed burst | 100 | 100 | 100 | 0 | 166 | 181 | 3100 | PASS |
| high-concurrency /health | 200 | 200 | 200 | 0 | 57 | 82 | 11 | PASS |
| high-concurrency /products | 200 | 200 | 200 | 0 | 283 | 302 | 2 | PASS |
| high-concurrency /admin/staff | 200 | 200 | 200 | 0 | 332 | 355 | 12 | PASS |
| high-concurrency /dashboard | 200 | 200 | 200 | 0 | 441 | 564 | 148 | PASS |
| high-concurrency /business/my-businesses | 200 | 200 | 200 | 0 | 291 | 349 | 1001 | PASS |
| high-concurrency mixed burst | 200 | 200 | 200 | 0 | 264 | 293 | 6200 | PASS |
| high-concurrency /health | 300 | 300 | 300 | 0 | 66 | 86 | 11 | PASS |
| high-concurrency /products | 300 | 300 | 300 | 0 | 359 | 393 | 2 | PASS |
| high-concurrency /admin/staff | 300 | 300 | 300 | 0 | 411 | 453 | 12 | PASS |
| high-concurrency /dashboard | 300 | 300 | 300 | 0 | 617 | 760 | 148 | PASS |
| high-concurrency /business/my-businesses | 300 | 300 | 300 | 0 | 377 | 434 | 1001 | PASS |
| high-concurrency mixed burst | 300 | 300 | 300 | 0 | 381 | 437 | 9597 | PASS |

## How to explain this to your lead

If p95 or errors climb sharply between 100 and 300 concurrent users, that is the practical concurrency ceiling for those endpoints on this server size. Inventory and list endpoints that return large payloads usually degrade first.

