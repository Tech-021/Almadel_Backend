# Almadel combined stress report combined-20260924T111337Z

## Executive Summary

- This report merges one API load run and one database ACID/benchmark run.

- API run: `stress-20260924T101131Z` (profile smoke)

- Database run: `stress-db-20260924T111241Z` (profile smoke)

- ACID checks: 7/7 PASS

- Inventory/integrity checks that ran matched expected values.

## Dataset

- stress businesses: 10001
- stress memberships: 20137
- stress products: 10176
- stress stock logs: 10310
- worst-case business id: 10001
- staff: 5000
- accountants: 5000
- products: 10000
- stockLogs: 10000
- stress team users: 10000

## API report excerpt

Full API report: `stress/results/stress-20260924T101131Z/report.md`

### API suites present

- business
- team
- products
- stock
- reads
- mixed

## Database ACID

| Principle | Test | Result | Actual |
| --- | --- | --- | --- |
| Atomicity | Increment stock + create stock log, then force rollback | PASS | stock 1000->1000, logs 1->1 |
| Consistency | Duplicate user email insert | PASS | rejected |
| Consistency | Duplicate product barcode in same business | PASS | rejected |
| Consistency | Conditional stock decrement refuses oversell | PASS | first=1, second=0, stock=0 |
| Isolation | 10 concurrent conditional decrements on one row | PASS | successful=10, stock=990 |
| Isolation | 50 concurrent conditional decrements on one row | PASS | successful=50, stock=950 |
| Durability | Insert product then re-read via SQL | PASS | id=10181 stock=42 barcode=STRESS-ACID-DUR-1790248362191 |

## Database query benchmarks

| Query | Avg | Median | P95 | Max | Rows | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| count products in worst-case business | 1 | 1.279629 | 2.148924999999963 | 2.148924999999963 | 10000 | PASS |
| list 10k products ordered by name | 31 | 24.78234299999997 | 60.066453000000024 | 60.066453000000024 | 10000 | PASS |
| search products by name contains Stress | 2 | 1.546100000000024 | 4.114165999999955 | 4.114165999999955 | 50 | PASS |
| barcode lookup | 2 | 0.780601000000047 | 4.927535000000034 | 4.927535000000034 | 1 | PASS |
| list team members with user join | 96 | 92.37885099999994 | 119.79229600000008 | 119.79229600000008 | 10000 | PASS |
| owner business memberships (10k businesses) | 208 | 203.94061499999998 | 230.37007800000015 | 230.37007800000015 | 10001 | PASS |
| low stock products | 4 | 1.8968199999999342 | 9.514521000000059 | 9.514521000000059 | 0 | PASS |
| stock log history sample | 7 | 7.3764970000001995 | 8.006230999999843 | 8.006230999999843 | 1000 | PASS |
| aggregate stock sum | 4 | 2.6716379999998026 | 7.713530999999875 | 7.713530999999875 | 10000 | PASS |

## Inventory Correctness (combined)

| Test | Initial | Successful | Failed | Expected | Actual | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20 products x 5 concurrent increments | per-product opening stock |  |  | opening stock + successful increments for that product | matched | PASS |
| 5 concurrent sale decrements | 1000 | 5 | 0 | 995 | 995 | PASS |
| 10 concurrent DB decrements | 1000 | 10 | 0 | 990 | 990 | PASS |
| 50 concurrent DB decrements | 1000 | 50 | 0 | 950 | 950 | PASS |

## How to read this

- API section answers request concurrency, latency, and endpoint error rates.

- Database section answers ACID behavior and query cost against the seeded 10k tables.

- Do not treat seed insert speed as API capacity.
