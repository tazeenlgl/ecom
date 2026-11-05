import type { MetadataRoute } from 'next';
import { storeHost } from '@/lib/server-api';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = await storeHost();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/checkout', '/login', '/api/'] }],
    sitemap: `https://${host}/sitemap.xml`,
  };
}
