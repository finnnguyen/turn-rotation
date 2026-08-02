import * as Sentry from "@sentry/nextjs";

// middleware.ts doesn't explicitly opt into a runtime, so this covers the
// case where it runs on the edge — Next.js only loads this when
// NEXT_RUNTIME is edge.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
  debug: false,
});
