import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-5 py-8 sm:px-8 lg:px-12">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,_rgba(194,116,74,0.2),_transparent_48%),radial-gradient(circle_at_top_right,_rgba(38,110,96,0.2),_transparent_46%)]"
      />
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-copper">
          404
        </p>
        <h1 className="text-4xl font-semibold tracking-[-0.03em] text-ink sm:text-5xl">
          Page not found
        </h1>
        <p className="max-w-md text-pretty text-base leading-7 text-muted">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-white transition hover:bg-forest/90 focus:outline-none focus:ring-4 focus:ring-forest/20"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
