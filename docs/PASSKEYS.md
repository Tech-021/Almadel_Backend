# Passkeys (WebAuthn)

Passwordless sign-in in the **browser** on **desktop, laptop, and mobile** (Windows Hello, Touch ID, Chrome passkeys, USB security keys). The API is not mobile-only.

## Public config (for Vercel frontend)

`GET /auth/passkey/config` — no auth required.

Returns `enabled`, `rpId`, `rpName`, `origins`, `authenticatorTypes` (`platform`, `cross-platform`), etc. Use this instead of hard-coding mobile-only behavior or guessing `rpId`.

## Endpoints

Base path: `/auth/passkey`

| Method | Path | Auth | Notes |
|--------|------|------|--------|
| GET | `/config` | Public | Desktop + mobile capabilities |
| POST | `/register/options` | Bearer JWT | After password / magic-link login |
| POST | `/register/verify` | Bearer JWT | Body: `@simplewebauthn/browser` registration JSON |
| GET | `/credentials` | Bearer JWT | List passkeys |
| DELETE | `/credentials/:id` | Bearer JWT | Remove passkey |
| POST | `/sign-in/options` | Public | Optional `{ "email": "..." }` |
| POST | `/sign-in/verify` | Public | Body: authentication JSON → same session as `/auth/sign-in` |

Send browser requests from **https://web-app-allmadal.vercel.app** (or your `FRONTEND_URL`). The `Origin` header must match `WEBAUTHN_ORIGINS` / `CORS_ORIGINS`.

## Environment (backend / VPS `.env`)

| Variable | Purpose |
|----------|---------|
| `WEBAUTHN_RP_ID` | Must match frontend hostname, e.g. `web-app-allmadal.vercel.app` |
| `WEBAUTHN_RP_NAME` | Shown in the passkey prompt |
| `WEBAUTHN_ORIGINS` | Exact HTTPS origins allowed (Vercel + localhost for dev) |
| `WEBAUTHN_AUTHENTICATOR_ATTACHMENT` | **Leave unset** for laptop + phone + USB keys. Only set `platform` or `cross-platform` if you intentionally restrict. |
| `ENABLE_PASSKEY` | Set `false` to disable all passkey routes |

## Frontend (Vercel only — not on VPS)

Use `@simplewebauthn/browser` on the **web app**. Do **not** gate passkey UI with mobile user-agent checks; use `GET /auth/passkey/config` and `PublicKeyCredential` / secure context instead.

1. Register: `POST /auth/passkey/register/options` → `startRegistration` → `POST /auth/passkey/register/verify`
2. Sign-in: `POST /auth/passkey/sign-in/options` → `startAuthentication` → `POST /auth/passkey/sign-in/verify`

## Desktop vs mobile notes

- Same API and `rpId` for PC, Mac, and phone browsers.
- Backend does **not** filter by `User-Agent`.
- Credential `transports` are **not** sent in `allowCredentials` so a passkey registered on a phone can still be used on a laptop (synced passkeys) and vice versa.
- Registration uses `credProps` and `residentKey: preferred` for discoverable passkeys (passkey autofill on Chrome/Edge desktop).
