# Almadel Gap Test Report: Hundreds of concurrent users
**Report ID:** gap-20260924T135037Z-high-concurrency

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
| high-concurrency /health | 100 | 100 | 100 | 0 | 45 | 51 | 11 | PASS |
| high-concurrency /products | 100 | 100 | 100 | 0 | 240 | 259 | 2 | PASS |
| high-concurrency /admin/staff | 100 | 100 | 100 | 0 | 284 | 319 | 12 | PASS |
| high-concurrency /dashboard | 100 | 100 | 100 | 0 | 374 | 443 | 148 | PASS |
| high-concurrency /business/my-businesses | 100 | 100 | 100 | 0 | 156 | 190 | 1001 | PASS |
| high-concurrency mixed burst | 100 | 100 | 100 | 0 | 180 | 194 | 3100 | PASS |
| high-concurrency /health | 200 | 200 | 200 | 0 | 67 | 90 | 11 | PASS |
| high-concurrency /products | 200 | 200 | 200 | 0 | 302 | 321 | 2 | PASS |
| high-concurrency /admin/staff | 200 | 200 | 200 | 0 | 376 | 403 | 12 | PASS |
| high-concurrency /dashboard | 200 | 200 | 200 | 0 | 487 | 608 | 148 | PASS |
| high-concurrency /business/my-businesses | 200 | 200 | 200 | 0 | 247 | 282 | 1001 | PASS |
| high-concurrency mixed burst | 200 | 200 | 200 | 0 | 288 | 318 | 6200 | PASS |
| high-concurrency /health | 300 | 300 | 300 | 0 | 86 | 124 | 11 | PASS |
| high-concurrency /products | 300 | 300 | 300 | 0 | 427 | 453 | 2 | PASS |
| high-concurrency /admin/staff | 300 | 300 | 300 | 0 | 456 | 488 | 12 | PASS |
| high-concurrency /dashboard | 300 | 300 | 300 | 0 | 659 | 796 | 148 | PASS |
| high-concurrency /business/my-businesses | 300 | 300 | 300 | 0 | 325 | 368 | 1001 | PASS |
| high-concurrency mixed burst | 300 | 300 | 300 | 0 | 352 | 385 | 9460 | PASS |

## How to explain this to your lead

If p95 or errors climb sharply between 100 and 300 concurrent users, that is the practical concurrency ceiling for those endpoints on this server size. Inventory and list endpoints that return large payloads usually degrade first.

