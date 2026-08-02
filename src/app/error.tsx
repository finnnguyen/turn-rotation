"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function Error({
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
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-5 py-8 sm:px-8 lg:px-12">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,_rgba(194,116,74,0.2),_transparent_48%),radial-gradient(circle_at_top_right,_rgba(38,110,96,0.2),_transparent_46%)]"
      />
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-3xl font-semibold tracking-[-0.03em] text-ink sm:text-4xl">
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
      </div>
    </main>
  );
}
