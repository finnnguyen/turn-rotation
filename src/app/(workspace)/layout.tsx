import Link from "next/link";

import { requireUserContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const context = await requireUserContext();

  return (
    <div className="min-h-screen bg-[#f8f6f0] pb-20 sm:pb-0">
      <header className="border-b border-ink/10 bg-white/90 px-5 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-7">
            <Link className="font-semibold tracking-tight text-forest" href="/dashboard">
              Turn Rotation
            </Link>
            <nav aria-label="Workspace" className="hidden items-center gap-1 sm:flex">
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-forest/5 hover:text-forest"
                href="/dashboard"
              >
                Dashboard
              </Link>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-forest/5 hover:text-forest"
                href="/history"
              >
                Daily history
              </Link>
              {context.role === "manager" ? (
                <Link
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-forest/5 hover:text-forest"
                  href="/manager/import"
                >
                  Import menu
                </Link>
              ) : null}
              {context.role === "manager" ? (
                <Link
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-forest/5 hover:text-forest"
                  href="/intake"
                >
                  Customer intake
                </Link>
              ) : null}
              {context.role === "manager" ? (
                <Link
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-forest/5 hover:text-forest"
                  href="/manager/operations"
                >
                  Fairness &amp; audit
                </Link>
              ) : null}
              {context.role === "manager" ? (
                <Link
                  className="rounded-lg px-3 py-2 text-sm font-medium text-muted hover:bg-forest/5 hover:text-forest"
                  href="/manager/catalog"
                >
                  People &amp; services
                </Link>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">{context.displayName}</p>
              <p className="text-xs capitalize text-muted">{context.role}</p>
            </div>
            <form action="/auth/signout" method="post">
              <button
                className="min-h-10 rounded-xl border border-ink/10 bg-white px-4 text-sm font-semibold hover:border-forest/30"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      {children}
      <nav
        aria-label="Phone navigation"
        className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-ink/10 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(24,42,39,0.08)] backdrop-blur sm:hidden"
      >
        <Link className="phone-nav-link" href="/dashboard">
          Rotation
        </Link>
        <Link className="phone-nav-link" href="/history">
          History
        </Link>
        {context.role === "manager" ? (
          <>
            <Link className="phone-nav-link" href="/intake">
              Customers
            </Link>
            <Link className="phone-nav-link" href="/manager/catalog">
              More
            </Link>
          </>
        ) : (
          <>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </>
        )}
      </nav>
    </div>
  );
}
