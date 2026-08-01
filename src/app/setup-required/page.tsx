import Link from "next/link";

export default function SetupRequiredPage() {
  return (
    <main className="grid min-h-screen place-items-center px-5">
      <section className="max-w-lg rounded-[2rem] border border-amber-200 bg-white p-8 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
          Setup required
        </p>
        <h1 className="mt-2 text-3xl font-semibold">No salon access assigned</h1>
        <p className="mt-4 leading-7 text-muted">
          Your account exists, but it is not connected to a salon location. Ask
          the project administrator to complete the initial manager bootstrap.
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-forest px-5 font-semibold text-white"
          href="/login"
        >
          Return to sign in
        </Link>
      </section>
    </main>
  );
}
