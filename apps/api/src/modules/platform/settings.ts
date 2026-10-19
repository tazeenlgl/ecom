import { z } from 'zod';

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const httpsUrl = z.url({ protocol: /^https$/ }).max(500);

/** Browser-safe store settings, returned by `GET /v1/storefront/store`. Brand look-and-feel lives here, not in code. */
export const publicSettingsSchema = z
  .object({
    theme: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,40}$/), z.union([hexColour, z.string().max(100)])).optional(),
    logoUrl: httpsUrl.optional(),
    faviconUrl: httpsUrl.optional(),
    announcement: z.string().max(300).optional(),
    contact: z.object({ email: z.email().optional(), phone: z.string().max(20).optional() }).strict().optional(),
    social: z.record(z.enum(['instagram', 'facebook', 'youtube', 'x', 'whatsapp', 'pinterest']), httpsUrl).optional(),
    seo: z
      .object({ titleTemplate: z.string().max(120).optional(), defaultDescription: z.string().max(300).optional() })
      .strict()
      .optional(),
  })
  .strict();

/** Server-only store configuration. */
export const storeConfigSchema = z
  .object({
    orderNumberPrefix: z.string().regex(/^[A-Z0-9]{1,8}$/).optional(),
    codEnabled: z.boolean().optional(),
    codMaxOrderPaise: z.number().int().positive().optional(),
    unpaidOrderTtlMinutes: z.number().int().min(5).max(24 * 60).optional(),
  })
  .strict();

export type PublicSettings = z.infer<typeof publicSettingsSchema>;
