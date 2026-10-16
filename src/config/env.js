require('dotenv').config();
const { z } = require('zod');

const PLACEHOLDER_SECRETS = new Set([
  'change_me_access_secret',
  'change_me_refresh_secret',
  'changeme',
  'secret',
  'password',
]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    /** Comma-separated browser origins. Required in production. */
    CORS_ORIGINS: z.string().optional(),
    /** Express trust proxy hops (0 = off). Use 1 behind a single reverse proxy. */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
    RATE_LIMIT_MAX: z.coerce.number().default(300),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(15 * 60 * 1000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
    LOGIN_MAX_FAILURES: z.coerce.number().default(5),
    LOGIN_LOCKOUT_SECONDS: z.coerce.number().default(15 * 60),

    /**
     * Run the outbox dispatcher, reminder sweep and housekeeping inside the API process.
     * Safe alongside separate `npm run worker` processes (work is claimed with row locks), so
     * the default is on. Set to false on API instances when workers run separately.
     */
    RUN_WORKERS_IN_API: z
      .string()
      .optional()
      .transform((v) => !(v === 'false' || v === '0')),
    /** After this many failed deliveries an outbox event is dead-lettered (status=failed). */
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(8),

    /** When unset in production, email sends fail closed (no silent stub). */
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().optional(),
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => v === 'true' || v === '1'),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_FROM: z.string().optional(),

    /** Public origin of this API, used to build links in emails (e.g. https://api.example.com). */
    PUBLIC_BASE_URL: z.string().url().optional(),
    /** HMAC key for unsubscribe links. Must differ from the JWT secrets. Required in production. */
    UNSUBSCRIBE_SECRET: z.string().min(16, 'UNSUBSCRIBE_SECRET must be at least 16 chars').optional(),
    /** How long an unsubscribe link stays valid (CAN-SPAM requires at least 30 days). */
    UNSUBSCRIBE_TOKEN_TTL_DAYS: z.coerce.number().int().min(30).default(365),

    /**
     * Domains a hotel may use as its campaign "from" address (comma-separated), e.g. the platform's
     * own verified domain(s). Prevents one tenant spoofing another company's domain through the shared
     * SMTP account. Empty = custom from-addresses are refused in production (allowed in development).
     */
    EMAIL_ALLOWED_FROM_DOMAINS: z.string().optional(),
    /** Secret behind the per-hotel delivery-event webhook URLs. Defaults to a key derived from UNSUBSCRIBE_SECRET. */
    DELIVERY_WEBHOOK_SECRET: z.string().min(16, 'DELIVERY_WEBHOOK_SECRET must be at least 16 chars').optional(),

    /** Campaign sending: default msgs/second per hotel (a hotel can override it), and worker tuning. */
    CAMPAIGN_SEND_RATE_PER_SEC: z.coerce.number().int().min(1).max(1000).default(10),
    CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    /** One worker owns a campaign for at most this long per pass, then yields so others get a turn. */
    CAMPAIGN_SLICE_MS: z.coerce.number().int().min(1000).default(30_000),
    CAMPAIGN_LEASE_MS: z.coerce.number().int().min(5_000).default(60_000),
    /** Sending stops itself after this many failures in a row (e.g. SMTP down) instead of burning the list. */
    CAMPAIGN_MAX_CONSECUTIVE_FAILURES: z.coerce.number().int().min(1).default(25),
    /** A sending campaign with no progress for this long is logged as stalled. */
    CAMPAIGN_STALL_MINUTES: z.coerce.number().int().min(1).default(15),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'production') return;

    if (data.JWT_ACCESS_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'In production, JWT_ACCESS_SECRET must be at least 32 characters',
      });
    }
    if (data.JWT_REFRESH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'In production, JWT_REFRESH_SECRET must be at least 32 characters',
      });
    }
    if (PLACEHOLDER_SECRETS.has(data.JWT_ACCESS_SECRET.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET looks like a placeholder — set a strong secret',
      });
    }
    if (PLACEHOLDER_SECRETS.has(data.JWT_REFRESH_SECRET.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET looks like a placeholder — set a strong secret',
      });
    }
    if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different',
      });
    }
    if (!data.UNSUBSCRIBE_SECRET || data.UNSUBSCRIBE_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UNSUBSCRIBE_SECRET'],
        message: 'In production, UNSUBSCRIBE_SECRET is required (at least 32 characters)',
      });
    } else if (
      data.UNSUBSCRIBE_SECRET === data.JWT_ACCESS_SECRET ||
      data.UNSUBSCRIBE_SECRET === data.JWT_REFRESH_SECRET
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['UNSUBSCRIBE_SECRET'],
        message: 'UNSUBSCRIBE_SECRET must differ from the JWT secrets',
      });
    }
    if (!data.PUBLIC_BASE_URL || !data.PUBLIC_BASE_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PUBLIC_BASE_URL'],
        message: 'In production, PUBLIC_BASE_URL is required and must be https (used for unsubscribe links)',
      });
    }
    if (!data.CORS_ORIGINS || !data.CORS_ORIGINS.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS is required in production (comma-separated origins)',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  // eslint-disable-next-line no-console
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const data = parsed.data;

// Purpose-separated key for webhook signatures (so it can't be confused with unsubscribe tokens).
const deliveryWebhookSecret =
  data.DELIVERY_WEBHOOK_SECRET ||
  require('crypto').createHmac('sha256', (data.UNSUBSCRIBE_SECRET || data.JWT_ACCESS_SECRET)).update('delivery-webhook-v1').digest('hex');

// Development convenience only: derive a distinct key from the access secret. Production is
// forced to set UNSUBSCRIBE_SECRET explicitly by the schema above.
const unsubscribeSecret =
  data.UNSUBSCRIBE_SECRET ||
  require('crypto').createHmac('sha256', data.JWT_ACCESS_SECRET).update('unsubscribe-v1').digest('hex');

module.exports = {
  ...data,
  corsOrigins: (data.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  unsubscribeSecret,
  deliveryWebhookSecret,
  emailAllowedFromDomains: (data.EMAIL_ALLOWED_FROM_DOMAINS || '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean),
  publicBaseUrl: (data.PUBLIC_BASE_URL || `http://localhost:${data.PORT}`).replace(/\/+$/, ''),
  smtpConfigured: Boolean(data.SMTP_HOST && data.EMAIL_FROM),
};
