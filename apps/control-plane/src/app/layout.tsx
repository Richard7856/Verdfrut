// Root layout del Control Plane TripDrive.
// Sidebar siempre dark (decisión de identidad). El topbar lo agrega cada
// (app)/layout.tsx para no romper la página de login.

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@tripdrive/ui';
import './globals.css';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'TripDrive Control Plane', template: '%s · TripDrive CTRL' },
  description: 'Panel de administración de TripDrive SaaS — tenants, KPIs agregados, billing.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" data-theme="dark" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
