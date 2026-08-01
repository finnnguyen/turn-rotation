import Link from "next/link";

import { DashboardSnapshot } from "@/components/dashboard-snapshot";
import { RealtimeRefresh } from "@/components/realtime-refresh";
import { requireUserContext } from "@/lib/auth";
import { orderedRotation } from "@/lib/rotation";
import { createClient } from "@/lib/supabase/server";

import {
  clockInEmployee,
  clockOutEmployee,
  closeWorkday,
  endEmployeeBreak,
  openWorkday,
  setEmployeeStatus,
  startEmployeeBreak,
  setBusyMode,
} from "./actions";

type SearchParams = Promise<{ notice?: string; error?: string }>;
type Employee = { id: string; display_name: string; user_id: string | null };
type Entry = {
  employee_id: string;
  master_position: number | null;
  haircut_position: number | null;
  dollar_balance: number;
  haircut_balance: number;
  current_status: string;
};
type Workday = {
  id: string;
  business_date: string;
  opened_at: string;
  status: string;
};
type WaitingVisit = {
  id: string;
  ticket_number: number;
  visit_type: string;
  arrived_at: string;
};

const statusLabels: Record<string, string> = {
  available: "Available",
  busy: "Serving",
  break: "On break",
  unavailable: "Unavailable",
  not_accepting_walk_ins: "No walk-ins",
  finished: "Finished",
  clocked_out: "Clocked out",
};

const statusStyles: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800",
  busy: "bg-amber-100 text-amber-800",
  break: "bg-sky-100 text-sky-800",
  unavailable: "bg-slate-100 text-slate-700",
  not_accepting_walk_ins: "bg-rose-100 text-rose-800",
};

