import type { NextConfig } from 'next';
import path from 'node:path';
import withSerwistInit from '@serwist/next';
import { withSentryConfig } from '@sentry/nextjs';

// Serwist envuelve la config de Next y compila nuestro service worker fuente
// (src/app/sw.ts) a public/sw.js. El SW se registra automáticamente por
// el plugin via el componente RegisterServiceWorker en el layout.
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // En dev no genera SW para evitar problemas de cache mientras se itera.
  disable: process.env.NODE_ENV === 'development',
  // Cache strategy: los assets estáticos se precachean; las API quedan online-only
  // (sin cache para no servir datos viejos al chofer).
  cacheOnNavigation: true,
});

const nextConfig: NextConfig = {
  // Indica a Turbopack que el root del workspace está dos niveles arriba.
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  // Permite imports desde packages del workspace.
  transpilePackages: [
    '@verdfrut/ai',
    '@verdfrut/maps',
    '@verdfrut/observability',
    '@verdfrut/supabase',
    '@verdfrut/types',
    '@verdfrut/ui',
    '@verdfrut/utils',
    '@verdfrut/flow-engine',
  ],
  // Imágenes de evidencia desde Supabase Storage.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Headers de seguridad. La PWA va en HTTPS en prod (Traefik), así que CSP
  // estricta puede llegar después; aquí los headers básicos.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Permite que el SW controle todo el origin.
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

// Wrappear con Serwist primero (compila el SW) y luego Sentry (source maps).
// Orden importa: Sentry necesita la config final para inyectar sus webpack
// loaders.
export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG ?? 'tripdrive',
  project: process.env.SENTRY_PROJECT ?? 'tripdrive',
  silent: !process.env.CI,
  tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
});
