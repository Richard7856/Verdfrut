// Next.js instrumentation hook — ADR-051.
//
// Next.js llama `register()` una vez por proceso server al arrancar. Sentry
// recomienda dispatch a sentry.server.config o sentry.edge.config según el
// runtime activo. Sin este archivo, los errores server-side se pierden.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Captura errores de Server Actions y RSC que escapan al boundary.
// `onRequestError` se llama cuando un request HTTP falla en el server.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routePath?: string; routeType?: 'render' | 'route' | 'action' | 'middleware' },
) {
  // Reusar la captura de Sentry. La función `captureRequestError` del SDK
  // formatea el error con todos los metadatos esperados por el dashboard.
  const Sentry = await import('@sentry/nextjs');
  // @ts-expect-error captureRequestError es la firma documentada de Sentry/Next 15+;
  // los tipos del SDK 8.x todavía esperan request distinto. Hace lo correcto en runtime.
  Sentry.captureRequestError(err, request, context);
}
