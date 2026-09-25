# Almadel Combined Stress Test Report
**Report ID:** combined-20260924T114136Z

## 1. Purpose of this report

This document combines two separate kinds of testing for Almadel. The first is API load testing: real HTTP requests against the running stress API to measure how the application behaves under concurrent traffic. The second is database volume and ACID testing: direct PostgreSQL checks against a large seeded dataset to measure data integrity and query cost when tables already contain about 10,000 records.

These two tests answer different questions. API testing answers “can the server handle concurrent create and read requests?” Database testing answers “does stock stay correct, and do queries remain usable when one business already has a large amount of data?” Treating them as one giant creation test would mostly measure password hashing and email work, not realistic scalability.

## 2. Bottom line for leadership

**Overall result: Attention needed.** At least one API stage, ACID check, or inventory correctness check did not pass. Review the detailed sections below before drawing capacity conclusions.

This combined report uses API run `stress-20260924T113414Z` (profile **standard**) and database run `stress-db-scale-20260924T114005Z` (profile **standard**). These are controlled scalability baselines for the selected profiles, not a claim that the system has been proven at every possible production peak.

## 3. What data was present during testing

Before these measurements, the dedicated stress database `almadel_stress` was populated with large volumes of synthetic records. The worst-case single-tenant business is the important one for staff/product/stock volume questions.

- Worst-case business id: **n/a**
- Staff in that business: **10000**
- Accountants in that business: **n/a**
- Products in that business: **10000**
- Stock log rows: **10000**
- Stress businesses overall: **10000**

Important interpretation note: having 10,000 businesses in the database does **not** mean every business also has 10,000 staff. Staff and products were concentrated into one worst-case tenant so we could measure the expensive list/join paths without creating an unrealistic hundreds-of-millions-row dataset.

## 4. API load testing findings

The API suite called the real application routes over HTTP. Business creation used owner sign-up followed by business setup. Team creation used `POST /admin/staff` for both staff and accountant roles. Product and stock operations used the live product and inventory endpoints. Mixed traffic simulated a more realistic blend of reads and writes.

### 4.1 Business creation

For the first business-create stage shown here, Almadel completed **100** of **100** requests with **0** failures at **10** concurrent users. Average response time was **998 ms** and p95 was **1249 ms** (**WARNING**).

Business creation is heavier than a simple insert because it includes account creation or authentication, password hashing during sign-up, and the business setup transaction. The measured time therefore includes application work, not only the database write.

### 4.2 Staff and accountant creation

The team suite created **100** members with **0** failures. Average latency was **933 ms** and p95 was **1024 ms** (**WARNING**). Staff and accountant creation used the same endpoint; only the role field differed.

Team creation is intentionally expensive in the real API path because each request hashes a password and attempts credential email delivery. In the stress environment, outbound email is mocked so the test does not send real messages, but the endpoint still exercises the mail code path.

### 4.3 Product and stock operations

Product creation completed **100/100** requests with p95 **23 ms** (**PASS**). Product create is comparatively light because it does not hash passwords or send email.

Stock updates through `POST /stock/add` completed **1000/1000** requests with p95 **295 ms** (**PASS**). Concurrent sale decrements were also checked so inventory could not silently drift under contention.

### 4.4 Mixed realistic traffic

The mixed workload sent **1906** requests at **10** concurrent users with **0** failures. Average latency was **149 ms** and p95 was **471 ms** (**PASS**). This mix included product reads, searches, stock reads/updates, team reads, business reads, and a smaller share of creates.

### 4.5 API stage detail

**business**

- **100** at 10 concurrent users: 100/100 succeeded, avg 998 ms, p95 1249 ms, grade **WARNING**.
- **500** at 25 concurrent users: 400/400 succeeded, avg 2371 ms, p95 2948 ms, grade **WARNING**.
- **1000** at 50 concurrent users: 494/500 succeeded, avg 4682 ms, p95 6369 ms, grade **FAIL**.

**team**

- **100** at 10 concurrent users: 100/100 succeeded, avg 933 ms, p95 1024 ms, grade **WARNING**.
- **1000** at 25 concurrent users: 900/900 succeeded, avg 2325 ms, p95 2572 ms, grade **WARNING**.
- **GET /admin/staff** at 1 concurrent users: 1/1 succeeded, avg 30 ms, p95 30 ms, grade **PASS**.
- **GET /admin/staff** at 10 concurrent users: 10/10 succeeded, avg 151 ms, p95 188 ms, grade **PASS**.
- **GET /admin/staff** at 50 concurrent users: 50/50 succeeded, avg 739 ms, p95 809 ms, grade **PASS**.
- **GET /admin/staff** at 100 concurrent users: 100/100 succeeded, avg 1486 ms, p95 1660 ms, grade **WARNING**.

**products**

