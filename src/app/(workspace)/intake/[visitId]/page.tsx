import Link from "next/link";
import { notFound } from "next/navigation";

import { RealtimeRefresh } from "@/components/realtime-refresh";
import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation";

import {
  completeVisitServices,
  confirmAssignment,
  convertCustomerDecline,
  recordRefusal,
  refreshRecommendation,
  startVisitServices,
} from "../actions";

type Params = Promise<{ visitId: string }>;
type SearchParams = Promise<{ notice?: string; error?: string }>;
type Visit = {
  id: string;
  ticket_number: number;
  customer_name_snapshot: string | null;
  status: string;
  arrived_at: string;
  workday_id: string;
};
type Decision = {
  id: string;
  status: string;
  rotation_type: string;
  expected_state_version: number;
  recommended_employee_id: string | null;
  estimated_wait_minutes: number | null;
  explanation: string;
  service_snapshot: Array<{ name: string; listed_price: number }>;
};
type Candidate = {
  employee_id: string;
  candidate_order: number;
  availability: string;
  estimated_wait_minutes: number | null;
  outcome: string;
  skip_reason: string | null;
  explanation: string;
};
type Employee = { id: string; display_name: string };
type Assignment = {
  id: string;
  employee_id: string;
  status: string;
  captured_listed_price: number | null;
  captured_turn_calculation: string | null;
};

