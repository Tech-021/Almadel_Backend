# Passkeys (WebAuthn)

Passwordless sign-in with device biometrics / security keys. **Web only** (browser `navigator.credentials`). Mobile native passkeys need platform-specific SDKs later.

## Backend API

Base path: `/auth/passkey`

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/register/options` | Bearer JWT | — | WebAuthn registration options (JSON) |
| POST | `/register/verify` | Bearer JWT | `{ ...registrationResponseFromBrowser, friendlyName? }` | `{ message, credentials[] }` |
| GET | `/credentials` | Bearer JWT | — | `{ credentials[] }` |
| DELETE | `/credentials/:id` | Bearer JWT | — | `{ message }` |
| POST | `/sign-in/options` | Public | `{ email? }` | WebAuthn authentication options |
| POST | `/sign-in/verify` | Public | authentication response from browser | Same as `POST /auth/sign-in` (token, user, businesses, …) |

Challenges are stored in Redis (5 min TTL) with an in-memory fallback.

## Environment

| Variable | Default | Notes |
|----------|---------|--------|
| `ENABLE_PASSKEY` | enabled | Set `false` to return 503 on passkey routes |
| `WEBAUTHN_RP_NAME` | `Almadel` | Shown in the passkey prompt |
| `WEBAUTHN_RP_ID` | hostname of `FRONTEND_URL` | Must match the site users sign in on (no port), e.g. `web-app-allmadal.vercel.app` |
| `WEBAUTHN_ORIGINS` | `CORS_ORIGINS` + `FRONTEND_URL` + localhost | Must include the exact browser `Origin` header |

Production example:

```env
FRONTEND_URL=https://web-app-allmadal.vercel.app
WEBAUTHN_RP_ID=web-app-allmadal.vercel.app
WEBAUTHN_ORIGINS=https://web-app-allmadal.vercel.app
```

Passkeys **do not work** on `http://65.108.249.169` — users register and sign in on the **Vercel web origin**. The API can stay on the VPS; the browser ties the passkey to the frontend hostname.

## Web app integration (Next.js / React)

Install in the **frontend** repo:

```bash
npm install @simplewebauthn/browser
```

### Register (after password login)

```typescript
import {
  startRegistration,
} from "@simplewebauthn/browser";

const API = process.env.NEXT_PUBLIC_API_URL; // https://65.108.249.169:4443

export async function registerPasskey(accessToken: string, friendlyName?: string) {
  const optionsRes = await fetch(`${API}/auth/passkey/register/options`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!optionsRes.ok) throw new Error("Could not start passkey setup");
  const options = await optionsRes.json();

  const registration = await startRegistration({ optionsJSON: options });

  const verifyRes = await fetch(`${API}/auth/passkey/register/verify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...registration, friendlyName }),
  });
  if (!verifyRes.ok) throw new Error("Passkey registration failed");
  return verifyRes.json();
}
```

### Sign in

```typescript
import { startAuthentication } from "@simplewebauthn/browser";

export async function signInWithPasskey(email?: string) {
  const optionsRes = await fetch(`${API}/auth/passkey/sign-in/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email ? { email } : {}),
  });
  if (!optionsRes.ok) throw new Error("Passkey sign-in unavailable");
  const options = await optionsRes.json();

  const authentication = await startAuthentication({ optionsJSON: options });

  const verifyRes = await fetch(`${API}/auth/passkey/sign-in/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authentication),
  });
  if (!verifyRes.ok) throw new Error("Passkey sign-in failed");
  return verifyRes.json(); // store token like password sign-in
}
```

Add a **Sign in with passkey** button on the login page. Optional `email` helps non-discoverable keys; omit it for platform autofill / passkey picker when resident keys exist.

## Migration

```bash
npx prisma migrate deploy
pm2 restart almadel-backend --update-env
```

## Security notes

- Register passkeys only while authenticated (password or magic link once).
- Removing a passkey: `DELETE /auth/passkey/credentials/:id`.
- Rotating `JWT_SECRET` does not invalidate passkeys; bumping `authVersion` on the user still invalidates JWTs from old sessions.
