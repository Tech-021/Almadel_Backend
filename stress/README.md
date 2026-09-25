# Almadel stress suite

API load tests and database volume seeds are separate. `npm run stress:all` runs the API suites in order and does not seed 10,000-row datasets. The default profile is `smoke`.

## Endpoints this suite calls

Derived from the current routes:

| Action | Method and path | Payload |
| --- | --- | --- |
| Owner sign-up | `POST /auth/sign-up` | `fullName`, `email`, `password`. The account role is `admin`. |
| Sign-in | `POST /auth/sign-in` | `email`, `password` |
| Business create | `POST /business/setup` | `name`, `mobileNumber`, `businessType` |
| Business list | `GET /business/my-businesses` | |
| Business detail | `GET /business/:id` | |
| Team create | `POST /admin/staff` | `fullName`, `email`, `password`, `role` = `staff` or `accountant` |
| Team list | `GET /admin/staff` | Returns every member. No page parameter. |
| Product create | `POST /products` | `barcode`, `name`, `sku`, `category`, `costPrice`, `sellingPrice`, `stock` |
| Product list | `GET /products` | Returns every product. No page parameter. |
| Product search | `GET /products/search?q=` | Stops at 50 rows. |
| Product lookup | `GET /products/barcode/:barcode` | |
| Stock add | `POST /stock/add` | `barcode`, `quantity`, `note` |
| Sale decrement | `POST /sales/checkout` | `items[{ productId, quantity }]`, `paymentMethod`, `discountType` |
| Customer create | `POST /customers` | `name`, `mobile`, `email?` |
| Customer list / history | `GET /customers`, `GET /customers/:id/history` | List is not paginated |
| Finance account | `POST /finance/accounts` | `name`, `type?`, `openingBalance?` |
| Finance expense | `POST /finance/expenses` | `accountId`, `amount`, `category` |
| Finance ledger | `POST /finance/transactions` | `accountId`, `amount`, `direction` |
| Finance lists / summary | `GET /finance/accounts|expenses|payments|reports/summary` | Date filters default to today |
| Reports | `GET /reports/sales|products|stock` | Read-only analytics |
| Dashboard | `GET /dashboard` | |
| Sales list | `GET /sales` | |

There is no stock table. Stock is `products.stock`. History is `stock_logs`, written by `POST /stock/add`. Checkout decrements stock inside a transaction.

Admin routes require the user role `admin` and header `x-business-id` when the user has more than one business.

## Safety

Every script loads `.env.stress` and exits unless all of these are true:

- `NODE_ENV=stress`
- `STRESS_TEST=true`
- `DATABASE_URL` database name is `almadel_stress`

The API process must use that same database. Before API tests, the runner creates a probe user through HTTP and checks that the row exists in `almadel_stress`. If the running API points somewhere else, the run stops.

Create the database and apply the Prisma schema to it before seeding or testing:

```bash
createdb almadel_stress
cp .env.stress.example .env.stress
# edit DATABASE_URL and JWT_SECRET
DATABASE_URL="postgresql://USER:PASSWORD@127.0.0.1:5432/almadel_stress" npx prisma migrate deploy
```

Restart the API with the stress environment so team-member emails stay inside the process:

```bash
NODE_ENV=stress STRESS_TEST=true node index.js
```

When both variables are set, credential and password-reset mail is built and then discarded. Timings are appended to `stress/runtime/mail-timings.jsonl`. No SMTP or Resend call is made. Production behavior is unchanged when those variables are absent.

## Profiles

| Profile | What it does |
| --- | --- |
| `smoke` (default) | Small create counts + low concurrency for customers/finance/reports too |
| `standard` | Up to 1,000 creates for customers/expenses/ledger, concurrency up to 100 |
| `heavy` | Up to 10,000 of each, higher concurrency. Requires `--confirm-heavy` |

```bash
npm run stress:all
npm run stress -- --suite team --profile standard
npm run stress:all -- --profile heavy --confirm-heavy
```

A stage stops the ramp when the error rate goes above `STRESS_MAX_ERROR_RATE` (default 10%) or p95 goes above `STRESS_MAX_P95_MS` (default 5000). Later stages in that suite are skipped. Failures are counted and stored.

