import type { NextConfig } from 'next';
import { LOCAL_MEDIA_HOST, parseMediaHosts, remotePatternsFor } from './lib/media-hosts';

// Hosts the image optimizer may fetch from, shared with the API (MEDIA_ALLOWED_HOSTS). No wildcard host: an open
// optimizer lets anyone make this server request arbitrary URLs. Empty means no remote image is ever fetched here.
const mediaHosts = parseMediaHosts(process.env.MEDIA_ALLOWED_HOSTS);

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Makes the variable available to lib/image-loader.ts in the browser bundle.
  env: { MEDIA_ALLOWED_HOSTS: mediaHosts.join(',') },
  images: {
    loaderFile: './lib/image-loader.ts',
    remotePatterns: remotePatternsFor(mediaHosts.filter((h) => h !== LOCAL_MEDIA_HOST)),
    formats: ['image/avif', 'image/webp'],
    // Limits on what one optimizer request may cost: upstream body size, cache lifetime and on-disk cache size.
    maximumResponseBody: 10_000_000,
    minimumCacheTTL: 3600,
    maximumDiskCacheSize: 500_000_000,
    dangerouslyAllowSVG: false,
  },
  // Development uploads only: the API serves them at /v1/media (that route exists only with local storage in development).
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/dev-media/:path*', destination: `${(process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '')}/v1/media/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