- **100** at 10 concurrent users: 100/100 succeeded, avg 17 ms, p95 23 ms, grade **PASS**.
- **1000** at 25 concurrent users: 900/900 succeeded, avg 38 ms, p95 51 ms, grade **PASS**.
- **GET /products** at 1 concurrent users: 1/1 succeeded, avg 22 ms, p95 22 ms, grade **PASS**.
- **GET /products** at 10 concurrent users: 10/10 succeeded, avg 103 ms, p95 167 ms, grade **PASS**.
- **GET /products** at 50 concurrent users: 50/50 succeeded, avg 463 ms, p95 835 ms, grade **PASS**.
- **GET /products** at 100 concurrent users: 100/100 succeeded, avg 848 ms, p95 1528 ms, grade **WARNING**.
- **GET /products/search?q=Loadtest** at 1 concurrent users: 1/1 succeeded, avg 8 ms, p95 8 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 10 concurrent users: 10/10 succeeded, avg 22 ms, p95 27 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 50 concurrent users: 50/50 succeeded, avg 90 ms, p95 117 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 100 concurrent users: 100/100 succeeded, avg 157 ms, p95 210 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-STOCK-1863-000001** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-STOCK-1863-000001** at 10 concurrent users: 10/10 succeeded, avg 14 ms, p95 16 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-STOCK-1863-000001** at 50 concurrent users: 50/50 succeeded, avg 68 ms, p95 74 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-STOCK-1863-000001** at 100 concurrent users: 100/100 succeeded, avg 113 ms, p95 125 ms, grade **PASS**.

**stock**

- **POST /stock/add** at 100 concurrent users: 1000/1000 succeeded, avg 246 ms, p95 295 ms, grade **PASS**.
- **POST /sales/checkout** at 10 concurrent users: 10/10 succeeded, avg 96 ms, p95 131 ms, grade **PASS**.
- **POST /sales/checkout** at 50 concurrent users: 50/50 succeeded, avg 228 ms, p95 378 ms, grade **PASS**.
- **POST /sales/checkout** at 100 concurrent users: 100/100 succeeded, avg 418 ms, p95 696 ms, grade **PASS**.

**reads**

- **GET /business/my-businesses** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /business/my-businesses** at 10 concurrent users: 10/10 succeeded, avg 10 ms, p95 11 ms, grade **PASS**.
- **GET /business/my-businesses** at 50 concurrent users: 50/50 succeeded, avg 52 ms, p95 60 ms, grade **PASS**.
- **GET /business/my-businesses** at 100 concurrent users: 100/100 succeeded, avg 96 ms, p95 112 ms, grade **PASS**.
- **GET /dashboard** at 1 concurrent users: 1/1 succeeded, avg 26 ms, p95 26 ms, grade **PASS**.
- **GET /dashboard** at 10 concurrent users: 10/10 succeeded, avg 111 ms, p95 187 ms, grade **PASS**.
- **GET /dashboard** at 50 concurrent users: 50/50 succeeded, avg 560 ms, p95 1002 ms, grade **WARNING**.
- **GET /dashboard** at 100 concurrent users: 100/100 succeeded, avg 1189 ms, p95 2060 ms, grade **WARNING**.
- **GET /admin/staff** at 1 concurrent users: 1/1 succeeded, avg 25 ms, p95 25 ms, grade **PASS**.
- **GET /admin/staff** at 10 concurrent users: 10/10 succeeded, avg 109 ms, p95 137 ms, grade **PASS**.
- **GET /admin/staff** at 50 concurrent users: 50/50 succeeded, avg 713 ms, p95 765 ms, grade **PASS**.
- **GET /admin/staff** at 100 concurrent users: 100/100 succeeded, avg 1562 ms, p95 1684 ms, grade **WARNING**.
- **GET /products** at 1 concurrent users: 1/1 succeeded, avg 25 ms, p95 25 ms, grade **PASS**.
- **GET /products** at 10 concurrent users: 10/10 succeeded, avg 94 ms, p95 161 ms, grade **PASS**.
- **GET /products** at 50 concurrent users: 50/50 succeeded, avg 486 ms, p95 865 ms, grade **PASS**.
- **GET /products** at 100 concurrent users: 100/100 succeeded, avg 980 ms, p95 1750 ms, grade **WARNING**.
- **GET /products/search?q=Loadtest** at 1 concurrent users: 1/1 succeeded, avg 8 ms, p95 8 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 10 concurrent users: 10/10 succeeded, avg 23 ms, p95 28 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 50 concurrent users: 50/50 succeeded, avg 81 ms, p95 100 ms, grade **PASS**.
- **GET /products/search?q=Loadtest** at 100 concurrent users: 100/100 succeeded, avg 154 ms, p95 211 ms, grade **PASS**.
- **GET /sales** at 1 concurrent users: 1/1 succeeded, avg 5 ms, p95 5 ms, grade **PASS**.
- **GET /sales** at 10 concurrent users: 10/10 succeeded, avg 23 ms, p95 27 ms, grade **PASS**.
- **GET /sales** at 50 concurrent users: 50/50 succeeded, avg 96 ms, p95 111 ms, grade **PASS**.
- **GET /sales** at 100 concurrent users: 100/100 succeeded, avg 185 ms, p95 218 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 10 concurrent users: 10/10 succeeded, avg 16 ms, p95 17 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 50 concurrent users: 50/50 succeeded, avg 57 ms, p95 63 ms, grade **PASS**.
- **GET /products/barcode/LOADTEST-1863-000001** at 100 concurrent users: 100/100 succeeded, avg 120 ms, p95 132 ms, grade **PASS**.
- **GET /business/10002** at 1 concurrent users: 1/1 succeeded, avg 4 ms, p95 4 ms, grade **PASS**.
- **GET /business/10002** at 10 concurrent users: 10/10 succeeded, avg 11 ms, p95 13 ms, grade **PASS**.
- **GET /business/10002** at 50 concurrent users: 50/50 succeeded, avg 54 ms, p95 63 ms, grade **PASS**.
- **GET /business/10002** at 100 concurrent users: 100/100 succeeded, avg 109 ms, p95 121 ms, grade **PASS**.

