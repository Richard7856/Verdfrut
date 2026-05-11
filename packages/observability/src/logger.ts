// Logger estructurado central — ADR-051.
//
// API uniforme para reemplazar `console.*` en toda la base de código. La idea:
//   - En desarrollo imprime a stdout con formato legible.
//   - En producción envía errores (`error`) y warnings (`warn`) a Sentry como
//     eventos. Los `info` y `debug` quedan solo en stdout/logs de la plataforma
//     (Vercel runtime logs).
//
// Por qué no usar `console.*` directo:
//   1. `console.error` en producción solo va a logs de Vercel — efímeros, sin
//      búsqueda por filtros ni alertas.
//   2. Mezclar `console.*` con captura de Sentry duplica eventos.
//   3. El logger estructurado acepta un objeto `context` que serializa como
//      tags + extras en Sentry — buscable después.
//
// Cómo se usa:
//   import { logger } from '@tripdrive/observability';
//   logger.error('chat.push falló', { reportId, zoneId, err });
//   logger.warn('rate limit excedido', { ip });
//   logger.info('ruta optimizada', { routeId, vehicles: n });
//
// Notas:
//   - Sentry se inicializa por la app (sentry.{client,server,edge}.config.ts).
//   - Este módulo NO importa @sentry/nextjs directo en el top level — usa
//     dynamic import dentro del método para no romper bundles que no tienen
//     Sentry configurado (ej. tests o scripts standalone).

type LogContext = Record<string, unknown>;

interface LoggerOptions {
  /** Identificador de la app — se agrega como tag en Sentry. */
  app: 'platform' | 'driver' | 'control-plane';
}

let appTag: LoggerOptions['app'] = 'platform';

/**
 * Configura el logger una vez al arrancar la app. Idempotente — llamar
 * múltiples veces sobrescribe el tag.
 */
export function configureLogger(opts: LoggerOptions): void {
  appTag = opts.app;
}

/**
 * Convierte cualquier Error a un objeto plano serializable.
 * Sentry maneja Error nativo bien, pero a veces recibimos `unknown` (catch).
 */
function normalizeError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('Non-serializable error');
  }
}

function fmt(level: string, msg: string, ctx?: LogContext): string {
  const ts = new Date().toISOString();
  const ctxStr = ctx ? ' ' + JSON.stringify(ctx) : '';
  return `[${ts}] [${level}] [${appTag}] ${msg}${ctxStr}`;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Error: bug o falla operativa que debe investigarse. Envía a Sentry.
 *
 * Si `context.err` es un Error, lo usamos como `captureException` para que
 * Sentry pueda agrupar por stack trace. Si no, usamos `captureMessage` con
 * level=error.
 */
export const logger = {
  async error(msg: string, ctx?: LogContext): Promise<void> {
    // eslint-disable-next-line no-console
    console.error(fmt('ERROR', msg, ctx));

    // Solo intentamos Sentry en producción o si NEXT_PUBLIC_SENTRY_DSN está set.
    // El SDK silenciosamente no hace nada si no se inicializó.
    try {
      const Sentry = await import('@sentry/nextjs');
      const err = ctx?.err;
      if (err) {
        Sentry.captureException(normalizeError(err), {
          tags: { app: appTag },
          extra: { msg, ...ctx },
        });
      } else {
        Sentry.captureMessage(msg, {
          level: 'error',
          tags: { app: appTag },
          extra: ctx,
        });
      }
    } catch {
      // Sentry no disponible (test/script standalone) — solo stdout.
    }
  },

  /** Warning: condición anómala pero no fatal. Envía a Sentry como level=warning. */
  async warn(msg: string, ctx?: LogContext): Promise<void> {
    // eslint-disable-next-line no-console
    console.warn(fmt('WARN', msg, ctx));
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: { app: appTag },
        extra: ctx,
      });
    } catch {
      // Idem.
    }
  },

  /** Info: evento operativo importante. NO va a Sentry, solo stdout. */
  info(msg: string, ctx?: LogContext): void {
    // eslint-disable-next-line no-console
    console.info(fmt('INFO', msg, ctx));
  },

  /** Debug: traza de desarrollo. Suprimido si NODE_ENV=production. */
  debug(msg: string, ctx?: LogContext): void {
    if (process.env.NODE_ENV === 'production') return;
    // eslint-disable-next-line no-console
    console.debug(fmt('DEBUG', msg, ctx));
  },
};

/**
 * Helper para attachar contexto temporal a un span de código.
 *
 * Hoy es un no-op funcional; en futuro se conecta a Sentry Performance tracing
 * cuando habilitemos transactions. Documentado para que el call site no cambie
 * cuando lo habilitemos.
 */
export async function withContext<T>(
  _scope: { tenant?: string; user?: string; route?: string },
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}