## Commands

```bash
npm run stress:business
npm run stress:team
npm run stress:products
npm run stress:stock
npm run stress:customers
npm run stress:finance
npm run stress:reports
npm run stress:reads
npm run stress:mixed
npm run stress:all

npm run stress:seed:businesses
npm run stress:seed:team
npm run stress:seed:products
npm run stress:seed:stock
npm run stress:seed:customers
npm run stress:seed:finance
npm run stress:seed:realistic

npm run stress:report
npm run stress:compare -- stress/results/<run-a> stress/results/<run-b>
npm run stress:cleanup
```

`stress:all` runs business, team, products, stock, customers, finance, reports, reads, then mixed. It does not start the seed scripts.

Recommended order for the newer UI areas:

```bash
npm run stress:seed:customers
npm run stress:seed:finance
npm run stress:customers -- --profile standard
npm run stress:finance -- --profile standard
npm run stress:reports -- --profile standard
npm run stress:db
npm run stress:combine
```

## Gap suites (high concurrency, history, images, lists, frontend)

These close the “not proven yet” items from the combined standard report:

```bash
# Stress API must be on 4010 and using almadel_stress
npm run stress:db:scale -- --profile standard --fresh
npm run stress:gaps -- --profile standard
```

Individual human-readable reports are written under `stress/results/gap-<id>/<suite>/report.md`, and a combined gap report is written to `stress/results/gap-<id>/report.md`.

Suites included:
- high-concurrency
- history
- images
- list-growth
- frontend

The seed data is already in `almadel_stress`. Run a separate DB report that does not use HTTP load:

```bash
npm run stress:db
```

This checks Atomicity, Consistency, Isolation, and Durability, times the large-tenant queries (products, staff, owner businesses), and records table/index stats.

### Database scalability curve (approved standard path)

To measure how latency changes as data grows, run checkpoint scaling. Prefer `--fresh` so the curve starts clean:

```bash
npm run stress:db:scale -- --profile standard --fresh
```

Checkpoints for standard: 100 → 1,000 → 5,000 → 10,000 businesses/team/products.

Combine the latest API report with the latest DB report:

```bash
npm run stress:combine
# or explicitly:
npm run stress:combine -- stress/results/<api-run-id> stress/results/<db-run-id>
```

`stress:db` / `stress:db:scale` do not require the API on port 4010. `stress:combine` only merges existing reports.

- `stress:seed:businesses` inserts `STRESS_BUSINESSES` (default 10,000) businesses for one seed owner. It does not add staff to each business.
- `stress:seed:team` inserts `STRESS_TEAM_MEMBERS` (default 10,000) users into one business, half staff and half accountant. This is the worst-case single tenant.
- `stress:seed:products` inserts `STRESS_PRODUCTS` products into that same business.
- `stress:seed:stock` sets stock to 1,000 and writes `STRESS_STOCK_HISTORY` log rows per product (default 1).
- `stress:seed:realistic` is the multitenant shape. The default is 10 businesses, 3 staff, 1 accountant, and 10 products each. Set `STRESS_REALISTIC_BUSINESSES=10000` and `STRESS_ALLOW_HEAVY=true` only when you intend to create that larger set.

After a seed, point reads at the worst-case business:

```bash
STRESS_READ_TARGET=seed npm run stress:reads
```

## Results

Each run writes `stress/results/<run-id>/` with `summary.json`, per-suite JSON, `errors.json`, `database-metrics.json`, `report.md`, and `report.html`.

Grades:

- PASS: error rate under 1% and p95 under 1 second
- WARNING: error rate 1–5% or p95 1–3 seconds
- FAIL: error rate above 5%, p95 above 3 seconds, or an inventory mismatch

Inventory checks compare database stock with the count of successful increments or sale decrements. A mismatch is marked `DATA INTEGRITY FAILURE`.

## Cleanup

`npm run stress:cleanup` deletes businesses whose names start with `stress_` or `loadtest_`, products whose barcodes start with `STRESS-` or `LOADTEST-`, and users whose emails start with `stress_` or `loadtest_`. It does not delete unrelated rows.
