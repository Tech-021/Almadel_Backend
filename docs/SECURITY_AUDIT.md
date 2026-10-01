# Almadel Backend — Security Audit

**Date:** 2026-09-30  
**Scope:** Dual-client use — Android app + Vercel web frontend → `almadel-backend`  
**Overall grade:** **RISK** (architecture mostly sound; production config not launch-safe)

---

## Executive summary

The same API can securely serve both Android and Vercel:

- Bearer JWT for both clients
- CORS for browser; native Android does not use CORS
- Nginx TLS → `127.0.0.1:4001`
- Membership-based tenant isolation
- Stripe webhook signature verification
- Socket.IO JWT + business room checks

**Do not treat the current deployment as “production-secure” until the FAIL items below are fixed.**

---

## Verdict matrix

| Severity | Area | Verdict |
| --- | --- | --- |
| FAIL | Auth rate limits disabled in live `.env` | Must fix |
| FAIL | `.env` file mode world-readable (`644`) | Must fix |
| FAIL | Git-tracked PostgreSQL dump in repo | Must fix |
| RISK | `NODE_ENV` not forced to production; Stripe test keys; weak signup password rules | Fix before / at launch |
| PASS | JWT fail-closed, authVersion, bcrypt users, Stripe webhook, Socket auth, tenant scoping | Good enough |

---

## What is already solid (PASS)

### Authentication
- JWT fail-closed; secret required at startup (min length enforced)
- Access tokens include `authVersion`; password change invalidates old tokens
- User passwords hashed with bcrypt
- Password reset: random token, hashed at rest, TTL, single-use, generic responses

### Authorization & tenancy
- Routes use `requireAuth` → `requireBusiness` → role gates
- Platform admin does not silently bypass tenant membership
- Most mutations scope by `req.businessId` from membership, not client-trusted body IDs

### Transport & edge
- API bound to loopback (`API_HOST=127.0.0.1`)
- Nginx TLS termination (e.g. 4443) with proxy to local Node
- CORS allowlist for Vercel origin; no Origin → allowed (correct for mobile)

### Payments & realtime
- Stripe webhooks require signature + raw body (fail-closed)
- Socket.IO authenticates JWT + `authVersion`; `business.join` checks membership

### Data access
- Prisma parameterized queries / tagged `$queryRaw` (no app-route SQL injection pattern found)
- Stress scripts refuse non-`almadel_stress` databases

---

## FAIL — must fix before production

### 1. Auth rate limits disabled
- **Finding:** `AUTH_RATE_LIMIT_DISABLED=true` in live `.env`
- **Impact:** Sign-in / forgot-password / reset can be brute-forced or spammed
- **Fix:** Set `AUTH_RATE_LIMIT_DISABLED=false` (or remove the variable) and restart `almadel-backend`

### 2. `.env` world-readable
- **Finding:** `.env` / related env files may be mode `644`
- **Impact:** Any local OS user can read JWT secret, DB URL, Stripe, SMTP, Resend keys
- **Fix:**
  ```bash
  chmod 600 /var/www/Almadel_Backend/.env /var/www/Almadel_Backend/.env.stress
  ```

### 3. Database dump tracked in git
- **Finding:** `inventory_app_before_migration.dump` (or similar) appears git-tracked
- **Impact:** Possible PII / password hashes / credentials if ever pushed remotely
- **Fix:** Remove from git history if pushed; delete locally if unused; add to `.gitignore`; rotate secrets if exposure is confirmed

---

## RISK — fix before or at launch

### 4. `NODE_ENV` not production
- **Impact:** Non-production mode allows looser CORS (e.g. localhost origins)
- **Fix:** Ensure PM2 / process has `NODE_ENV=production`

### 5. Stripe still on test keys
- **Impact:** Not suitable for real charges
- **Fix:** Switch to live Stripe keys + live webhook endpoint when taking payments

### 6. Signup password policy weak — **FIXED**
- **Finding:** Reset flow enforced min length; signup did not
- **Fix applied:** Shared `validatePassword()` in `utils/validators.js` — 8–128 chars, letter + number, no spaces — used on signup, reset, and admin staff create/update

### 7. Long-lived JWT, no refresh tokens
- **Finding:** Access token expiry ~7 days; no refresh rotation
- **Impact:** Stolen token usable longer (especially on mobile)
- **Fix (nice → recommended):** Shorter access JWT + refresh tokens

