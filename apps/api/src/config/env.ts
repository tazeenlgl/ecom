import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

// Development/test-only fallback. Production must set its own secret (enforced below).
const DEV_OTP_SECRET = 'dev-only-otp-secret-change-me-0123456789';
// Development/test-only key for encrypting stored provider credentials. Production must set its own.
const DEV_CONFIG_ENCRYPTION_KEY = 'ZGV2LW9ubHktY29uZmlnLWtleS0zMi1ieXRlcyEhISE=';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1),
    TRUST_PROXY: booleanString,

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
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENT_PROVIDER === 'fake' && !env.FAKE_PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['FAKE_PAYMENT_WEBHOOK_SECRET'], message: 'required when PAYMENT_PROVIDER=fake' });
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
