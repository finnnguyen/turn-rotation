import type { Metadata } from "next";
import Link from "next/link";

import { login } from "./actions";

export const metadata: Metadata = {
  title: "Sign in",
};

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <section className="w-full max-w-md rounded-[2rem] border border-white/80 bg-white/85 p-7 shadow-[0_24px_80px_-32px_rgba(20,48,42,0.35)] sm:p-9">
        <Link
          className="text-sm font-semibold text-forest hover:text-copper"
          href="/"
        >
          ← Turn Rotation
        </Link>
        <p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-copper">
          Secure access
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Sign in to the salon
        </h1>
        <p className="mt-3 leading-7 text-muted">
          Accounts are created by a manager. Public registration is disabled.
        </p>

        {error ? (
          <div
            className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <form action={login} className="mt-7 space-y-5">
          <label className="block">
            <span className="text-sm font-semibold">Email</span>
            <input
              autoComplete="email"
              className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 outline-none transition focus:border-forest focus:ring-4 focus:ring-forest/10"
              name="email"
              required
              type="email"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Password</span>
            <input
              autoComplete="current-password"
              className="mt-2 w-full rounded-xl border border-ink/15 bg-white px-4 py-3 outline-none transition focus:border-forest focus:ring-4 focus:ring-forest/10"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>
          <button
            className="min-h-12 w-full rounded-xl bg-forest px-5 py-3 font-semibold text-white transition hover:bg-forest/90 focus:outline-none focus:ring-4 focus:ring-forest/20"
            type="submit"
          >
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
