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

module.exports = {
  ...data,
  corsOrigins: (data.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  smtpConfigured: Boolean(data.SMTP_HOST && data.EMAIL_FROM),
};
