import { isAllowedMediaUrl, localMediaPath, parseMediaHosts } from './media-hosts';

/**
 * Image loader for next/image. Addresses on an allowed host go through the optimizer (/_next/image). Anything else
 * (legacy photos on other hosts) is loaded by the browser straight from its own address, so the storefront server
 * never fetches it. Local files (starting with "/") use the optimizer as usual.
 *
 * MEDIA_ALLOWED_HOSTS is inlined at build time (next.config.ts `env`) so this works in the browser too.
 */
const hosts = parseMediaHosts(process.env.MEDIA_ALLOWED_HOSTS);

export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  const local = localMediaPath(src); // development uploads: shown straight from the API, never through the optimizer
  if (local) return local;
  const remote = /^[a-z][a-z0-9+.-]*:|^\/\//i.test(src);
  if (remote && !isAllowedMediaUrl(src, hosts)) return src;
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality || 75}`;
}
