import Link from "next/link";
import { redirect } from "next/navigation";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { createVisit } from "./actions";

type SearchParams = Promise<{ notice?: string; error?: string }>;
type Category = { id: string; name: string; sort_order: number };
type Employee = { id: string; display_name: string };
type Service = {
  id: string;
  category_id: string;
  name: string;
  typical_duration_minutes: number | null;
  turn_calculation: string;
};
type Price = { service_id: string; listed_price: number };
type Visit = {
  id: string;
  ticket_number: number;
  customer_name_snapshot: string | null;
  visit_type: string;
  status: string;
  arrived_at: string;
};

const visitTypeLabels: Record<string, string> = {
  walk_in: "Walk-in",
  appointment: "Appointment",
  requested_walk_in: "Requested walk-in",
  requested_appointment: "Requested appointment",
};

export default async function IntakePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [context, query] = await Promise.all([
    requireManagerContext(),
    searchParams,
  ]);
  const supabase = await createClient();
  const { data: workdayData } = await supabase
    .schema("app")
    .from("workdays")
    .select("id")
    .eq("location_id", context.locationId)
    .eq("status", "open")
    .maybeSingle();

  if (!workdayData?.id) {
    redirect("/dashboard?error=Open the workday before adding customers.");
  }

  const [{ data: categories }, { data: services }, { data: prices }, { data: employees }, { data: visits }] =
    await Promise.all([
      supabase
        .schema("app")
        .from("service_categories")
        .select("id, name, sort_order")
        .eq("location_id", context.locationId)
        .eq("active", true)
        .order("sort_order"),
      supabase
        .schema("app")
        .from("services")
        .select(
          "id, category_id, name, typical_duration_minutes, turn_calculation",
        )
        .eq("location_id", context.locationId)
        .eq("active", true)
        .order("name"),
      supabase
        .schema("app")
        .from("service_price_versions")
        .select("service_id, listed_price")
        .eq("location_id", context.locationId)
        .is("effective_until", null),
      supabase
        .schema("app")
        .from("employees")
        .select("id, display_name")
        .eq("location_id", context.locationId)
        .eq("active", true)
        .order("display_name"),
      supabase
        .schema("app")
        .from("customer_visits")
        .select(
          "id, ticket_number, customer_name_snapshot, visit_type, status, arrived_at",
        )
        .eq("workday_id", workdayData.id)
        .order("arrived_at", { ascending: false }),
    ]);

  const categoryRows = (categories ?? []) as Category[];
  const serviceRows = (services ?? []) as Service[];
  const priceMap = new Map(
    ((prices ?? []) as Price[]).map((price) => [
      price.service_id,
      Number(price.listed_price),
    ]),
  );

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

      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
          Milestone 3 · Customer intake
        </p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">
          Add a customer
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          Select every service the customer needs. The recommendation is based
          on qualifications, the correct rotation, and the approved 15-minute
          wait rule.
        </p>
      </div>

      <form action={createVisit} className="mt-8 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <input name="workdayId" type="hidden" value={workdayData.id} />
        <section className="h-fit rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
          <label className="block text-sm font-semibold" htmlFor="customerName">
            Customer name <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            className="mt-2 min-h-11 w-full rounded-xl border border-ink/15 px-3"
            id="customerName"
            name="customerName"
            placeholder="Anonymous walk-in"
          />

          <label className="mt-5 block text-sm font-semibold" htmlFor="visitType">
            Arrival type
          </label>
          <select
            className="mt-2 min-h-11 w-full rounded-xl border border-ink/15 bg-white px-3"
            defaultValue="walk_in"
            id="visitType"
            name="visitType"
          >
            {Object.entries(visitTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <label
            className="mt-5 block text-sm font-semibold"
            htmlFor="requestedEmployeeId"
          >
            Requested employee
          </label>
          <select
            className="mt-2 min-h-11 w-full rounded-xl border border-ink/15 bg-white px-3"
            id="requestedEmployeeId"
            name="requestedEmployeeId"
          >
            <option value="">No specific employee</option>
            {((employees ?? []) as Employee[]).map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.display_name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs leading-5 text-muted">
            Required only for requested walk-ins and requested appointments.
          </p>

          <button
            className="mt-6 min-h-12 w-full rounded-xl bg-forest px-5 font-semibold text-white"
            type="submit"
          >
            Create &amp; recommend
          </button>
        </section>

        <section className="rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-semibold">Requested services</h2>
          <div className="mt-5 space-y-7">
            {categoryRows.map((category) => {
              const categoryServices = serviceRows.filter(
                (service) => service.category_id === category.id,
              );
              if (categoryServices.length === 0) return null;

              return (
                <fieldset key={category.id}>
                  <legend className="text-sm font-semibold uppercase tracking-wide text-copper">
                    {category.name}
                  </legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {categoryServices.map((service) => (
                      <label
                        className="flex cursor-pointer gap-3 rounded-2xl border border-ink/10 p-4 hover:border-forest/30"
                        key={service.id}
                      >
                        <input
                          className="mt-1 size-4 accent-forest"
                          name="serviceIds"
                          type="checkbox"
                          value={service.id}
                        />
                        <span>
                          <span className="block font-semibold">{service.name}</span>
                          <span className="mt-1 block text-xs text-muted">
                            ${priceMap.get(service.id)?.toFixed(2) ?? "—"} ·{" "}
                            {service.typical_duration_minutes ?? "—"} min
                            {service.turn_calculation.includes("haircut")
                              ? " · Haircut rotation"
                              : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      </form>

      <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">Today&apos;s customers</h2>
        {(visits ?? []).length === 0 ? (
          <p className="mt-4 text-sm text-muted">No customers added yet.</p>
        ) : (
          <div className="mt-4 divide-y divide-ink/10">
            {((visits ?? []) as Visit[]).map((visit) => (
              <Link
                className="flex items-center justify-between gap-4 py-4 hover:text-forest"
                href={`/intake/${visit.id}`}
                key={visit.id}
              >
                <div>
                  <p className="font-semibold">
                    #{visit.ticket_number} ·{" "}
                    {visit.customer_name_snapshot ?? "Anonymous"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {visitTypeLabels[visit.visit_type]} ·{" "}
                    {new Date(visit.arrived_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <span className="rounded-full bg-forest/[0.08] px-3 py-1 text-xs font-semibold capitalize">
                  {visit.status}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
