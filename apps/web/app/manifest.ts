import type { MetadataRoute } from 'next';
import { getStore } from '@/lib/server-api';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const store = await getStore();
  return {
    name: store.name,
    short_name: store.name.slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: store.settings.theme?.background ?? '#f8f6f2',
    theme_color: store.settings.theme?.primary ?? store.settings.theme?.accent ?? '#1e3a32',
    icons: store.settings.faviconUrl ? [{ src: store.settings.faviconUrl, sizes: 'any' }] : [],
  };
}
