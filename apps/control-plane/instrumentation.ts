// Next.js instrumentation hook (CP). ADR-051.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routePath?: string; routeType?: 'render' | 'route' | 'action' | 'middleware' },
) {
  const Sentry = await import('@sentry/nextjs');
  // @ts-expect-error firma documentada de Sentry/Next 15+.
  Sentry.captureRequestError(err, request, context);
}