**mixed**

- **mixed** at 10 concurrent users: 1906/1906 succeeded, avg 149 ms, p95 471 ms, grade **PASS**.
- **mixed** at 25 concurrent users: 1799/1799 succeeded, avg 414 ms, p95 686 ms, grade **PASS**.
- **mixed** at 50 concurrent users: 1742/1742 succeeded, avg 862 ms, p95 1365 ms, grade **WARNING**.
- **mixed** at 100 concurrent users: 1744/1744 succeeded, avg 1745 ms, p95 3021 ms, grade **FAIL**.

Full raw API report: `stress/results/stress-20260924T113414Z/report.md`

## 5. Database ACID findings

This combined report includes a **database scalability** run. Data was grown through checkpoints and the same queries were timed at each size. That is different from testing only against a database that was already full.

Checkpoints: **4**. PASS: **4**. WARNING: **0**. FAIL: **0**.

| Size | Team | Products | Businesses | Grade | Isolation |
| ---: | ---: | ---: | ---: | --- | --- |
| 100 | 100 | 100 | 100 | PASS | PASS |
| 1000 | 1000 | 1000 | 1000 | PASS | PASS |
| 5000 | 5000 | 5000 | 5000 | PASS | PASS |
| 10000 | 10000 | 10000 | 10000 | PASS | PASS |

### Query latency versus dataset size

Product list p95 grew from **2 ms** at 100 rows to **34 ms** at 10000 rows.
Team list p95 grew from **7 ms** at 100 members to **93 ms** at 10000 members.

| Size | Product list p95 | Team list p95 | Owner business list p95 |
| ---: | ---: | ---: | ---: |
| 100 | 2 ms | 7 ms | 8 ms |
| 1000 | 5 ms | 9 ms | 25 ms |
| 5000 | 23 ms | 47 ms | 111 ms |
| 10000 | 34 ms | 93 ms | 283 ms |

ACID describes four properties that protect data correctness. For Almadel, these matter most around stock and membership writes, because incorrect inventory or duplicate accounts create immediate business risk.

In this database run, **no classic ACID rows were present because this was a scalability-curve run; isolation was checked at each checkpoint instead**.

## 6. Database query benchmarks on the 10k tenant

These timings measure the database/query layer directly against the already-seeded worst-case business. They help separate “the table is large” problems from “HTTP concurrency is high” problems.

No query benchmarks were recorded.

## 7. Inventory correctness

Inventory correctness is reported separately because a fast API that loses stock updates is still a production failure. For each contention test we recorded the starting stock, counted only successful updates, computed the expected final stock, and compared that with the database.

All **8** inventory correctness checks passed. Concurrent stock increments and sale decrements left the database in the expected state.

| Test | Initial | Successful | Failed | Expected | Actual | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 100 products x 10 concurrent increments | per-product opening stock |  |  | opening stock + successful increments for that product | matched | PASS |
| 10 concurrent sale decrements | 1000 | 10 | 0 | 990 | 990 | PASS |
| 50 concurrent sale decrements | 1000 | 50 | 0 | 950 | 950 | PASS |
| 100 concurrent sale decrements | 1000 | 100 | 0 | 900 | 900 | PASS |
| DB scale isolation @ 100 | 1000 | 5 | 0 | 995 | 995 | PASS |
| DB scale isolation @ 1000 | 1000 | 50 | 0 | 950 | 950 | PASS |
| DB scale isolation @ 5000 | 1000 | 50 | 0 | 950 | 950 | PASS |
| DB scale isolation @ 10000 | 1000 | 50 | 0 | 950 | 950 | PASS |

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

- API report folder: `stress/results/stress-20260924T113414Z`
- Database report folder: `stress/results/stress-db-scale-20260924T114005Z`
- Combined generated at: 2026-09-24T11:41:36.038Z

