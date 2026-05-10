// Sentry — CP server. ADR-051.
import * as Sentry from '@sentry/nextjs';
import { initSentry, configureLogger } from '@verdfrut/observability';

configureLogger({ app: 'control-plane' });
initSentry(Sentry, { app: 'control-plane', context: 'server' });
