import { z } from 'zod';
import { isAllowedMediaHost, parseMediaHosts } from '../lib/media-url.js';
import { parseTrustProxy } from './trust-proxy.js';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

// Development/test-only fallback. Production must set its own secret (enforced below).
const DEV_OTP_SECRET = 'dev-only-otp-secret-change-me-0123456789';
// Development/test-only key for encrypting stored provider credentials. Production must set its own.
const DEV_CONFIG_ENCRYPTION_KEY = 'ZGV2LW9ubHktY29uZmlnLWtleS0zMi1ieXRlcyEhISE=';

/** `NAME=` in an env file means "not set". */
const blankIsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_BASE_URL'] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    // Which peers may set X-Forwarded-For / -Host: false | true (dev only) | hop count | IP/CIDR list. See trust-proxy.ts.
    TRUST_PROXY: z
      .string()
      .default('false')
      .transform((value, ctx) => {
        try {
          return parseTrustProxy(value);
        } catch (err) {
          ctx.addIssue({ code: 'custom', message: err instanceof Error ? err.message : 'invalid value' });
          return z.NEVER;
        }
      }),

    // Keys the HMAC that stores OTP codes. At least 32 characters.
    OTP_HMAC_SECRET: z.string().min(32).default(DEV_OTP_SECRET),
    CUSTOMER_SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 7).default(12),

    // Outbound providers. Only non-live adapters exist; see docs/ENVIRONMENT_VARIABLES.md.
    SMS_PROVIDER: z.enum(['log', 'disabled']).default('log'),
    PAYMENT_PROVIDER: z.enum(['none', 'fake']).default('none'),
    FAKE_PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
    POS_ADAPTER: z.enum(['none']).default('none'),

    // Base64 of 32 random bytes. Encrypts per-store provider secrets such as the Paytm merchant key.
    CONFIG_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of 32 bytes')
      .default(DEV_CONFIG_ENCRYPTION_KEY),
    // Paytm hosts. Stores use staging unless production is enabled here AND chosen in the store's settings.
    PAYTM_STAGING_HOST: z.url({ protocol: /^https$/ }).default('https://securestage.paytmpayments.com'),
    PAYTM_PRODUCTION_HOST: z.url({ protocol: /^https$/ }).default('https://secure.paytmpayments.com'),
    PAYTM_PRODUCTION_ENABLED: booleanString,

    // Hosts that image addresses (product photos, logo, banners) may point to: comma-separated host names or "*.host".
    // Empty accepts no new image address. The storefront reads the same variable to decide what its image optimizer may fetch.
    MEDIA_ALLOWED_HOSTS: z
      .string()
      .default('')
      .transform((value, ctx) => {
        try {
          return parseMediaHosts(value);
        } catch (err) {
          ctx.addIssue({ code: 'custom', message: err instanceof Error ? err.message : 'invalid value' });
          return z.NEVER;
        }
      }),

    // Image uploads. With none of the R2_* variables set, development uses local disk storage; production has no storage
    // and refuses uploads. All five R2_* variables switch to Cloudflare R2. Credentials stay on the server.
    MEDIA_UPLOAD_MAX_BYTES: z.coerce.number().int().min(100_000).max(20_000_000).default(8_000_000),
    MEDIA_LOCAL_DIR: z.string().min(1).default('.local-media'),
    R2_ACCOUNT_ID: blankIsUnset(z.string().regex(/^[a-f0-9]{32}$/i, 'must be the 32-character Cloudflare account id')),
    R2_ACCESS_KEY_ID: blankIsUnset(z.string().min(8).max(128)),
    R2_SECRET_ACCESS_KEY: blankIsUnset(z.string().min(16).max(256)),
    R2_BUCKET_NAME: blankIsUnset(z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')),
    R2_PUBLIC_BASE_URL: blankIsUnset(z.url({ protocol: /^https$/ })),

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.OTP_HMAC_SECRET === DEV_OTP_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['OTP_HMAC_SECRET'], message: 'must be set in production' });
    }
    if (env.CONFIG_ENCRYPTION_KEY === DEV_CONFIG_ENCRYPTION_KEY) {
      ctx.addIssue({ code: 'custom', path: ['CONFIG_ENCRYPTION_KEY'], message: 'must be set in production' });
    }
    if (env.SMS_PROVIDER === 'log') {
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: '"log" is not allowed in production' });
    }
    if (env.PAYMENT_PROVIDER === 'fake') {
      ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: '"fake" is not allowed in production' });
    }
    if (env.TRUST_PROXY === true) {
      ctx.addIssue({ code: 'custom', path: ['TRUST_PROXY'], message: '"true" trusts every peer and is not allowed in production; list the proxy addresses (IPs or CIDR ranges) or a hop count' });
    }
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'fake' && !env.FAKE_PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['FAKE_PAYMENT_WEBHOOK_SECRET'], message: 'required when PAYMENT_PROVIDER=fake' });
    }
  })
  .superRefine((env, ctx) => {
    const set = R2_VARS.filter((name) => env[name] !== undefined);
    if (set.length === 0) return;
    for (const name of R2_VARS.filter((n) => env[n] === undefined)) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'required when any R2_* variable is set (set all five or none)' });
    }
    if (set.length < R2_VARS.length) return;
    const base = new URL(env.R2_PUBLIC_BASE_URL!);
    if (base.pathname !== '/' || base.search || base.hash || base.username || base.password || base.port) {
      ctx.addIssue({ code: 'custom', path: ['R2_PUBLIC_BASE_URL'], message: 'must be an origin only, such as https://media.example.com' });
    } else if (!isAllowedMediaHost(env.MEDIA_ALLOWED_HOSTS, base.hostname)) {
      ctx.addIssue({ code: 'custom', path: ['R2_PUBLIC_BASE_URL'], message: 'its host must also be listed in MEDIA_ALLOWED_HOSTS, or uploaded images would be refused when saved' });
    }
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names only; values may be secrets.
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return parsed.data;
}

/** Config with defaults, for tests. */
export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...loadConfig({ DATABASE_URL: 'unused', NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
  ...overrides,
});
