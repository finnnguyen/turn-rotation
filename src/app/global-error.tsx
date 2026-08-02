"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import "./globals.css";

// Catches errors in the root layout itself — the rarest error path, and the
// only one where Next.js replaces the whole document, so this can't rely on
// anything else in the tree rendering. Keep this self-contained.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas px-5 text-center text-ink antialiased">
        <h1 className="text-3xl font-semibold tracking-[-0.03em]">
          Something went wrong
        </h1>
        <p className="max-w-md text-pretty text-base leading-7 text-muted">
          Sorry about that — please try again, or come back in a few minutes.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted/70">
            Reference: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-white transition hover:bg-forest/90 focus:outline-none focus:ring-4 focus:ring-forest/20"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
