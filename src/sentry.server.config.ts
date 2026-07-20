import * as Sentry from "@sentry/nextjs";

// Server-side Sentry initialization. Fully inert unless a DSN is configured
// (set NEXT_PUBLIC_SENTRY_DSN in the deployment environment to enable).
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  // Errors only — no performance tracing to keep overhead minimal.
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV,
});
