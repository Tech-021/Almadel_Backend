# ACID Integrity Hardening — Engineering Report

Date: 2026-09-30  
Migration: `20260930120000_acid_integrity_hardening`  
Scope: schema constraints + API/service transaction paths on Almadel Backend (PostgreSQL + Prisma)

---

## 1. Initial audit

### Issue 2 — Float money fields
**Current implementation:** 29 monetary fields used Prisma `Float`.  
**Risk:** Binary float drift in totals/closing (`expectedCash` vs `countedCash`).  
**Files:** `prisma/schema.prisma`, `modules/sales/checkout.service.js`, `modules/finance/finance.controller.js`, `utils/serializers.js`.  
**Chosen fix:** `Decimal @db.Decimal(14,2)` + `utils/money.js` (`Prisma.Decimal` arithmetic) + number serialization at API boundaries.

### Issue 3 — Ledger paymentId not unique
**Current implementation:** `expenseId` unique; `paymentId` nullable without unique.  
**Risk:** Duplicate ledger postings on retries.  
**Files:** `prisma/schema.prisma`, `modules/finance/payment.service.js`.  
**Chosen fix:** `@unique` on `paymentId` + idempotency key reuse in payment service.

### Issue 4 — Unguarded balance updates
**Current implementation:** `customer/supplier.update({ decrement })` without `gte` guard.  
**Risk:** Concurrent overpayment → negative balances.  
**Files:** `modules/finance/finance.controller.js` (createPayment).  
**Chosen fix:** Conditional `updateMany` with `currentBalance: { gte: amount }` inside one payment transaction. Negative balances are **not** a supported domain feature.

### Issue 5 — Missing sale stock logs / weak receiveOne
**Current implementation:** Checkout decremented stock without `stock_logs`; `receiveOne` had no tx/log.  
**Risk:** Unauditable inventory; inconsistent receive paths.  
**Files:** `modules/sales/checkout.service.js`, `modules/stock/stock.controller.js`.  
**Chosen fix:** Shared `modules/stock/stock.service.js`; checkout writes `SALE` logs; both receive paths use the same service; `CHECK (stock >= 0)`.

### Issue 6 — Sales after day close
**Current implementation:** Close transactional; checkout ignored `daily_closings`.  
**Risk:** Sales after close skew expected cash.  
**Files:** `modules/finance/finance.controller.js`, new `modules/finance/register.service.js`, checkout.  
**Chosen fix:** Checkout calls `assertRegisterOpenForCheckout` (row-lock via upsert); close uses same locking + conditional `updateMany`.

### Issue 7 — Opening cash dual source
**Current implementation:** `Business.openingCashBalance` for closing; cash account often `0`.  
**Risk:** Account balance ≠ expected cash.  
**Files:** `business-provision.service.js`, checkout account create, financial setup, closing math.  
**Chosen fix:** Provision creates `Cash in hand` with opening balance; closing prefers sticky day opening → cash account → business config.

### Issue 8 — Non-atomic onboarding fulfill
**Current implementation:** provision → stripe fields → draft delete as separate writes.  
**Risk:** Partial onboarding after crash.  
**Files:** `onboarding.service.js`, `business-provision.service.js`.  
**Chosen fix:** One `$transaction` for all local DB mutations; Stripe metadata update after commit.

### Issue 9 — SaleItem cascade on product delete
**Current implementation:** App blocked delete; FK was `onDelete: Cascade`.  
**Risk:** Hard delete wipes invoice lines.  
**Files:** `prisma/schema.prisma`, `products.controller.js`.  
**Chosen fix:** `onDelete: Restrict` + transactional delete guard mapping `P2003` → `PRODUCT_HAS_SALE_HISTORY`.

### Issue 10 — Nullable tenant businessId
**Current implementation:** Product/Sale/Customer/Supplier/StockLog/ActivityLog allowed null `businessId`.  
**Risk:** Weak tenant isolation / uniqueness.  
**Files:** schema + migration.  
**Chosen fix:** `NOT NULL` after verifying zero null rows on stress DB.

