import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Development uploads only: the API serves them at /v1/media (that route exists only with local storage in development).
  async rewrites() {
    return process.env.NODE_ENV === 'production' ? [] : [{ source: '/dev-media/:path*', destination: `${(process.env.ADMIN_API_URL ?? 'http://localhost:4000').replace(/\/$/, '')}/v1/media/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
