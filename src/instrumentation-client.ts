import * as Sentry from "@sentry/nextjs";

// Client-side Sentry initialization. Errors only (no performance tracing and no
// session replay) to keep the mobile bundle lean for L1 field officers.
// Fully inert unless NEXT_PUBLIC_SENTRY_DSN is set in the environment.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  tracesSampleRate: 0,
  environment: process.env.NODE_ENV,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