### Issue 11 — Category rename/delete non-transactional
**Current implementation:** product denorm update then category update separately.  
**Risk:** Partial rename/delete.  
**Files:** `categories.controller.js`.  
**Chosen fix:** Wrap both in `$transaction`.

### Issue 12 — Missing indexes
**Current implementation:** `sale_items` had no indexes (0 index scans in stress report).  
**Risk:** Slow joins / longer locks under concurrency.  
**Files:** schema.  
**Chosen fix:** Indexes on `sale_items(saleId, productId)`, `stock_logs(productId)`, `payments(customerId, supplierId, saleId)`.

### Issue 13 — No API-level ACID tests
**Current implementation:** DB ACID suites only.  
**Risk:** App path regressions undetected.  
**Chosen fix:** `stress/suites/acid-api.js` + `npm run stress:db:acid-api` + `npm run test:integrity`.

---

## 2. Files changed

```
prisma/schema.prisma
prisma/migrations/20260930120000_acid_integrity_hardening/migration.sql
utils/money.js                          (new)
utils/domain-errors.js                  (new)
utils/serializers.js
modules/stock/stock.service.js          (new)
modules/stock/stock.controller.js
modules/finance/payment.service.js      (new)
modules/finance/register.service.js     (new)
modules/finance/finance.controller.js
modules/sales/checkout.service.js
modules/sales/sales.controller.js
modules/categories/categories.controller.js
modules/products/products.controller.js
modules/business/business-provision.service.js
modules/business/onboarding.service.js
modules/business/business.controller.js
stress/suites/acid.js
stress/suites/acid-api.js               (new)
stress/run-db-acid-api.js               (new)
tests/integrity/money.test.js           (new)
package.json
docs/ACID_INTEGRITY_HARDENING_REPORT.md (new)
```

---

## 3. Prisma/schema changes

### Decimal conversions (29 fields)
Business, Product, SaleItem, Customer, Supplier, Sale, Account, LedgerTransaction, Expense, Payment, DailyClosing monetary fields → `Decimal @db.Decimal(14, 2)`.

### Uniqueness
- `ledger_transactions.paymentId` → `@unique`

### FK changes
- `SaleItem.product` → `onDelete: Restrict`

### NOT NULL
- `products.businessId`, `sales.businessId`, `customers.businessId`, `suppliers.businessId`, `stock_logs.businessId`, `activity_logs.businessId`

### CHECK
- `products_stock_non_negative`: `CHECK (stock >= 0)`

### Indexes added
- `sale_items_saleId_idx`, `sale_items_productId_idx`
- `stock_logs_productId_idx`
- `payments_customerId_idx`, `payments_supplierId_idx`, `payments_saleId_idx`
- unique index on `ledger_transactions.paymentId`

---

## 4. Migration details

**Name:** `20260930120000_acid_integrity_hardening`

**Safety gates before constraints:**
1. Abort if any `products.stock < 0`
2. Abort if any null `businessId` on tenant tables
3. Abort if duplicate non-null `paymentId` in ledger

**Conversion:** `USING ROUND(col::numeric, 2)` for Float→Decimal.

**Production considerations:**
- Run the same preflight counts on live `almadel` before `migrate deploy`.
- If duplicates/nulls/negatives exist, backfill/resolve first — migration will refuse rather than destroy data.
- Deploy app code that understands Decimal serializers together with the migration.

---

## 5. Transaction changes

| Workflow | Transaction boundary |
| --- | --- |
| Checkout | Register open assert + stock decrement/log + sale/items + payment + ledger |
| Party payment | Account/party validate + payment + ledger + guarded balance update |
| Stock add/receive | Stock increment + stock_log |
| Expense create | Expense + ledger |
| Day close | Row-lock daily_closings + compute + conditional close |
| Category rename/delete | Product denorm + category mutation |
| Product delete | Sale-history check + stockLog clear + delete |
| Onboarding fulfill | Provision/billing fields/draft delete in one tx; Stripe after commit |
| Financial setup | Business update + cash account sync (if no ledger history) + seed rows |

