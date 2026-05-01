// Root layout — aplica a TODA la app.
// Tema, fuentes, Toaster global. Auth y tenant resolution viven en sub-layouts.

import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@verdfrut/ui';
import './globals.css';

// Geist es la fuente oficial de la identidad VerdFrut. next/font la auto-hostea
// y la inyecta como CSS variable, que tokens.css ya consume vía --vf-font-sans.
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
    default: 'VerdFrut',
    template: '%s · VerdFrut',
  },
  description: 'Plataforma de optimización y ejecución de rutas de reparto',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16a34a',
};

// Tema por default — el toggle dark/light se implementa después de Fase 1.
// Por ahora forzamos data-theme="light" para que coincida con el área de contenido del screenshot
// (el sidebar es oscuro siempre por diseño, no por tema).
const DEFAULT_THEME: 'light' | 'dark' = 'light';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es-MX"
      data-theme={DEFAULT_THEME}
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
