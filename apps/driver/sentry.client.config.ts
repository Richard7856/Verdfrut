// Sentry — runtime BROWSER del chofer (PWA). ADR-051.
//
// La driver app es la más sensible operativamente: si falla en campo, el chofer
// no puede reportar entregas. Sentry captura errores client-side, especialmente
// problemas de:
//   - GPS / geolocation API
//   - IndexedDB del outbox
//   - Service worker
//   - Compresión de imágenes
//   - Subida de fotos
// El error visual del chofer ("ups, intenta de nuevo") sigue mostrándose;
// Sentry solo agrega telemetría para que el operador en oficina sepa qué falló.

import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@verdfrut/observability';

configureLogger({ app: 'driver' });
initSentry(Sentry, { app: 'driver', context: 'client' });