function Queue({
  title,
  empty,
  entries,
  employees,
  positionKey,
}: {
  title: string;
  empty: string;
  entries: Entry[];
  employees: Map<string, Employee>;
  positionKey: "master_position" | "haircut_position";
}) {
  return (
    <section className="rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">{title}</h2>
      {entries.length === 0 ? (
        <p className="mt-5 rounded-2xl bg-forest/[0.04] p-4 text-sm text-muted">
          {empty}
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li
              className="flex items-center justify-between gap-4 rounded-2xl border border-ink/10 p-4"
              key={entry.employee_id}
            >
              <div className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-full bg-forest font-semibold text-white">
                  {entry[positionKey]}
                </span>
                <div>
                  <p className="font-semibold">
                    {employees.get(entry.employee_id)?.display_name ?? "Employee"}
                  </p>
                  <p className="text-xs text-muted">
                    ${Number(entry.dollar_balance).toFixed(2)} toward $30
                    {Number(entry.haircut_balance) > 0
                      ? ` · ${Number(entry.haircut_balance).toFixed(2)} haircut`
                      : ""}
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  statusStyles[entry.current_status] ?? "bg-slate-100 text-slate-700"
                }`}
              >
                {statusLabels[entry.current_status] ?? entry.current_status}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [context, query] = await Promise.all([
    requireUserContext(),
    searchParams,
  ]);
  const supabase = await createClient();
  const [{ data: workdayData }, { data: employeeData }] = await Promise.all([
    supabase
      .schema("app")
      .from("workdays")
      .select("id, business_date, opened_at, status")
      .eq("location_id", context.locationId)
      .eq("status", "open")
      .maybeSingle(),
    supabase
      .schema("app")
      .from("employees")
      .select("id, display_name, user_id")
      .eq("location_id", context.locationId)
      .eq("active", true)
      .order("display_name"),
  ]);

  const workday = workdayData as Workday | null;
  const employees = (employeeData ?? []) as Employee[];
  let entries: Entry[] = [];
  let stateVersion = 0;
  let busyModeActive = false;
  let waitingVisits: WaitingVisit[] = [];

  if (workday) {
    const [
      { data: entryData },
      { data: versionData },
      { data: busyModeData },
      { data: waitingVisitData },
    ] =
      await Promise.all([
      supabase
        .schema("app")
        .from("rotation_entries")
        .select(
          "employee_id, master_position, haircut_position, dollar_balance, haircut_balance, current_status",
        )
        .eq("workday_id", workday.id),
      supabase
        .schema("app")
        .from("rotation_state_versions")
        .select("version")
        .eq("workday_id", workday.id)
        .single(),
      supabase
        .schema("app")
        .from("busy_mode_periods")
        .select("id")
        .eq("workday_id", workday.id)
        .is("ended_at", null)
        .maybeSingle(),
      supabase
        .schema("app")
        .from("customer_visits")
        .select("id, ticket_number, visit_type, arrived_at")
        .eq("workday_id", workday.id)
        .eq("status", "waiting")
        .order("arrived_at"),
    ]);
    entries = (entryData ?? []) as Entry[];
    stateVersion = Number(versionData?.version ?? 0);
    busyModeActive = Boolean(busyModeData);
    waitingVisits = (waitingVisitData ?? []) as WaitingVisit[];
  }

  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const activeEmployeeIds = new Set(
    entries
      .filter((entry) => entry.master_position !== null)
      .map((entry) => entry.employee_id),
  );
  const masterQueue = orderedRotation(entries, "master");
  const haircutQueue = orderedRotation(entries, "haircut");
  const canManage = (employee: Employee) =>
    context.role === "manager" || employee.user_id === context.userId;

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      {workday ? <RealtimeRefresh workdayId={workday.id} /> : null}
      {workday ? (
        <DashboardSnapshot
          data={{
            businessDate: workday.business_date,
            stateVersion,
            masterCount: masterQueue.length,
            haircutCount: haircutQueue.length,
            waitingCount: waitingVisits.length,
            availableCount: entries.filter(
              (entry) => entry.current_status === "available",
            ).length,
            servingCount: entries.filter(
              (entry) => entry.current_status === "busy",
            ).length,
          }}
        />
      ) : null}
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
      {workday && busyModeActive ? (
        <div className="mb-5 flex flex-col justify-between gap-3 rounded-2xl bg-amber-100 px-4 py-3 text-amber-950 sm:flex-row sm:items-center">
          <p className="font-semibold">
            Busy mode is active — busy-only backup qualifications are eligible.
          </p>
          {context.role === "manager" ? (
            <form action={setBusyMode} className="flex gap-2">
              <input name="workdayId" type="hidden" value={workday.id} />
              <input name="activate" type="hidden" value="false" />
              <input name="reason" type="hidden" value="Qualified staff available" />
              <button className="rounded-xl bg-white px-3 py-2 text-sm font-semibold" type="submit">
                End busy mode
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
            Milestone 2 · Live operations
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            Today&apos;s rotations
          </h1>
          <p className="mt-2 text-muted">
            {workday
              ? `${workday.business_date} · State version ${stateVersion}`
              : "Open the day before employees clock in."}
          </p>
        </div>
        {context.role === "manager" ? (
          <div className="flex flex-wrap gap-3">
            {workday ? (
              <Link
                className="inline-flex min-h-11 items-center rounded-xl bg-copper px-4 text-sm font-semibold text-white"
                href="/intake"
              >
                Add customer
              </Link>
            ) : null}
            <Link
              className="inline-flex min-h-11 items-center rounded-xl border border-ink/10 bg-white px-4 text-sm font-semibold"
              href="/manager/catalog"
            >
              People &amp; services
            </Link>
            {workday ? (
              <form action={closeWorkday}>
                <input name="workdayId" type="hidden" value={workday.id} />
                <button
                  className="min-h-11 rounded-xl bg-ink px-4 text-sm font-semibold text-white"
                  type="submit"
                >
                  Close workday
                </button>
              </form>
            ) : (
              <form action={openWorkday}>
                <button
                  className="min-h-11 rounded-xl bg-forest px-5 text-sm font-semibold text-white"
                  type="submit"
                >
                  Open today
                </button>
              </form>
            )}
          </div>
        ) : null}
      </div>

      {!workday ? (
        <section className="mt-10 rounded-3xl border border-dashed border-forest/25 bg-white p-8 text-center">
          <h2 className="text-2xl font-semibold">No open workday</h2>
          <p className="mx-auto mt-2 max-w-xl leading-7 text-muted">
            A manager opens each day. The first employee clocked in becomes
            first in the master rotation, and qualified haircut staff also join
            the shared haircut rotation.
          </p>
        </section>
      ) : (
        <>
          <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <Queue
              empty="Clock in an employee to begin the daily rotation."
              employees={employeeMap}
              entries={masterQueue}
              positionKey="master_position"
              title="Master rotation"
            />
            <Queue
              empty="Qualified haircut staff appear here when they clock in."
              employees={employeeMap}
              entries={haircutQueue}
              positionKey="haircut_position"
              title="Shared haircut rotation"
            />
            <section className="rounded-3xl border border-ink/10 bg-white p-5 shadow-sm md:col-span-2 xl:col-span-1">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">Waiting customers</h2>
                <span className="rounded-full bg-copper/10 px-3 py-1 text-xs font-semibold text-copper">
                  {waitingVisits.length} waiting
                </span>
              </div>
              {waitingVisits.length === 0 ? (
                <p className="mt-5 rounded-2xl bg-forest/[0.04] p-4 text-sm text-muted">
                  No customers are currently waiting.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {waitingVisits.map((visit) => (
                    <li key={visit.id}>
                      <Link
                        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-ink/10 p-4 hover:border-forest/30"
                        href={`/intake/${visit.id}`}
                      >
                        <span className="font-semibold">Ticket #{visit.ticket_number}</span>
                        <span className="text-xs capitalize text-muted">
                          {visit.visit_type.replaceAll("_", " ")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
              {context.role === "manager" ? (
                <Link
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-forest px-4 text-sm font-semibold text-white"
                  href="/intake"
                >
                  Add or review customers
                </Link>
              ) : null}
            </section>
          </div>

          <section className="mt-6 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Team status</h2>
                <p className="mt-1 text-sm text-muted">
                  Breaks and availability changes preserve queue positions.
                </p>
              </div>
              <span className="text-sm font-semibold text-muted">
                {activeEmployeeIds.size} clocked in
              </span>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {employees.map((employee) => {
                const entry = entries.find(
                  (item) => item.employee_id === employee.id,
                );
                const active = activeEmployeeIds.has(employee.id);
                const editable = canManage(employee);

                return (
                  <article
                    className="rounded-2xl border border-ink/10 p-4"
                    key={employee.id}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-semibold">{employee.display_name}</h3>
                      <span className="text-xs font-semibold text-muted">
                        {active
                          ? statusLabels[entry?.current_status ?? "available"]
                          : "Not clocked in"}
                      </span>
                    </div>
                    {editable ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <form action={active ? clockOutEmployee : clockInEmployee}>
                          <input name="workdayId" type="hidden" value={workday.id} />
                          <input name="employeeId" type="hidden" value={employee.id} />
                          <button
                            className="min-h-10 rounded-xl bg-forest px-3 text-xs font-semibold text-white"
                            type="submit"
                          >
                            {active ? "Clock out" : "Clock in"}
                          </button>
                        </form>
                        {active && entry?.current_status !== "break" ? (
                          <>
                            <form action={setEmployeeStatus}>
                              <input name="workdayId" type="hidden" value={workday.id} />
                              <input name="employeeId" type="hidden" value={employee.id} />
                              <input
                                name="status"
                                type="hidden"
                                value={
                                  entry?.current_status === "available"
                                    ? "busy"
                                    : "available"
                                }
                              />
                              <button
                                className="min-h-10 rounded-xl border border-ink/10 px-3 text-xs font-semibold"
                                type="submit"
                              >
                                {entry?.current_status === "available"
                                  ? "Mark serving"
                                  : "Mark available"}
                              </button>
                            </form>
                            <form action={startEmployeeBreak}>
                              <input name="workdayId" type="hidden" value={workday.id} />
                              <input name="employeeId" type="hidden" value={employee.id} />
                              <input name="minutes" type="hidden" value="30" />
                              <button
                                className="min-h-10 rounded-xl border border-ink/10 px-3 text-xs font-semibold"
                                type="submit"
                              >
                                Start 30m break
                              </button>
                            </form>
                          </>
                        ) : null}
                        {active && entry?.current_status === "break" ? (
                          <form action={endEmployeeBreak}>
                            <input name="workdayId" type="hidden" value={workday.id} />
                            <input name="employeeId" type="hidden" value={employee.id} />
                            <button
                              className="min-h-10 rounded-xl border border-ink/10 px-3 text-xs font-semibold"
                              type="submit"
                            >
                              End break
                            </button>
                          </form>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
          {context.role === "manager" && !busyModeActive ? (
            <section className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-xl font-semibold">Busy mode</h2>
              <p className="mt-1 text-sm text-muted">
                Activate only when routine qualified staff are occupied beyond
                the wait limit and backup specialties are needed.
              </p>
              <form action={setBusyMode} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input name="workdayId" type="hidden" value={workday.id} />
                <input name="activate" type="hidden" value="true" />
                <input
                  className="min-h-11 flex-1 rounded-xl border border-ink/15 bg-white px-3"
                  name="reason"
                  placeholder="Why is busy mode beginning?"
                  required
                />
                <button className="min-h-11 rounded-xl bg-amber-700 px-5 font-semibold text-white" type="submit">
                  Activate busy mode
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
