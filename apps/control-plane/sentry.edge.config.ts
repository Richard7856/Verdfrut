// Sentry — CP edge. ADR-051.
import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@verdfrut/observability';

configureLogger({ app: 'control-plane' });
initSentry(Sentry, { app: 'control-plane', context: 'edge' });
