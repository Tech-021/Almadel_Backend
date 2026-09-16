# Backend architecture

The API uses a feature-based structure. Each business area owns its routes and
controller logic, while cross-cutting concerns live in shared middleware and
utilities.

```text
server/
├── index.js                 Process entry point
├── app.js                   Express application composition
├── db.js                    Shared Prisma client
├── create-admin.js          Admin provisioning script
├── middleware/
│   ├── auth.js              Authentication and role authorization
│   └── error-handler.js     404 and unexpected-error responses
├── modules/
│   ├── admin/
│   ├── auth/
│   ├── dashboard/
│   ├── health/
│   ├── products/
│   ├── sales/
│   └── stock/
└── utils/
    ├── numbers.js           Numeric input parsing
    └── serializers.js       API response mapping
```

## Request flow

```text
HTTP request
  → app.js
  → feature router
  → authentication/authorization middleware
  → feature controller
  → Prisma
  → JSON response
```

Routers define URLs and middleware only. Controllers validate request data,
execute business operations, and shape HTTP responses. Services hold reusable
infrastructure or domain logic, such as JWTs, reset tokens, and email delivery.

## Adding a feature

1. Create `server/modules/<feature>/`.
2. Add `<feature>.routes.js`.
3. Add `<feature>.controller.js`.
4. Add focused service files when logic is reusable or infrastructure-specific.
5. Mount the router in `server/app.js`.

Keep environment loading in `server/index.js`, database access through
`server/db.js`, and cross-feature request concerns in `server/middleware/`.