---

## 6. Concurrency protection

- Stock: conditional `updateMany` (`stock >= qty`) + DB CHECK
- Customer/supplier pay: conditional `updateMany` (`currentBalance >= amount`)
- Payment ledger: unique `paymentId` + optional `idempotencyKey` reuse
- Register: `INSERT … ON CONFLICT DO UPDATE` row lock shared by checkout and close
- Close: `updateMany` where `status <> 'closed'`
- Reopen: `updateMany` where `status = 'closed'` + activity log

---

## 7. Tests created

| Test | Scenario | Expected invariant | Result |
| --- | --- | --- | --- |
| money 0.1+0.2 | Decimal add | `0.30` | PASS |
| repeated 0.1×10 | Sum loop | `1.00` | PASS |
| multi-line prices | 19.99×3 + 0.1×2 | `60.17` | PASS |
| expected cash | opening±flows | exact 2dp | PASS |
| partial payments | 100−33.33… | exact remainders | PASS |
| calculateTotals | item+cart discount | 19 / 81 | PASS |
| Concurrent checkout×10 | stock=1 | 1 sale, stock=0, 1 log | PASS |
| Payments 80+80 | balance 100 | 1 ok, balance 20 | PASS |
| Payments 50+50 | balance 100 | both ok, balance 0 | PASS |
| Payment idempotency | same key twice | one effect | PASS |
| Closed register checkout | closed day | `REGISTER_CLOSED` | PASS |
| Checkout vs close race | parallel | valid serialization | PASS |
| Receive rollback | forced fail | no partial | PASS |
| Receive success | +3 | stock+log | PASS |
| Category rename rollback | forced fail | consistent names | PASS |
| Product delete restrict | sale exists | FK blocks | PASS |

---

## 8. Test results

```
Unit (money integrity):     7/7 PASS     (npm run test:integrity)
API/service ACID:          10/10 PASS    (npm run stress:db:acid-api)
Dedicated DB ACID:         33/33 PASS    (npm run stress:db:acid)
DB suite (smoke):          15/15 PASS    (npm run stress:db -- --profile smoke)
Prisma validate:           PASS
TypeScript:                N/A (JS project)
Lint:                      N/A (no lint script configured)
```

Reports:
- `stress/results/stress-db-acid-20260930T113958Z/report.md`
- `stress/results/stress-db-acid-api-20260930T114011Z/report.md`
- `stress/results/stress-db-20260930T114022Z/report.md`

---

## 9. Remaining risks

1. **Live DB preflight not executed here** — `.env` SMTP quoting blocked a quick live psql check; run null/duplicate/negative counts on production before migrate.
2. **API responses now normalize money via `toMoneyNumber`** on serializers/finance hot paths; some raw Prisma payloads elsewhere may still serialize Decimal as string — audit frontend tolerance if any endpoint returns raw models.
3. **Credit sales** remain unsupported by `PAYMENT_METHODS` (`cash`/`online` only); dead credit balance branch removed from active payment path.
4. **Manual ledger `createTransaction`** is still a single write (by design); not paired with party balance changes.
5. **Onboarding Stripe metadata** remains best-effort after commit; retries are idempotent for local state.

---

## 10. Recommended follow-up

1. Run migration preflight + `prisma migrate deploy` on live `almadel` during a short maintenance window.
2. Add HTTP-level stress against a running stress API for checkout/payment (in addition to in-process service tests).
3. Consider soft-delete/archive for products with sale history (UX) now that hard delete is DB-restricted.
4. Optionally add `CHECK (current_balance >= 0)` on customers/suppliers once product confirms overpayment is never allowed.
5. Centralize remaining money `Number(...)` call sites (products list stats, seeds) onto `utils/money.js`.
