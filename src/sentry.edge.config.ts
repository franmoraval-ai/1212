import * as Sentry from "@sentry/nextjs";

// Edge runtime Sentry initialization (middleware, edge routes). Inert without DSN.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV,
});
