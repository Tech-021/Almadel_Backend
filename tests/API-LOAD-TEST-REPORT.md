# API Load Test Report

## GET routes

The latest GET run tested 10 routes with 100 VUs per route and 5 iterations per VU. Each route completed its 500 iterations, but many requests failed their response checks.

| Route | Successful responses/checks |
|---|---:|
| `GET /admin/logs` | 301 / 500 (60%) |
| `GET /products/search` | 51 / 500 (10%) |
| `GET /customers` | 143 / 500 (28%) |
| `GET /products/barcode/:barcode` | 281 / 500 (56%) |
| `GET /business` (my businesses) | 84 / 500 (16%) |
| `GET /products` | 93 / 500 (18%) |
| `GET /admin/staff` | 162 / 500 (32%) |
| `GET /health` | 232 / 500 (46%) |
| `GET /dashboard` (admin) | 273 / 500 (54%) |
| `GET /dashboard/me` | 372 / 500 (74%) |

### GET run totals

- HTTP requests: 5,001
- Failed HTTP requests: 3,008 (60.14%)
- Average response time: 2.41 s
- Median response time: 0 s
- 90th percentile: 8.52 s
- 95th percentile: 9.21 s
- Maximum response time: 14.96 s
- Data received: 524 MB
- Peak VUs: 1,000 total (100 per route)

All route iterations completed, but the request failure and latency thresholds were crossed. The run reached 1,000 concurrent VUs across the 10 routes.

## POST routes

The POST suite ran endpoints sequentially. Repeatable endpoint scenarios generally used 100 VUs with 5 iterations per VU.

| Route/scenario | Result |
|---|---|
| Sign-in | 500 requests completed; checks passed, but p95 latency was 12.7 s. |
| Sign-up variants | Attempted; at least one crossed failure or latency thresholds. |
| Forgot password | One request passed its checks; p95 latency was 1.08 s. |
| Create product | 500 passed. |
| Upload product image | 500 passed. |
| Import products | 500 passed. |
| Receive stock, add stock, checkout | Skipped because `API_TEST_PRODUCT_BARCODE` was not set. |
| Create customer | 500 passed. |
| Create staff | 441 passed; 59 failed. |
| Business setup | 500 passed in one run. In a later run, the server stopped accepting connections and only 40 of 500 succeeded. |
| Create log | 500 passed in one run. A later attempt could not reach the route because sign-in failed. |
| Create admin log | 500 passed. |
| Reset password | Skipped in one run; a later one-request attempt failed its status check. |

## Summary

The GET run completed its iterations but had a 60.14% HTTP failure rate and 9.21 s p95 latency at up to 1,000 combined VUs. POST results varied between runs. Stock and checkout still need a suitable product barcode, and password reset needs a fresh valid token.