export default async function VisitDecisionPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ visitId }, query, context] = await Promise.all([
    params,
    searchParams,
    requireManagerContext(),
  ]);
  if (!postgresUuidSchema.safeParse(visitId).success) notFound();

  const supabase = await createClient();
  const { data: visitData } = await supabase
    .schema("app")
    .from("customer_visits")
    .select(
      "id, ticket_number, customer_name_snapshot, status, arrived_at, workday_id",
    )
    .eq("id", visitId)
    .eq("location_id", context.locationId)
    .maybeSingle();
  if (!visitData) notFound();

  const [
    { data: decisionData },
    { data: employeesData },
    { data: assignmentsData },
    { data: versionData },
  ] = await Promise.all([
    supabase
      .schema("app")
      .from("assignment_decisions")
      .select(
        "id, status, rotation_type, expected_state_version, recommended_employee_id, estimated_wait_minutes, explanation, service_snapshot",
      )
      .eq("visit_id", visitId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .schema("app")
      .from("employees")
      .select("id, display_name")
      .eq("location_id", context.locationId),
    supabase
      .schema("app")
      .from("service_assignments")
      .select(
        "id, employee_id, status, captured_listed_price, captured_turn_calculation",
      )
      .eq("visit_id", visitId),
    supabase
      .schema("app")
      .from("rotation_state_versions")
      .select("version")
      .eq("workday_id", (visitData as Visit).workday_id)
      .maybeSingle(),
  ]);

  const visit = visitData as Visit;
  const decision = decisionData as Decision | null;
  const { data: candidatesData } = decision
    ? await supabase
        .schema("app")
        .from("assignment_candidates")
        .select(
          "employee_id, candidate_order, availability, estimated_wait_minutes, outcome, skip_reason, explanation",
        )
        .eq("decision_id", decision.id)
        .order("candidate_order")
    : { data: [] };
  const candidates = (candidatesData ?? []) as Candidate[];
  const assignments = (assignmentsData ?? []) as Assignment[];
  const currentStateVersion = Number(versionData?.version ?? 0);
  const employeeMap = new Map(
    ((employeesData ?? []) as Employee[]).map((employee) => [
      employee.id,
      employee.display_name,
    ]),
  );

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      <RealtimeRefresh workdayId={visit.workday_id} />
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
      <Link className="text-sm font-semibold text-forest" href="/intake">
        ← Back to customer intake
      </Link>
      <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
            Ticket #{visit.ticket_number}
          </p>
          <h1 className="mt-2 text-4xl font-semibold">
            {visit.customer_name_snapshot ?? "Anonymous customer"}
          </h1>
        </div>
        <span className="w-fit rounded-full bg-forest/[0.08] px-4 py-2 text-sm font-semibold capitalize">
          {visit.status}
        </span>
      </div>

      {["assigned", "in_service", "completed"].includes(visit.status) ? (
        <section className="mt-8 rounded-3xl border border-forest/20 bg-forest/[0.04] p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-copper">
                Service lifecycle
              </p>
              <h2 className="mt-1 text-2xl font-semibold">
                {visit.status === "assigned"
                  ? `Assigned to ${
                      employeeMap.get(assignments[0]?.employee_id) ?? "employee"
                    }`
                  : visit.status === "in_service"
                    ? "Service is in progress"
                    : "Service completed"}
              </h2>
              {assignments[0]?.captured_listed_price !== null &&
              assignments[0]?.captured_listed_price !== undefined ? (
                <p className="mt-2 text-sm text-muted">
                  Captured value: $
                  {Number(assignments[0].captured_listed_price).toFixed(2)} ·{" "}
                  {assignments[0].captured_turn_calculation}
                </p>
              ) : null}
            </div>
            {visit.status === "assigned" ? (
              <form action={startVisitServices}>
                <input name="visitId" type="hidden" value={visit.id} />
                <input
                  name="stateVersion"
                  type="hidden"
                  value={currentStateVersion}
                />
                <button
                  className="min-h-12 rounded-xl bg-copper px-5 font-semibold text-white"
                  type="submit"
                >
                  Start service &amp; apply turn credit
                </button>
              </form>
            ) : null}
            {visit.status === "in_service" ? (
              <form action={completeVisitServices}>
                <input name="visitId" type="hidden" value={visit.id} />
                <input
                  name="stateVersion"
                  type="hidden"
                  value={currentStateVersion}
                />
                <button
                  className="min-h-12 rounded-xl bg-forest px-5 font-semibold text-white"
                  type="submit"
                >
                  Complete service
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {decision ? (
        <>
          <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-copper">
              {decision.rotation_type} rotation
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{decision.explanation}</h2>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Expected wait:{" "}
                {decision.estimated_wait_minutes === null
                  ? "unknown"
                  : `${decision.estimated_wait_minutes} minutes`}
              </p>
              {["recommended", "no_candidate"].includes(decision.status) ? (
                <form action={refreshRecommendation}>
                  <input name="visitId" type="hidden" value={visit.id} />
                  <button
                    className="min-h-10 rounded-xl border border-ink/15 bg-white px-4 text-sm font-semibold"
                    type="submit"
                  >
                    Refresh recommendation
                  </button>
                </form>
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(decision.service_snapshot ?? []).map((service) => (
                <span
                  className="rounded-full bg-forest/[0.07] px-3 py-2 text-sm"
                  key={service.name}
                >
                  {service.name} · ${Number(service.listed_price).toFixed(2)}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-6 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Candidate explanation</h2>
            <div className="mt-4 space-y-4">
              {candidates.map((candidate) => {
                const recommended =
                  candidate.employee_id === decision.recommended_employee_id;
                const eligible = ["recommended", "eligible"].includes(
                  candidate.outcome,
                );
                return (
                  <article
                    className={`rounded-2xl border p-4 ${
                      recommended
                        ? "border-forest bg-forest/[0.04]"
                        : "border-ink/10"
                    }`}
                    key={candidate.employee_id}
                  >
                    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {candidate.candidate_order}.{" "}
                            {employeeMap.get(candidate.employee_id)}
                          </h3>
                          {recommended ? (
                            <span className="rounded-full bg-forest px-2 py-1 text-xs font-semibold text-white">
                              Recommended
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm text-muted">
                          {candidate.explanation} · {candidate.availability}
                          {candidate.estimated_wait_minutes !== null
                            ? ` · ${candidate.estimated_wait_minutes} min`
                            : ""}
                        </p>
                        {candidate.skip_reason ? (
                          <p className="mt-1 text-xs font-semibold text-rose-700">
                            Rule: {candidate.skip_reason.replaceAll("_", " ")}
                          </p>
                        ) : null}
                      </div>
                      {eligible && decision.status === "recommended" ? (
                        <form
                          action={confirmAssignment}
                          className="flex min-w-56 flex-col gap-2"
                        >
                          <input name="visitId" type="hidden" value={visit.id} />
                          <input
                            name="decisionId"
                            type="hidden"
                            value={decision.id}
                          />
                          <input
                            name="employeeId"
                            type="hidden"
                            value={candidate.employee_id}
                          />
                          <input
                            name="stateVersion"
                            type="hidden"
                            value={decision.expected_state_version}
                          />
                          {!recommended ? (
                            <input
                              className="min-h-10 rounded-xl border border-ink/15 px-3 text-sm"
                              name="overrideReason"
                              placeholder="Override reason required"
                              required
                            />
                          ) : null}
                          <button
                            className="min-h-10 rounded-xl bg-forest px-4 text-sm font-semibold text-white"
                            type="submit"
                          >
                            Assign {employeeMap.get(candidate.employee_id)}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
          {decision.status === "recommended" &&
          decision.recommended_employee_id ? (
            <section className="mt-6 grid gap-5 lg:grid-cols-2">
              <form
                action={recordRefusal}
                className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm"
              >
                <h2 className="text-xl font-semibold">Employee cannot accept</h2>
                <p className="mt-1 text-sm text-muted">
                  Unapproved refusal moves the employee to the master end.
                </p>
                <input name="visitId" type="hidden" value={visit.id} />
                <input name="decisionId" type="hidden" value={decision.id} />
                <input
                  name="employeeId"
                  type="hidden"
                  value={decision.recommended_employee_id}
                />
                <input
                  className="mt-4 min-h-11 w-full rounded-xl border border-ink/15 px-3"
                  name="reason"
                  placeholder="Reason"
                  required
                />
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input name="approvedInability" type="checkbox" value="true" />
                  Manager-approved inability (no penalty)
                </label>
                <button
                  className="mt-4 min-h-11 rounded-xl bg-ink px-4 font-semibold text-white"
                  type="submit"
                >
                  Record &amp; recommend again
                </button>
              </form>

              <form
                action={convertCustomerDecline}
                className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm"
              >
                <h2 className="text-xl font-semibold">Customer declines employee</h2>
                <p className="mt-1 text-sm text-muted">
                  Converts this to a requested customer with no employee penalty.
                </p>
                <input name="visitId" type="hidden" value={visit.id} />
                <input name="decisionId" type="hidden" value={decision.id} />
                <input
                  name="rejectedEmployeeId"
                  type="hidden"
                  value={decision.recommended_employee_id}
                />
                <select
                  className="mt-4 min-h-11 w-full rounded-xl border border-ink/15 bg-white px-3"
                  name="requestedEmployeeId"
                  required
                >
                  <option value="">Choose requested employee</option>
                  {((employeesData ?? []) as Employee[])
                    .filter(
                      (employee) =>
                        employee.id !== decision.recommended_employee_id,
                    )
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.display_name}
                      </option>
                    ))}
                </select>
                <button
                  className="mt-4 min-h-11 rounded-xl bg-copper px-4 font-semibold text-white"
                  type="submit"
                >
                  Convert &amp; recommend requested employee
                </button>
              </form>
            </section>
          ) : null}
        </>
      ) : (
        <p className="mt-8 rounded-2xl bg-rose-100 p-4 text-rose-900">
          No recommendation snapshot exists for this visit.
        </p>
      )}
    </main>
  );
}
