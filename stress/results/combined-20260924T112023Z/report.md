# Almadel Combined Stress Test Report
**Report ID:** combined-20260924T112023Z

## 1. Purpose of this report

This document combines two separate kinds of testing for Almadel. The first is API load testing: real HTTP requests against the running stress API to measure how the application behaves under concurrent traffic. The second is database volume and ACID testing: direct PostgreSQL checks against a large seeded dataset to measure data integrity and query cost when tables already contain about 10,000 records.

These two tests answer different questions. API testing answers “can the server handle concurrent create and read requests?” Database testing answers “does stock stay correct, and do queries remain usable when one business already has a large amount of data?” Treating them as one giant creation test would mostly measure password hashing and email work, not realistic scalability.

## 2. Bottom line for leadership

**Overall result: PASS for the scopes that were executed.** In this combined run, API smoke tests completed without failed requests, inventory correctness matched expected stock, and all ACID database checks passed.

This combined report uses API run `stress-20260924T101131Z` (profile **smoke**) and database run `stress-db-20260924T111241Z` (profile **smoke**). The API profile used here is a controlled smoke profile, not the maximum heavy profile. That means these results are a stable baseline, not a claim about the absolute maximum production capacity.

## 3. What data was present during testing

Before these measurements, the dedicated stress database `almadel_stress` was populated with large volumes of synthetic records. The worst-case single-tenant business is the important one for staff/product/stock volume questions.

- Worst-case business id: **10001**
- Staff in that business: **5000**
- Accountants in that business: **5000**
- Products in that business: **10000**
- Stock log rows: **10000**
- Stress businesses overall: **10001**

Important interpretation note: having 10,000 businesses in the database does **not** mean every business also has 10,000 staff. Staff and products were concentrated into one worst-case tenant so we could measure the expensive list/join paths without creating an unrealistic hundreds-of-millions-row dataset.

## 4. API load testing findings

The API suite called the real application routes over HTTP. Business creation used owner sign-up followed by business setup. Team creation used `POST /admin/staff` for both staff and accountant roles. Product and stock operations used the live product and inventory endpoints. Mixed traffic simulated a more realistic blend of reads and writes.

### 4.1 Business creation

In the smoke profile, Almadel created **10** businesses with **0** failures at **5** concurrent users. Average response time was **497 ms** and p95 was **888 ms** (**PASS**).

Business creation is heavier than a simple insert because it includes account creation or authentication, password hashing during sign-up, and the business setup transaction. The measured time therefore includes application work, not only the database write.

### 4.2 Staff and accountant creation

The team suite created **20** members with **0** failures. Average latency was **473 ms** and p95 was **492 ms** (**PASS**). Staff and accountant creation used the same endpoint; only the role field differed.

Team creation is intentionally expensive in the real API path because each request hashes a password and attempts credential email delivery. In the stress environment, outbound email is mocked so the test does not send real messages, but the endpoint still exercises the mail code path.

### 4.3 Product and stock operations

Product creation completed **50/50** requests with p95 **21 ms** (**PASS**). Product create is comparatively light because it does not hash passwords or send email.

Stock updates through `POST /stock/add` completed **100/100** requests with p95 **27 ms** (**PASS**). Concurrent sale decrements were also checked so inventory could not silently drift under contention.

### 4.4 Mixed realistic traffic

The mixed workload sent **2099** requests at **5** concurrent users with **0** failures. Average latency was **28 ms** and p95 was **29 ms** (**PASS**). This mix included product reads, searches, stock reads/updates, team reads, business reads, and a smaller share of creates.

### 4.5 API stage detail

**business**

- **10** at 5 concurrent users: 10/10 succeeded, avg 497 ms, p95 888 ms, grade **PASS**.

**team**

- **20** at 5 concurrent users: 20/20 succeeded, avg 473 ms, p95 492 ms, grade **PASS**.
- **GET /admin/staff** at 1 concurrent users: 1/1 succeeded, avg 9 ms, p95 9 ms, grade **PASS**.
- **GET /admin/staff** at 5 concurrent users: 5/5 succeeded, avg 30 ms, p95 35 ms, grade **PASS**.

**products**

- **50** at 5 concurrent users: 50/50 succeeded, avg 15 ms, p95 21 ms, grade **PASS**.
- **GET /products** at 1 concurrent users: 1/1 succeeded, avg 7 ms, p95 7 ms, grade **PASS**.
- **GET /products** at 5 concurrent users: 5/5 succeeded, avg 14 ms, p95 17 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 1 concurrent users: 1/1 succeeded, avg 8 ms, p95 8 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 5 concurrent users: 5/5 succeeded, avg 15 ms, p95 17 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 5 concurrent users: 5/5 succeeded, avg 11 ms, p95 13 ms, grade **PASS**.

