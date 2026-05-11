// Sentry — runtime SERVER (Node.js). ADR-051.
//
// Se ejecuta en server components, server actions, API routes y middleware
// Node-flavored. Captura excepciones de server actions y errores HTTP.
// Configuración separada del client porque las opciones cambian (no replay,
// no breadcrumbs de DOM, etc).

import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@tripdrive/observability';

configureLogger({ app: 'platform' });
initSentry(Sentry, { app: 'platform', context: 'server' });
