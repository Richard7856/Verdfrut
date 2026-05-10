// Helper de inicialización Sentry — compartido entre las 3 apps. ADR-051.
//
// Sentry se inicializa en 3 contextos en Next.js:
//   1. sentry.client.config.ts  → browser (mapas, drag-drop, formularios)
//   2. sentry.server.config.ts  → Node.js (server components, server actions, API routes)
//   3. sentry.edge.config.ts    → Edge runtime (middleware, edge functions)
//
// Cada una llama a `Sentry.init({...})` con configuración casi idéntica pero
// con `app` tag distinto si quisiéramos diferenciar; en nuestro setup las
// 3 apps comparten el mismo DSN (Free tier = 1 proyecto) y se diferencian
// con tag `app: platform | driver | control-plane`.
//
// Variables de entorno:
//   - NEXT_PUBLIC_SENTRY_DSN: DSN público (browser + server). Si no está,
//     Sentry no se inicializa (no rompe nada).
//   - SENTRY_ENVIRONMENT: development | preview | production. Si no está,
//     se infiere de VERCEL_ENV o NODE_ENV.
//   - SENTRY_RELEASE: identificador de release (idealmente git SHA). Vercel
//     lo provee como VERCEL_GIT_COMMIT_SHA automáticamente.
//
// Sample rates:
//   - tracesSampleRate: porcentaje de transacciones que se mandan a Sentry
//     para performance tracing. 0.1 = 10%. En Free tier hay cuota separada
//     para traces, mejor empezar bajo (0.05) y subir si tenemos cuota.
//   - replaysSessionSampleRate: porcentaje de sesiones grabadas (Session Replay).
//     0 = deshabilitado (consume mucha cuota en Free).
//   - replaysOnErrorSampleRate: porcentaje de sesiones que se graban solo
//     cuando ocurre un error. 1.0 = todas. Útil para debugging post-mortem
//     sin consumir cuota normal.

import type * as SentryNs from '@sentry/nextjs';

type SentryNamespace = typeof SentryNs;

export interface SentryInitOptions {
  /** Identificador de la app — tag global en todos los eventos. */
  app: 'platform' | 'driver' | 'control-plane';
  /** Contexto donde se inicializa: browser, server, edge. Cambia integraciones. */
  context: 'client' | 'server' | 'edge';
}

function resolveEnv(): string {
  return (
    process.env.SENTRY_ENVIRONMENT ||
    process.env.VERCEL_ENV ||
    process.env.NODE_ENV ||
    'development'
  );
}

function resolveRelease(): string | undefined {
  return process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA;
}

/**
 * Llamada que cada `sentry.{client,server,edge}.config.ts` hace.
 *
 * No re-init si el DSN no está presente — la app sigue funcionando, solo no
 * envía eventos a Sentry. Esto permite local dev sin tener que setear vars.
 */
export function initSentry(Sentry: SentryNamespace, opts: SentryInitOptions): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    // No DSN configurado — no inicializar. logger sigue escribiendo a stdout.
    return;
  }

  const environment = resolveEnv();
  const release = resolveRelease();

  Sentry.init({
    dsn,
    environment,
    release,
    // Tags globales — todas las apps comparten DSN, este es el discriminador.
    initialScope: {
      tags: {
        app: opts.app,
        context: opts.context,
      },
    },
    // Performance tracing — bajo al principio para no quemar cuota Free.
    tracesSampleRate: environment === 'production' ? 0.05 : 1.0,
    // Session Replay: deshabilitado en server/edge (no aplica). En client
    // solo graba sesiones donde ocurrió un error.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: opts.context === 'client' ? 1.0 : 0,
    // Filtros para reducir ruido. Errores conocidos / triviales se descartan
    // antes de enviar — ahorran cuota y dejan el dashboard limpio.
    ignoreErrors: [
      // Errores de red comunes en mobile que no son nuestros bugs.
      'NetworkError',
      'Failed to fetch',
      'Load failed',
      // ResizeObserver loop limit — falso positivo en algunos browsers.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // Errores de extensiones del browser.
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
    ],
    // En desarrollo no enviar nada a Sentry — ruido innecesario. Pero permite
    // probar el flujo seteando SENTRY_FORCE_LOCAL=1.
    enabled: environment !== 'development' || process.env.SENTRY_FORCE_LOCAL === '1',
    // Debug solo en development para ver qué se envía.
    debug: environment === 'development',
  });
}