**stock**

- **POST /stock/add** at 5 concurrent users: 100/100 succeeded, avg 19 ms, p95 27 ms, grade **PASS**.
- **POST /sales/checkout** at 5 concurrent users: 5/5 succeeded, avg 69 ms, p95 91 ms, grade **PASS**.

**reads**

- **GET /business/my-businesses** at 1 concurrent users: 1/1 succeeded, avg 5 ms, p95 5 ms, grade **PASS**.
- **GET /business/my-businesses** at 5 concurrent users: 5/5 succeeded, avg 9 ms, p95 11 ms, grade **PASS**.
- **GET /dashboard** at 1 concurrent users: 1/1 succeeded, avg 10 ms, p95 10 ms, grade **PASS**.
- **GET /dashboard** at 5 concurrent users: 5/5 succeeded, avg 25 ms, p95 29 ms, grade **PASS**.
- **GET /admin/staff** at 1 concurrent users: 1/1 succeeded, avg 7 ms, p95 7 ms, grade **PASS**.
- **GET /admin/staff** at 5 concurrent users: 5/5 succeeded, avg 16 ms, p95 18 ms, grade **PASS**.
- **GET /products** at 1 concurrent users: 1/1 succeeded, avg 5 ms, p95 5 ms, grade **PASS**.
- **GET /products** at 5 concurrent users: 5/5 succeeded, avg 12 ms, p95 14 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 1 concurrent users: 1/1 succeeded, avg 5 ms, p95 5 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 5 concurrent users: 5/5 succeeded, avg 11 ms, p95 14 ms, grade **PASS**.
- **GET /sales** at 1 concurrent users: 1/1 succeeded, avg 6 ms, p95 6 ms, grade **PASS**.
- **GET /sales** at 5 concurrent users: 5/5 succeeded, avg 12 ms, p95 14 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 5 concurrent users: 5/5 succeeded, avg 7 ms, p95 8 ms, grade **PASS**.
- **GET /business/10002** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /business/10002** at 5 concurrent users: 5/5 succeeded, avg 8 ms, p95 9 ms, grade **PASS**.

**mixed**

- **mixed** at 5 concurrent users: 2099/2099 succeeded, avg 28 ms, p95 29 ms, grade **PASS**.

Full raw API report: `stress/results/stress-20260924T101131Z/report.md`

## 5. Database ACID findings

ACID describes four properties that protect data correctness. For Almadel, these matter most around stock and membership writes, because incorrect inventory or duplicate accounts create immediate business risk.

In this database run, **7 of 7** ACID checks passed.

### Atomicity: PASS

If one step inside a database transaction fails, every step in that transaction must be undone. Partial updates should not remain.

- What we tested: Increment stock + create stock log, then force rollback
- What we expected: Neither stock nor stock_log row survives
- What we observed: stock 1000->1000, logs 1->1
- Result: **PASS**

### Consistency: PASS

The database must reject invalid business states, such as duplicate emails/barcodes or selling more stock than exists.

- What we tested: Duplicate user email insert
- What we expected: Rejected by unique constraint
- What we observed: rejected
- Result: **PASS**

### Consistency: PASS

The database must reject invalid business states, such as duplicate emails/barcodes or selling more stock than exists.

- What we tested: Duplicate product barcode in same business
- What we expected: Rejected by unique(businessId, barcode)
- What we observed: rejected
- Result: **PASS**

### Consistency: PASS

The database must reject invalid business states, such as duplicate emails/barcodes or selling more stock than exists.

- What we tested: Conditional stock decrement refuses oversell
- What we expected: First decrement succeeds, second affects 0 rows, stock stays 0
- What we observed: first=1, second=0, stock=0
- Result: **PASS**

### Isolation: PASS

When many requests change the same stock row at once, the final quantity must still match the number of successful updates. No lost updates.

- What we tested: 10 concurrent conditional decrements on one row
- What we expected: stock = 1000 - successful updates (990)
- What we observed: successful=10, stock=990
- Result: **PASS**

### Isolation: PASS

When many requests change the same stock row at once, the final quantity must still match the number of successful updates. No lost updates.

- What we tested: 50 concurrent conditional decrements on one row
- What we expected: stock = 1000 - successful updates (950)
- What we observed: successful=50, stock=950
- Result: **PASS**

