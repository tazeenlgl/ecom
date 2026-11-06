import { describe, expect, it, vi } from 'vitest';
import { checkMediaUrl } from '../../api/src/lib/media-url';
import { isAllowedMediaUrl, parseMediaHosts, remotePatternsFor } from '../lib/media-hosts';

const HOSTS = ['cdn.example.com', '*.img.example.org'];

const URLS = [
  'https://cdn.example.com/a.jpg', 'https://CDN.EXAMPLE.COM:443/a.jpg', 'https://a.img.example.org/x.png', 'http://cdn.example.com/a.jpg', '//cdn.example.com/a.jpg',
  'javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://user:pw@cdn.example.com/a.jpg', 'https://cdn.example.com@evil.example/a.jpg', 'https://evil.example\\@cdn.example.com/a.jpg',
  'https://127.0.0.1/a.jpg', 'https://169.254.169.254/latest', 'https://2130706433/a.jpg', 'https://0x7f.1/a.jpg', 'https://127.1/a.jpg', 'https://[::1]/a.jpg', 'https://[::ffff:127.0.0.1]/a.jpg',
  'https://localhost/a.jpg', 'https://intranet/a.jpg', 'https://printer.local/a.jpg', 'https://cdn.example.com./a.jpg', 'https://cdn.example.com:8443/a.jpg', 'https://cdn.example.com/a.jpg#x',
  'https://evil.example/a.jpg', 'https://cdn.example.com.evil.example/a.jpg', 'https://evilcdn.example.com/a.jpg', 'https://x.cdn.example.com/a.jpg', 'https://img.example.org/a.jpg',
  'https://a.b.img.example.org/a.jpg', 'https://xn--cdn-example-9gb.com/a.jpg', 'https://cdn.example.com/a b.jpg', 'https://cdn.example.com/a.jpg\n', 'https://cdn.exa\u0000mple.com/a.jpg', '',
  `https://cdn.example.com/${'a'.repeat(1000)}`,
];

describe('storefront image host policy', () => {
  it('agrees with the API policy on every address in the table (the two copies must not drift)', () => {
    for (const url of URLS) expect(isAllowedMediaUrl(url, HOSTS), JSON.stringify(url)).toBe(checkMediaUrl(url, HOSTS).ok);
  });

  it('parses the variable like the API, but drops bad entries instead of failing', () => {
    expect(parseMediaHosts(' CDN.example.com, *.img.example.org ,cdn.example.com')).toEqual(['cdn.example.com', '*.img.example.org']);
    expect(parseMediaHosts(undefined)).toEqual([]);
    expect(parseMediaHosts('*,**,localhost,127.0.0.1,[::1],https://x.example,cdn.example.com')).toEqual(['cdn.example.com']);
  });

  it('builds https, default-port patterns and nothing for an empty list', () => {
    expect(remotePatternsFor(HOSTS)).toEqual([
      { protocol: 'https', hostname: 'cdn.example.com', port: '' },
      { protocol: 'https', hostname: '*.img.example.org', port: '' },
    ]);
    expect(remotePatternsFor([])).toEqual([]);
  });
});

describe('next.config image settings', () => {
  const loadConfig = async (hosts: string | undefined) => {
    vi.resetModules();
    if (hosts === undefined) delete process.env.MEDIA_ALLOWED_HOSTS;
    else process.env.MEDIA_ALLOWED_HOSTS = hosts;
    return (await import('../next.config')).default;
  };

  it('has no wildcard host: the optimizer is not an open proxy', async () => {
    for (const hosts of [undefined, '', 'cdn.example.com,*.img.example.org', '*,**']) {
      const config = await loadConfig(hosts);
      const patterns = config.images?.remotePatterns ?? [];
      expect(JSON.stringify(patterns)).not.toContain('"**"');
      expect(patterns.every((p) => 'hostname' in p && p.hostname !== '*' && p.hostname !== '**' && p.protocol === 'https')).toBe(true);
    }
    expect((await loadConfig(undefined)).images?.remotePatterns).toEqual([]);
    expect((await loadConfig('cdn.example.com')).images?.remotePatterns).toEqual([{ protocol: 'https', hostname: 'cdn.example.com', port: '' }]);
  });

  it("matches only the allowed hosts, https and the default port, using Next's own matcher", async () => {
    const { hasRemoteMatch } = await import('next/dist/shared/lib/match-remote-pattern');
    const config = await loadConfig('cdn.example.com,*.img.example.org');
    const patterns = config.images?.remotePatterns as Parameters<typeof hasRemoteMatch>[1];
    const allowed = (u: string) => hasRemoteMatch([], patterns, new URL(u));
    expect(allowed('https://cdn.example.com/a.jpg')).toBe(true);
    expect(allowed('https://a.img.example.org/a.jpg')).toBe(true);
    for (const u of ['https://evil.example/a.jpg', 'https://127.0.0.1/a.jpg', 'https://localhost/a.jpg', 'https://[::1]/a.jpg', 'https://169.254.169.254/x', 'http://cdn.example.com/a.jpg', 'https://cdn.example.com:8443/a.jpg', 'https://x.cdn.example.com/a.jpg', 'https://img.example.org/a.jpg']) {
      expect(allowed(u), u).toBe(false);
    }
    // Next's "*" is wider than ours: it also matches deeper sub-domains of the wildcard domain. The API accepts one
    // label only, so stored addresses stay narrow; use a wildcard only for a domain the owner controls entirely.
    expect(allowed('https://a.b.img.example.org/a.jpg')).toBe(true);
  });

  it('limits upstream size and cache, keeps SVG off, and uses the loader', async () => {
    const images = (await loadConfig('cdn.example.com')).images!;
    expect(images.maximumResponseBody).toBeLessThanOrEqual(10_000_000);
    expect(images.maximumDiskCacheSize).toBeGreaterThan(0);
    expect(images.dangerouslyAllowSVG).toBe(false);
    expect(images.loaderFile).toBe('./lib/image-loader.ts');
  });
});

describe('image loader', () => {
  const load = async (hosts: string) => {
    vi.resetModules();
    process.env.MEDIA_ALLOWED_HOSTS = hosts;
    return (await import('../lib/image-loader')).default;
  };

  it('sends allowed hosts and local files through the optimizer', async () => {
    const loader = await load('cdn.example.com');
    expect(loader({ src: 'https://cdn.example.com/a.jpg', width: 640, quality: 80 })).toBe('/_next/image?url=https%3A%2F%2Fcdn.example.com%2Fa.jpg&w=640&q=80');
    expect(loader({ src: '/logo.png', width: 96 })).toBe('/_next/image?url=%2Flogo.png&w=96&q=75');
  });

  it('never routes other hosts through the server: the browser loads them directly', async () => {
    const loader = await load('cdn.example.com');
    for (const src of ['https://evil.example/a.jpg', 'https://127.0.0.1/a.jpg', 'http://cdn.example.com/a.jpg', '//evil.example/a.jpg', 'https://cdn.example.com:8443/a.jpg']) {
      expect(loader({ src, width: 640 }), src).toBe(src);
    }
  });

  it('with no allowed hosts sends no remote image through the server', async () => {
    const loader = await load('');
    expect(loader({ src: 'https://cdn.example.com/a.jpg', width: 640 })).toBe('https://cdn.example.com/a.jpg');
  });
});
