// Sentry — runtime BROWSER (cliente). ADR-051.
//
// Este archivo se ejecuta en el navegador del dispatcher cuando carga
// cualquier página. Captura errores de React, promesas rechazadas,
// errores de JS sueltos. La inicialización es no-op si NEXT_PUBLIC_SENTRY_DSN
// no está definido — la app sigue corriendo sin telemetría.

import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@verdfrut/observability';

configureLogger({ app: 'platform' });
initSentry(Sentry, { app: 'platform', context: 'client' });
