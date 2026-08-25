const foundationChecks = [
  "Rotation fairness enforced inside atomic Postgres functions, not app-level checks a race condition could slip past",
  "Row Level Security is the real authorization model, not scattered route-handler checks",
  "AWS Textract-assisted menu import, nothing publishes without manager review",
  "Automated unit, real-Postgres integration, and Playwright/axe-core tests run in CI on every push",
];

export default function Home() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden px-5 py-8 sm:px-8 lg:px-12">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_top_left,_rgba(194,116,74,0.2),_transparent_48%),radial-gradient(circle_at_top_right,_rgba(38,110,96,0.2),_transparent_46%)]"
      />

      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between border-b border-ink/10 pb-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-full bg-forest text-sm font-bold tracking-[0.12em] text-white shadow-sm"
            >
              TR
            </span>
            <div>
              <p className="text-sm font-semibold tracking-wide text-forest">
                TURN ROTATION
              </p>
              <p className="text-xs text-muted">Salon operations, made clear</p>
            </div>
          </div>
          <span className="rounded-full border border-forest/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-forest shadow-sm backdrop-blur">
            Live in production
          </span>
        </header>

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-copper">
              Transparent by design
            </p>
            <h1 className="max-w-3xl text-balance text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-ink sm:text-6xl lg:text-7xl">
              Every turn should have a reason.
            </h1>
            <p className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-muted sm:text-xl">
              A fair, auditable rotation system for busy nail and hair salons—
              built around employee skills, availability, service value, and
              explanations everyone can understand.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                className="inline-flex min-h-11 items-center rounded-full bg-forest px-5 text-sm font-semibold text-white transition hover:bg-forest/90 focus:outline-none focus:ring-4 focus:ring-forest/20"
                href="/login"
              >
                Open salon workspace
              </Link>
              <span className="rounded-full border border-ink/10 bg-white/75 px-4 py-2 text-sm font-medium text-ink shadow-sm">
                Manager accounts only
              </span>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-white/80 bg-white/78 p-6 shadow-[0_24px_80px_-32px_rgba(20,48,42,0.35)] backdrop-blur sm:p-8">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-sm font-semibold text-copper">
                  ENGINEERING HIGHLIGHTS
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                  Built the way production needs to work
                </h2>
              </div>
              <span className="mt-1 size-3 rounded-full bg-emerald-500 shadow-[0_0_0_6px_rgba(16,185,129,0.12)]" />
            </div>
            <ul className="mt-7 space-y-4">
              {foundationChecks.map((check) => (
                <li
                  className="flex items-start gap-3 border-b border-ink/8 pb-4 last:border-0 last:pb-0"
                  key={check}
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-forest/10 text-xs font-bold text-forest"
                  >
                    ✓
                  </span>
                  <span className="leading-6 text-muted">{check}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        <footer className="flex flex-col gap-2 border-t border-ink/10 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>One source of truth. No silent changes.</span>
          <span>All milestones (M0-M8) complete - see README for the full breakdown</span>
        </footer>
      </div>
    </main>
  );
}
import Link from "next/link";