### 8. Silent `x-business-id` fallback
- **Finding:** Wrong/foreign business header may fall back to first membership instead of 403
- **Impact:** Multi-business users could hit the wrong tenant (today often one business per user)
- **Fix:** Reject unmatched `x-business-id` with 403

### 9. Load-test / QA leftovers in live `.env`
- **Finding:** `API_TEST_*` and similar client test credentials may remain in production env
- **Impact:** Extra secret surface; confusion about prod vs test
- **Fix:** Remove from production `.env`; keep only in local/stress configs

### 10. Weak platform admin password pattern
- **Finding:** Default/short `ADMIN_PASSWORD` style values are risky if unchanged
- **Fix:** Strong unique admin password; rotate if ever shared

### 11. Customer password hashing weaker than users
- **Finding:** Customer passwords may use unsalted SHA-256 vs bcrypt for users
- **Impact:** Weaker if customer login is used
- **Fix:** Align on bcrypt/argon2

### 12. Public uploads + MIME-only checks
- **Finding:** `/uploads` unauthenticated; multer trusts Content-Type
- **Impact:** Spoofed uploads / enumerable image URLs
- **Fix:** Magic-byte validation; optional signed URLs

### 13. Checkout return URLs not allowlisted
- **Finding:** Client-supplied Stripe `successUrl` / `cancelUrl` may not be restricted to known frontends
- **Impact:** Open-redirect style abuse after Checkout
- **Fix:** Allowlist Vercel / app deep-link origins only

### 14. Staff visibility inconsistencies
- **Finding:** Staff may list all sales / see reports while invoice detail is self-scoped
- **Impact:** Broader data exposure than intended
- **Fix:** Align list/report access with product policy (`requireFinanceAccess` where needed)

### 15. SMTP TLS `rejectUnauthorized: false`
- **Impact:** Mail path vulnerable to MITM
- **Fix:** Valid certs + strict TLS verification

### 16. No general API rate limit / no helmet
- **Impact:** Abuse beyond auth endpoints; fewer browser security headers
- **Fix:** Global rate limit (Redis-backed if multi-instance); `helmet` behind nginx

### 17. Plaintext staff passwords emailed on create
- **Impact:** Inbox / phishing exposure (product choice)
- **Mitigation:** Force password change on first login; prefer invite links

---

## Dual-client security model

| Client | How it authenticates | Notes |
| --- | --- | --- |
| Vercel web | `Authorization: Bearer <jwt>` + CORS allowlist | Only listed origins |
| Android | Same Bearer JWT | No CORS; use HTTPS to nginx |
| Both | `x-business-id` (optional) | Must match membership |

**Recommendation:** One hardened backend for both clients — do not fork security policy per client.

---

## Must-fix checklist (launch gate)

- [ ] `AUTH_RATE_LIMIT_DISABLED=false` (or unset) + restart API
- [ ] `chmod 600` on `.env` / `.env.stress`
- [ ] `NODE_ENV=production` in PM2 process env
- [ ] Remove `API_TEST_*` secrets from production `.env`
- [ ] Untrack/delete DB dump; rotate if exposed
- [x] Enforce signup password policy (length + letter + number)
- [ ] Live Stripe keys + webhook when charging real money
- [ ] Confirm nginx TLS-only public exposure (Node stays on 127.0.0.1)

---

## Nice-to-have (post-launch hardening)

- [ ] Refresh token flow for mobile
- [ ] 403 on invalid `x-business-id`
- [ ] Stripe return URL allowlist
- [ ] Upload magic-byte checks
- [ ] Helmet + global API rate limits
- [ ] Bcrypt/argon2 for customer passwords
- [ ] Finance-gate sensitive reports
- [ ] Align staff sales list vs invoice scoping

---

## Related docs

- Redis complement (not a security boundary for money/stock): [`REDIS.md`](./REDIS.md)
- ACID integrity hardening: [`ACID_INTEGRITY_HARDENING_REPORT.md`](./ACID_INTEGRITY_HARDENING_REPORT.md)

---

## Bottom line for stakeholders

| Question | Answer |
| --- | --- |
| Can one backend serve Android + Vercel securely? | **Yes — by design** |
| Is it protected enough **today**? | **No — RISK until FAIL config items are cleared** |
| Main gap | **Ops/config** (rate limits, env perms, NODE_ENV, Stripe/test leftovers), not missing dual-client architecture |
