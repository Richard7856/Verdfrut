import type { NextConfig } from 'next';
import path from 'node:path';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  // Indica a Turbopack que el root del workspace está dos niveles arriba.
  // Sin esto, Next infiere mal el root cuando hay múltiples lockfiles en el sistema.
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
  ],
  // Imágenes desde Supabase Storage (públicas).
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  // Headers de seguridad básicos.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

// ADR-051: wrappear next.config con Sentry para que el build:
//   1. Genere source maps en producción.
//   2. (Si SENTRY_AUTH_TOKEN está set) los suba a Sentry vía CLI.
//   3. Tunneleé los eventos para evitar ad-blockers (tunnelRoute).
//
// La configuración Sentry runtime (DSN, environment) vive en
// sentry.{client,server,edge}.config.ts — esto es solo build-time.
export default withSentryConfig(nextConfig, {
  // Identificador de organización + proyecto en Sentry. La org se infiere
  // del DSN; el project name es el slug visible en la URL del proyecto.
  org: process.env.SENTRY_ORG ?? 'tripdrive',
  project: process.env.SENTRY_PROJECT ?? 'tripdrive',
  // Si SENTRY_AUTH_TOKEN está set, suba source maps automáticamente.
  // Si no, el build sigue funcionando — solo no podrás ver stack traces
  // legibles en Sentry hasta configurarlo en Vercel.
  silent: !process.env.CI, // solo loguea uploads en CI/Vercel build
  // Ruta interna para tunelar eventos — evade ad-blockers en el cliente.
  tunnelRoute: '/monitoring',
  // Source maps: subir y luego eliminar de los assets públicos. Las stack
  // traces siguen siendo legibles en Sentry pero no expones el código fuente.
  hideSourceMaps: true,
  // No instrumentar React Server Components — agregar capa mínima al server.
  disableLogger: true,
});
