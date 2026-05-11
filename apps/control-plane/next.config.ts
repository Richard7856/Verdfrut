import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // Indica a Turbopack que el root del workspace está dos niveles arriba.
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  transpilePackages: [
    '@tripdrive/observability',
    '@tripdrive/supabase',
    '@tripdrive/types',
    '@tripdrive/ui',
    '@tripdrive/utils',
  ],
  // Headers de seguridad. El control plane es interno-solo, agregamos noindex
  // por si alguien lo expone públicamente por accidente — los crawlers lo ignoran.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG ?? 'tripdrive',
  project: process.env.SENTRY_PROJECT ?? 'tripdrive',
  silent: !process.env.CI,
  tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
});
