import type { NextConfig } from 'next';
import path from 'node:path';

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

export default nextConfig;
