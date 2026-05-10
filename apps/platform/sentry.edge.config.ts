// Sentry — runtime EDGE. ADR-051.
//
// Edge runtime es un subset de Node.js que corre en Vercel Edge / Cloudflare
// Workers. Lo usan middlewares y route handlers que declaran `export const
// runtime = 'edge'`. Hoy no tenemos ninguno, pero el archivo es necesario
// porque @sentry/nextjs lo espera y sin él la integración falla silente.

import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@verdfrut/observability';

configureLogger({ app: 'platform' });
initSentry(Sentry, { app: 'platform', context: 'edge' });
