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

**After pulling a release that adds permissions or roles, run `npm run permissions:sync`.**
It is additive and idempotent (never removes a grant, creates no demo data) and safe in any
environment, including production. `npm run permissions:sync -- --dry-run` shows what would change.
Without it, an older database answers `403 Missing permission "..."` on the new routes.

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
| `/campaigns` | Bulk email/SMS (consent-gated) |
| `/public/unsubscribe` | Public signed-link unsubscribe (no auth) |
| `/suppressions` | Per-property do-not-contact list (email/SMS) |
| `/reports` | Pipeline funnel, forecast, dashboard |
| `/notifications` | Delivery records |
| `/audit-logs` | Audit trail |
| `/retention` | Data retention |

All CRM routes (except auth / property create) require `x-property-id` or
`propertyId` in body/query — data is strictly scoped to that tenant.

Health probes:

- `GET /health` — liveness (process up)
- `GET /ready` — readiness (Postgres + Redis)

### Marketing consent & suppression

Campaigns only reach contacts who have opted in. Everyone else is recorded on the campaign as
`skipped` with a reason (`no_consent`, `unsubscribed`, `bounced`, `suppressed`, `inactive`, `no_address`).

- New and existing contacts default to `marketingConsent: false`. Set it with
  `POST/PATCH /contacts` (`marketingConsent: true` requires `consentSource`, e.g. `signup_form`).
  Every grant/revoke is audited (booleans + source only, no personal data).
- `unsubscribedAt` and `emailBounced` are system-owned. Staff cannot set them, and cannot re-grant
  consent for a contact who unsubscribed.
- `/suppressions` manages the per-property list (`suppressions:read` / `suppressions:manage`).
  Staff can add and remove **manual** entries; unsubscribe/bounce/complaint entries are permanent.

### Sending campaigns (asynchronous)

`POST /campaigns/:id/send` validates and returns **202** at once with the campaign in `sending`;
background workers do the work (the in-API jobs or `npm run worker`). Poll `GET /campaigns/:id`
(`status`, `totalRecipients`, `sentCount`, `skippedCount`, `failedCount`, `haltReason`).

- `GET /campaigns/:id/recipients?status=&page=&pageSize=` — paginated per-recipient outcomes.
- `POST /campaigns/:id/cancel` — stops a sending campaign; unsent recipients become `skipped`.
- `POST /campaigns/:id/retry-failed` — re-queues failed recipients (and any left unsent after a halt).
- Statuses: `draft → sending → sent | failed | cancelled`.

How it stays safe:
- All progress is in Postgres. A worker holds a time-limited **lease** on a campaign; if it dies the
  lease expires and another worker continues from the saved cursor / queued recipients.
- The segment is paged by id (no 5,000 cap). Eligibility (consent, unsubscribe, bounce, suppression)
  is checked when recipients are created **and again just before each batch is sent**.
- Delivery is **at-most-once**: a crash leaves at most one recipient `sending`, which becomes
  `failed` / `interrupted` rather than risking a duplicate email. `retry-failed` resends it.
- Rate limit: `CAMPAIGN_SEND_RATE_PER_SEC` (default 10/s) per hotel across all workers, overridable
  per hotel with `PATCH /properties/:id { "campaignSendRatePerSec": 5 }`.
- A campaign halts itself after `CAMPAIGN_MAX_CONSECUTIVE_FAILURES` (default 25) failures in a row
  (e.g. SMTP down) and keeps the rest queued. Campaigns with no progress for
  `CAMPAIGN_STALL_MINUTES` are logged as `campaigns:stalled`.
- The old response embedded up to 200 recipients in `GET /campaigns/:id`; that is gone (use the
  recipients endpoint).
- SMS campaigns are refused with 422 in production until an SMS provider exists.

### Delivery tracking & sender identity

**Bounces and complaints.** Each hotel has a webhook URL (`GET /properties/:id/sender` →
`deliveryWebhookUrl`; manager-only, treat as a secret) to paste into the email provider's
bounce/complaint settings. It accepts one provider-neutral JSON shape:

```json
POST /public/delivery-events/:propertyId?sig=…
{ "events": [ { "type": "bounce|complaint|delivered", "bounceType": "hard|soft",
                "address": "guest@example.com", "messageId": "…", "recipientId": "…", "reason": "…" } ] }
```
At least one of `address`, `messageId`, `recipientId` per event; up to 500 events per call; answers 200
with `{received, applied, ignored}`. Events are idempotent, so provider retries are safe.

- **Hard bounce** → address suppressed (reason `bounced`), contact flagged `emailBounced`, recipient
  `bounced`, campaign `bouncedCount` +1. **Soft bounce** → recorded only. **Complaint** → treated as an
  unsubscribe (contact opted out, address suppressed as `complaint`, `complainedCount` +1).
- The same rules apply to **synchronous SMTP rejections** while sending: only a dead address
  (550/551/553, 5.1.x) is a hard bounce. Policy/reputation blocks (5.7.x, 554) and 4xx errors are plain
  failures and never suppress an address. Bounces don't trip the "consecutive failures" circuit breaker.
- Each provider's own payload (SES/SNS, SendGrid, Mailgun) needs a small adapter that maps it onto the
  shape above; none is built in yet because the provider isn't chosen.

**Sender identity.** `PATCH /properties/:id/sender` sets `emailFromName`, `emailFromAddress`,
`emailReplyTo` (`null` clears). Default: the hotel name on the shared address. A custom
from-address must be on a domain listed in `EMAIL_ALLOWED_FROM_DOMAINS` (production refuses custom
addresses while that list is empty), so a hotel can't impersonate another domain through the shared
SMTP account. Per-hotel SMTP credentials are not implemented yet.

### Unsubscribe

Every campaign email gets a per-recipient signed link, a footer (hotel name + postal address) and
`List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.

- `GET /public/unsubscribe?token=` shows a confirmation page only (mail scanners prefetch links).
  `POST` performs the opt-out; it is also the one-click endpoint mail clients call.
- Opting out sets `unsubscribedAt`, clears consent and adds the address to the suppression list.
  It is idempotent; invalid, forged or expired links return 400 and change nothing.
- Email campaigns are refused (422) until the property has a postal address (`PATCH /properties/:id`).
- Production requires `PUBLIC_BASE_URL` (https) and `UNSUBSCRIBE_SECRET` (32+ chars, different from the
  JWT secrets). Rotating the secret invalidates links already sent, so rotate rarely.

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
6. Run migrations, then sync permissions: `npm run migrate:deploy && npm run permissions:sync` (do this on **every** deploy).
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
