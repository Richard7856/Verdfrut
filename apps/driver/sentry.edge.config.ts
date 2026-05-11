// Sentry — runtime EDGE del driver. ADR-051.

import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@tripdrive/observability';

configureLogger({ app: 'driver' });
initSentry(Sentry, { app: 'driver', context: 'edge' });
