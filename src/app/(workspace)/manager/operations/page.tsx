import { redirect } from "next/navigation";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { applyBalanceCorrection } from "./actions";

type SearchParams = Promise<{ notice?: string; error?: string }>;
type Employee = { id: string; display_name: string };
type Entry = {
  employee_id: string;
  dollar_balance: number;
  haircut_balance: number;
  master_position: number | null;
};
type AuditEvent = {
  id: string;
  event_type: string;
  summary: string;
  occurred_at: string;
  employee_id: string | null;
  details: Record<string, unknown>;
};

export default async function OperationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [context, query] = await Promise.all([
    requireManagerContext(),
    searchParams,
  ]);
  const supabase = await createClient();
  const { data: workday } = await supabase
    .schema("app")
    .from("workdays")
    .select("id")
    .eq("location_id", context.locationId)
    .eq("status", "open")
    .maybeSingle();
  if (!workday) redirect("/dashboard?error=Open a workday first.");

  const [{ data: employeesData }, { data: entriesData }, { data: auditData }] =
    await Promise.all([
      supabase
        .schema("app")
        .from("employees")
        .select("id, display_name")
        .eq("location_id", context.locationId)
        .eq("active", true),
      supabase
        .schema("app")
        .from("rotation_entries")
        .select(
          "employee_id, dollar_balance, haircut_balance, master_position",
        )
        .eq("workday_id", workday.id),
      supabase
        .schema("app")
        .from("manager_audit_feed")
        .select("id, event_type, summary, occurred_at, employee_id, details")
        .eq("workday_id", workday.id)
        .order("occurred_at", { ascending: false })
        .limit(50),
    ]);
  const employees = (employeesData ?? []) as Employee[];
  const employeeMap = new Map(
    employees.map((employee) => [employee.id, employee.display_name]),
  );
  const entries = (entriesData ?? []) as Entry[];

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      {query.notice ? (
        <p className="mb-5 rounded-2xl bg-emerald-100 px-4 py-3 text-sm text-emerald-900">
          {query.notice}
        </p>
      ) : null}
      {query.error ? (
        <p className="mb-5 rounded-2xl bg-rose-100 px-4 py-3 text-sm text-rose-900">
          {query.error}
        </p>
      ) : null}
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
        Milestone 5 · Operational fairness
      </p>
      <h1 className="mt-2 text-4xl font-semibold">Corrections &amp; audit</h1>
      <p className="mt-2 max-w-3xl text-muted">
        Corrections create compensating ledger and audit events. Original
        service and credit records are never overwritten.
      </p>

      <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Current partial balances</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {entries.map((entry) => (
            <form
              action={applyBalanceCorrection}
              className="rounded-2xl border border-ink/10 p-4"
              key={entry.employee_id}
            >
              <h3 className="font-semibold">
                {employeeMap.get(entry.employee_id)}
              </h3>
              <p className="mt-1 text-xs text-muted">
                Master position {entry.master_position ?? "inactive"}
              </p>
              <input name="workdayId" type="hidden" value={workday.id} />
              <input name="employeeId" type="hidden" value={entry.employee_id} />
              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="text-xs font-semibold">
                  Dollar balance
                  <input
                    className="mt-1 min-h-10 w-full rounded-xl border border-ink/15 px-3"
                    defaultValue={Number(entry.dollar_balance)}
                    max="29.99"
                    min="0"
                    name="dollarBalance"
                    step="0.01"
                    type="number"
                  />
                </label>
                <label className="text-xs font-semibold">
                  Haircut balance
                  <input
                    className="mt-1 min-h-10 w-full rounded-xl border border-ink/15 px-3"
                    defaultValue={Number(entry.haircut_balance)}
                    max="0.999999"
                    min="0"
                    name="haircutBalance"
                    step="0.000001"
                    type="number"
                  />
                </label>
              </div>
              <input
                className="mt-3 min-h-10 w-full rounded-xl border border-ink/15 px-3 text-sm"
                name="reason"
                placeholder="Required correction reason"
                required
              />
              <label className="mt-3 flex items-center gap-2 text-xs">
                <input name="moveToEnd" type="checkbox" value="true" />
                Also move to master rotation end
              </label>
              <button
                className="mt-3 min-h-10 rounded-xl bg-forest px-4 text-sm font-semibold text-white"
                type="submit"
              >
                Apply correction
              </button>
            </form>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Immutable audit history</h2>
        {(auditData ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted">No fairness events yet.</p>
        ) : (
          <div className="mt-4 divide-y divide-ink/10">
            {((auditData ?? []) as AuditEvent[]).map((event) => (
              <article className="py-4" key={event.id}>
                <div className="flex justify-between gap-4">
                  <div>
                    <p className="font-semibold">{event.summary}</p>
                    <p className="mt-1 text-xs text-muted">
                      {event.employee_id
                        ? `${employeeMap.get(event.employee_id) ?? "Employee"} · `
                        : ""}
                      {event.event_type.replaceAll("_", " ")}
                    </p>
                  </div>
                  <time className="text-xs text-muted">
                    {new Date(event.occurred_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
