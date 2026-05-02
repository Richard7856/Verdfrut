// Root layout de la PWA chofer.
// Carga Geist + tokens, registra el service worker, y deja el shell minimal.

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@verdfrut/ui';
import { RegisterServiceWorker } from '@/components/register-service-worker';
import './globals.css';

const geistSans = Geist({
  subsets: ['latin'],
  variable: '--font-geist-sans',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'VerdFrut Conductor',
    template: '%s · VerdFrut',
  },
  description: 'App de chofer y supervisor de zona — VerdFrut',
  manifest: '/manifest.json',
  // iOS: meta tags equivalentes para que se comporte como app instalada.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'VerdFrut',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#16a34a' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  // Pinta el área detrás de la barra de estado en iOS.
  viewportFit: 'cover',
};

// Driver app inicia en tema claro — el chofer trabaja al aire libre,
// alto contraste y blanco son mejores para legibilidad bajo el sol.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es-MX"
      data-theme="light"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        <RegisterServiceWorker />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