### Durability: PASS

Once a write is committed, it must still be readable afterward. Temporary memory-only success is not enough.

- What we tested: Insert product then re-read via SQL
- What we expected: Committed row is readable after write
- What we observed: id=10181 stock=42 barcode=STRESS-ACID-DUR-1790248362191
- Result: **PASS**

## 6. Database query benchmarks on the 10k tenant

These timings measure the database/query layer directly against the already-seeded worst-case business. They help separate “the table is large” problems from “HTTP concurrency is high” problems.

| Query | What it represents | Avg | P95 | Rows | Grade |
| --- | --- | ---: | ---: | ---: | --- |
| count products in worst-case business | Database query cost | 1 ms | 2 ms | 10000 | PASS |
| list 10k products ordered by name | Unbounded product list for one business | 31 ms | 60 ms | 10000 | PASS |
| search products by name contains Stress | Product search capped at 50 rows | 2 ms | 4 ms | 50 | PASS |
| barcode lookup | POS barcode lookup | 2 ms | 5 ms | 1 | PASS |
| list team members with user join | Staff/accountant list with user join | 96 ms | 120 ms | 10000 | PASS |
| owner business memberships (10k businesses) | Owner opening the full business list | 208 ms | 230 ms | 10001 | PASS |
| low stock products | Database query cost | 4 ms | 10 ms | 0 | PASS |
| stock log history sample | Database query cost | 7 ms | 8 ms | 1000 | PASS |
| aggregate stock sum | Inventory total calculation | 4 ms | 8 ms | 10000 | PASS |

### What the slowest queries suggest

- **owner business memberships (10k businesses)** took about **230 ms** at p95 while touching **10001** rows. This is still within the current pass threshold, but it is the first place to watch as data grows further, especially if the API returns the full collection without pagination.
- **list team members with user join** took about **120 ms** at p95 while touching **10000** rows. This is still within the current pass threshold, but it is the first place to watch as data grows further, especially if the API returns the full collection without pagination.
- **list 10k products ordered by name** took about **60 ms** at p95 while touching **10000** rows. This is still within the current pass threshold, but it is the first place to watch as data grows further, especially if the API returns the full collection without pagination.

## 7. Inventory correctness

Inventory correctness is reported separately because a fast API that loses stock updates is still a production failure. For each contention test we recorded the starting stock, counted only successful updates, computed the expected final stock, and compared that with the database.

All **4** inventory correctness checks passed. Concurrent stock increments and sale decrements left the database in the expected state.

| Test | Initial | Successful | Failed | Expected | Actual | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 20 products x 5 concurrent increments | per-product opening stock |  |  | opening stock + successful increments for that product | matched | PASS |
| 5 concurrent sale decrements | 1000 | 5 | 0 | 995 | 995 | PASS |
| 10 concurrent DB decrements | 1000 | 10 | 0 | 990 | 990 | PASS |
| 50 concurrent DB decrements | 1000 | 50 | 0 | 950 | 950 | PASS |

## 8. What this does and does not prove

### Proven by these runs

- The smoke API profile handled the exercised create/read/stock/mixed requests without request failures.
- Stock stayed mathematically correct under the concurrent update cases that were run.
- PostgreSQL accepted rolled-back transactions cleanly, blocked invalid duplicates, and preserved committed writes.
- Querying a 10,000-product / 10,000-member tenant remained within the current pass thresholds for the measured SQL paths.

### Not proven yet

- Absolute production capacity at hundreds of concurrent users. The smoke profile uses low concurrency on purpose.
- Behavior after weeks of real customer traffic, large sale history, or image-heavy product catalogs.
- End-user experience through the frontend network path; these numbers are backend/API and database measurements.
- That every list endpoint is ready for unbounded growth. Some endpoints still return full collections, so response size will grow with tenant size.

## 9. Recommended next steps

1. Keep this combined report as the baseline.
2. Run the API suite again with `--profile standard` when ready for a stronger concurrency baseline.
3. If list endpoints grow slower as data increases, prioritize pagination on product and staff list APIs.
4. Re-run `npm run stress:db` after any stock/transaction changes to confirm ACID behavior still holds.
5. Share the bottom-line section and ACID section with stakeholders; keep the raw stage tables for engineering deep dives.

## 10. Source reports

- API report folder: `stress/results/stress-20260924T101131Z`
- Database report folder: `stress/results/stress-db-20260924T111241Z`
- Combined generated at: 2026-09-24T11:20:23.791Z

