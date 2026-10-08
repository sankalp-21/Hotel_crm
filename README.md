# Hotel CRM Backend

Sales/relationship CRM for hotels (not a PMS). Modular monolith: Node.js,
Express, PostgreSQL via Prisma. Each hotel is a `Property` tenant.

## Setup

```bash
npm install
cp .env.example .env
npx prisma migrate dev
npm run seed
npm run dev
```

**After schema/permission changes, re-run `npm run seed`.**

## API surface

| Prefix | Purpose |
|--------|---------|
| `/auth` | Auth |
| `/properties` | Tenants (scoped to user's roles) |
| `/contacts` | Contacts + timeline |
| `/companies` | Companies |
| `/pipeline` | Custom pipeline stages per tenant |
| `/deals` | Deals + transitions |
| `/activities` | Activities + reminders |
| `/segments` | Saved contact filters |
| `/campaigns` | Bulk email/SMS |
| `/reports` | Pipeline funnel, forecast, dashboard |
| `/notifications` | Delivery records |
| `/audit-logs` | Audit trail |
| `/retention` | Data retention |

All CRM routes (except auth / property create) require `x-property-id` or
`propertyId` in body/query — data is strictly scoped to that tenant.

Health probes:

- `GET /health` — liveness (process up)
- `GET /ready` — readiness (Postgres + Redis)

### Reports

- `GET /reports/dashboard` — contacts by status, deal counts, open pipeline value, open tasks, campaigns sent
- `GET /reports/pipeline?from=&to=` — funnel per stage
- `GET /reports/forecast?from=&to=` — open pipeline, won/lost, win rate

Requires `reports:read`.

## Production deploy checklist

1. Set `NODE_ENV=production`.
2. Use strong unique `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (≥32 chars each, not placeholders, not equal).
3. Set `CORS_ORIGINS` to your frontend origin(s), comma-separated.
4. Set `TRUST_PROXY=1` if behind nginx/ALB/Cloudflare.
5. Configure SMTP (`SMTP_HOST`, `EMAIL_FROM`, and usually `SMTP_USER`/`SMTP_PASS`) — without this, email sends fail closed in production.
6. Run migrations: `npm run migrate:deploy`.
7. Do **not** run `npm run seed` in production unless you set `ALLOW_PROD_SEED=true` and a strong `SEED_ADMIN_PASSWORD`.
8. Point load balancer health checks at `/ready` (not only `/health`).
9. Require `Idempotency-Key` on `POST /campaigns/:id/send` and `POST /auth/users`.
10. Change the demo admin password immediately if you ever seeded defaults.

```bash
npm start
npm test
```

## Branches

- `crm-chassis` — current CRM (Phases 0–5 + production hardening)
- `pms-experiment` — shelved PMS snapshot for cherry-picking
