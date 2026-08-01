import { requireUserContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{ date?: string }>;
type Workday = { id: string; business_date: string; status: string };
type EmployeeSummary = {
  employee_id: string;
  display_name: string;
  master_position: number | null;
  dollar_balance: number;
  haircut_balance: number;
  customers_served: number;
  listed_service_value: number;
  mens_haircuts: number;
  womens_haircuts: number;
  dollar_turns: number;
  haircut_turns: number;
  skips: number;
  refusals: number;
  corrections: number;
  available_seconds: number;
  busy_seconds: number;
  break_seconds: number;
};
type LocationSummary = {
  total_visits: number;
  walk_ins: number;
  requested_visits: number;
  appointments: number;
  completed_visits: number;
  waiting_visits: number;
  listed_service_value: number;
  completed_turns: number;
  skips: number;
  refusals: number;
  corrections: number;
  overrides: number;
};
type TimelineItem = {
  id: string;
  occurredAt: string;
  employeeId: string;
  title: string;
  detail: string;
  tone: "credit" | "skip" | "refusal" | "correction";
};
type CompletedTurn = {
  id: string;
  employee_id: string;
  completion_type: "master" | "haircut";
  qualifying_amount: number;
  threshold_amount: number;
  state_version: number;
  completed_at: string;
};
type CreditEvent = {
  id: string;
  employee_id: string;
  credit_type: string;
  dollar_amount: number;
  haircut_amount: number;
  explanation: string;
  state_version: number;
  occurred_at: string;
};
type TurnDetail = CompletedTurn & { credits: CreditEvent[] };

function duration(seconds: number) {
  const totalMinutes = Math.round(Number(seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [context, query] = await Promise.all([
    requireUserContext(),
    searchParams,
  ]);
  const supabase = await createClient();
  const { data: workdayData } = await supabase
    .schema("app")
    .from("workdays")
    .select("id, business_date, status")
    .eq("location_id", context.locationId)
    .order("business_date", { ascending: false })
    .limit(30);
  const workdays = (workdayData ?? []) as Workday[];
  const selectedWorkday =
    workdays.find((workday) => workday.business_date === query.date) ??
    workdays[0];

  if (!selectedWorkday) {
    return (
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <h1 className="text-4xl font-semibold">Daily history</h1>
        <p className="mt-4 text-muted">No workday history exists yet.</p>
      </main>
    );
  }

  const employeeSummaryPromise = supabase
    .schema("app")
    .from("daily_employee_summaries")
    .select("*")
    .eq("workday_id", selectedWorkday.id)
    .order("master_position");
  const locationSummaryPromise =
    context.role === "manager"
      ? supabase
          .schema("app")
          .from("daily_location_summaries")
          .select("*")
          .eq("workday_id", selectedWorkday.id)
          .maybeSingle()
      : Promise.resolve({ data: null });
  const [
    { data: employeeData },
    { data: locationData },
    { data: creditData },
    { data: skipData },
    { data: refusalData },
    { data: correctionData },
    { data: completedTurnData },
  ] = await Promise.all([
    employeeSummaryPromise,
    locationSummaryPromise,
    supabase
      .schema("app")
      .from("turn_credit_events")
      .select(
        "id, employee_id, credit_type, dollar_amount, haircut_amount, explanation, state_version, occurred_at",
      )
      .eq("workday_id", selectedWorkday.id),
    supabase
      .schema("app")
      .from("skip_events")
      .select("id, employee_id, skip_type, explanation, occurred_at")
      .eq("workday_id", selectedWorkday.id),
    supabase
      .schema("app")
      .from("refusal_events")
      .select("id, employee_id, approved_inability, reason, occurred_at")
      .eq("workday_id", selectedWorkday.id),
    supabase
      .schema("app")
      .from("corrections")
      .select("id, employee_id, reason, applied_at")
      .eq("workday_id", selectedWorkday.id),
    supabase
      .schema("app")
      .from("completed_turns")
      .select(
        "id, employee_id, completion_type, qualifying_amount, threshold_amount, state_version, completed_at",
      )
      .eq("workday_id", selectedWorkday.id),
  ]);

  const employeeSummaries = (employeeData ?? []) as EmployeeSummary[];
  const employeeMap = new Map(
    employeeSummaries.map((employee) => [
      employee.employee_id,
      employee.display_name,
    ]),
  );
  const creditEvents = (creditData ?? []) as CreditEvent[];
  const completedTurns = ((completedTurnData ?? []) as CompletedTurn[]).toSorted(
    (left, right) => left.state_version - right.state_version,
  );
  const turnDetailsByEmployee = new Map<
    string,
    { dollar: TurnDetail[]; haircut: TurnDetail[] }
  >();
  completedTurns.forEach((turn) => {
    const turns = turnDetailsByEmployee.get(turn.employee_id) ?? {
      dollar: [],
      haircut: [],
    };
    const bucket = turn.completion_type === "master" ? turns.dollar : turns.haircut;
    const previousStateVersion = bucket.at(-1)?.state_version ?? -1;
    const credits = creditEvents
      .filter((event) => {
        const matchesType =
          turn.completion_type === "master"
            ? Number(event.dollar_amount) > 0
            : Number(event.haircut_amount) > 0;
        return (
          event.employee_id === turn.employee_id &&
          matchesType &&
          event.state_version > previousStateVersion &&
          event.state_version <= turn.state_version
        );
      })
      .toSorted((left, right) =>
        left.occurred_at.localeCompare(right.occurred_at),
      );
    bucket.push({ ...turn, credits });
    turnDetailsByEmployee.set(turn.employee_id, turns);
  });
  const timeline: TimelineItem[] = [
    ...(creditData ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.occurred_at,
      employeeId: event.employee_id,
      title: String(event.credit_type).replaceAll("_", " "),
      detail: event.explanation,
      tone: "credit" as const,
    })),
    ...(skipData ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.occurred_at,
      employeeId: event.employee_id,
      title: String(event.skip_type).replaceAll("_", " "),
      detail: event.explanation,
      tone: "skip" as const,
    })),
    ...(refusalData ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.occurred_at,
      employeeId: event.employee_id,
      title: event.approved_inability
        ? "approved inability"
        : "employee refusal",
      detail: event.reason,
      tone: "refusal" as const,
    })),
    ...(correctionData ?? []).map((event) => ({
      id: event.id,
      occurredAt: event.applied_at,
      employeeId: event.employee_id,
      title: "manager correction",
      detail: event.reason,
      tone: "correction" as const,
    })),
    ...completedTurns.map((turn) => {
      const qualifying = Number(turn.qualifying_amount);
      const threshold = Number(turn.threshold_amount);
      const excess = Math.max(0, qualifying - threshold);
      return {
        id: turn.id,
        occurredAt: turn.completed_at,
        employeeId: turn.employee_id,
        title:
          turn.completion_type === "master"
            ? "dollar turn completed"
            : "haircut turn completed",
        detail:
          turn.completion_type === "master"
            ? `$${qualifying.toFixed(2)} qualifying value completed the $${threshold.toFixed(2)} turn${
                excess > 0
                  ? `; $${excess.toFixed(2)} excess was discarded`
                  : ""
              }`
            : `${qualifying.toFixed(2)} haircut credit completed the ${threshold.toFixed(2)} turn threshold${
                excess > 0
                  ? `; ${excess.toFixed(2)} excess was discarded`
                  : ""
              }`,
        tone: "credit" as const,
      };
    }),
  ].toSorted(
    (left, right) =>
      new Date(right.occurredAt).getTime() -
      new Date(left.occurredAt).getTime(),
  );
  const locationSummary = locationData as LocationSummary | null;

  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
            Milestone 6 · Transparency
          </p>
          <h1 className="mt-2 text-4xl font-semibold">Daily history</h1>
          <p className="mt-2 text-muted">
            Factual operational history without judging employee behavior.
          </p>
        </div>
        <form className="flex items-center gap-2" method="get">
          <label className="text-sm font-semibold" htmlFor="date">
            Workday
          </label>
          <select
            className="min-h-11 rounded-xl border border-ink/15 bg-white px-3"
            defaultValue={selectedWorkday.business_date}
            id="date"
            name="date"
          >
            {workdays.map((workday) => (
              <option key={workday.id} value={workday.business_date}>
                {workday.business_date} · {workday.status}
              </option>
            ))}
          </select>
          <button
            className="min-h-11 rounded-xl bg-forest px-4 text-sm font-semibold text-white"
            type="submit"
          >
            View
          </button>
        </form>
      </div>

      {locationSummary ? (
        <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Visits", locationSummary.total_visits],
            ["Completed", locationSummary.completed_visits],
            ["Waiting", locationSummary.waiting_visits],
            ["Listed value", `$${Number(locationSummary.listed_service_value).toFixed(2)}`],
            ["Walk-ins", locationSummary.walk_ins],
            ["Requested", locationSummary.requested_visits],
            ["Appointments", locationSummary.appointments],
            ["Completed turns", locationSummary.completed_turns],
            ["Skips", locationSummary.skips],
            ["Refusals", locationSummary.refusals],
            ["Overrides", locationSummary.overrides],
            ["Corrections", locationSummary.corrections],
          ].map(([label, value]) => (
            <article
              className="rounded-2xl border border-ink/10 bg-white p-4 shadow-sm"
              key={label}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        {employeeSummaries.map((employee) => (
          <article
            className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm"
            key={employee.employee_id}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">
                  {employee.display_name}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {employee.customers_served} customers · $
                  {Number(employee.listed_service_value).toFixed(2)} listed value
                </p>
              </div>
              <span className="rounded-full bg-forest/[0.08] px-3 py-1 text-xs font-semibold">
                Position {employee.master_position ?? "—"}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted">Dollar turns</dt><dd className="font-semibold">{employee.dollar_turns}</dd></div>
              <div><dt className="text-muted">Haircut turns</dt><dd className="font-semibold">{employee.haircut_turns}</dd></div>
              <div><dt className="text-muted">Men / women cuts</dt><dd className="font-semibold">{employee.mens_haircuts} / {employee.womens_haircuts}</dd></div>
              <div><dt className="text-muted">Skips / refusals</dt><dd className="font-semibold">{employee.skips} / {employee.refusals}</dd></div>
              <div><dt className="text-muted">Dollar partial</dt><dd className="font-semibold">${Number(employee.dollar_balance).toFixed(2)}</dd></div>
              <div><dt className="text-muted">Haircut partial</dt><dd className="font-semibold">{Number(employee.haircut_balance).toFixed(2)}</dd></div>
              <div><dt className="text-muted">Available</dt><dd className="font-semibold">{duration(employee.available_seconds)}</dd></div>
              <div><dt className="text-muted">Busy / break</dt><dd className="font-semibold">{duration(employee.busy_seconds)} / {duration(employee.break_seconds)}</dd></div>
            </dl>
            {(turnDetailsByEmployee.get(employee.employee_id)?.dollar.length ??
              0) > 0 ||
            (turnDetailsByEmployee.get(employee.employee_id)?.haircut.length ??
              0) > 0 ? (
              <div className="mt-5 border-t border-ink/10 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Completed turn breakdown
                </p>
                <div className="mt-3 grid gap-3">
                  {turnDetailsByEmployee
                    .get(employee.employee_id)
                    ?.dollar.map((turn, index) => (
                      <div
                        className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-950"
                        key={turn.id}
                      >
                        <p className="font-semibold">
                          Dollar turn {index + 1}: ${Number(turn.qualifying_amount).toFixed(2)}
                        </p>
                        {turn.credits.map((credit) => (
                          <p className="mt-1 text-xs" key={credit.id}>
                            {credit.explanation}
                          </p>
                        ))}
                      </div>
                    ))}
                  {turnDetailsByEmployee
                    .get(employee.employee_id)
                    ?.haircut.map((turn, index) => (
                      <div
                        className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950"
                        key={turn.id}
                      >
                        <p className="font-semibold">
                          Haircut turn {index + 1}: {Number(turn.qualifying_amount).toFixed(2)} credit
                        </p>
                        {turn.credits.map((credit) => (
                          <p className="mt-1 text-xs" key={credit.id}>
                            {credit.explanation}
                          </p>
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Event timeline</h2>
        {timeline.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No detailed events recorded.</p>
        ) : (
          <div className="mt-4 divide-y divide-ink/10">
            {timeline.map((event) => (
              <article className="flex justify-between gap-5 py-4" key={`${event.tone}-${event.id}`}>
                <div>
                  <p className="font-semibold capitalize">
                    {employeeMap.get(event.employeeId) ?? "Employee"} · {event.title}
                  </p>
                  <p className="mt-1 text-sm text-muted">{event.detail}</p>
                </div>
                <time className="shrink-0 text-xs text-muted">
                  {new Date(event.occurredAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
