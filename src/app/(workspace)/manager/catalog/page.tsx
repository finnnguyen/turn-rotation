import type { Metadata } from "next";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import {
  addEmployee,
  addPriceVersion,
  addService,
  setEmployeeActive,
  setQualification,
} from "./actions";

export const metadata: Metadata = {
  title: "People & services",
};

type Employee = {
  id: string;
  display_name: string;
  active: boolean;
};

type Category = {
  id: string;
  name: string;
};

type Service = {
  id: string;
  category_id: string;
  name: string;
  turn_calculation: string;
  typical_duration_minutes: number | null;
};

type Price = {
  service_id: string;
  listed_price: number;
  effective_from: string;
};

type Qualification = {
  employee_id: string;
  category_id: string | null;
  level: string;
};

type CatalogPageProps = {
  searchParams: Promise<{ notice?: string; error?: string }>;
};

const inputClass =
  "min-h-11 w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-forest focus:ring-4 focus:ring-forest/10";

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const context = await requireManagerContext();
  const { notice, error: messageError } = await searchParams;
  const supabase = await createClient();

  const [employeesResult, categoriesResult, servicesResult, pricesResult, qualificationsResult] =
    await Promise.all([
      supabase
        .schema("app")
        .from("employees")
        .select("id, display_name, active")
        .eq("location_id", context.locationId)
        .order("active", { ascending: false })
        .order("display_name"),
      supabase
        .schema("app")
        .from("service_categories")
        .select("id, name")
        .eq("location_id", context.locationId)
        .eq("active", true)
        .order("sort_order"),
      supabase
        .schema("app")
        .from("services")
        .select("id, category_id, name, turn_calculation, typical_duration_minutes")
        .eq("location_id", context.locationId)
        .eq("active", true)
        .order("name"),
      supabase
        .schema("app")
        .from("service_price_versions")
        .select("service_id, listed_price, effective_from")
        .eq("location_id", context.locationId)
        .is("effective_until", null),
      supabase
        .schema("app")
        .from("employee_qualifications")
        .select("employee_id, category_id, level")
        .eq("location_id", context.locationId)
        .is("effective_until", null),
    ]);

  const queryError =
    employeesResult.error ??
    categoriesResult.error ??
    servicesResult.error ??
    pricesResult.error ??
    qualificationsResult.error;

  const employees = (employeesResult.data ?? []) as Employee[];
  const categories = (categoriesResult.data ?? []) as Category[];
  const services = (servicesResult.data ?? []) as Service[];
  const prices = (pricesResult.data ?? []) as Price[];
  const qualifications = (qualificationsResult.data ?? []) as Qualification[];
  const priceByService = new Map(prices.map((price) => [price.service_id, price]));
  const categoryById = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">
        Manager settings
      </p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">
        People &amp; services
      </h1>
      <p className="mt-3 max-w-3xl text-lg leading-8 text-muted">
        Changes are location-scoped. Prices and qualifications create effective-dated
        history rather than rewriting old assignments.
      </p>

      {notice ? (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </div>
      ) : null}
      {messageError || queryError ? (
        <div
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          {messageError ?? queryError?.message}
        </div>
      ) : null}

      <div className="mt-9 grid gap-8 xl:grid-cols-2">
        <section className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-copper">EMPLOYEES</p>
              <h2 className="mt-1 text-2xl font-semibold">Salon team</h2>
            </div>
            <span className="text-sm text-muted">{employees.length} profiles</span>
          </div>

          <form action={addEmployee} className="mt-6 flex gap-2">
            <label className="sr-only" htmlFor="employee-name">
              Employee name
            </label>
            <input
              className={inputClass}
              id="employee-name"
              name="displayName"
              placeholder="Employee name"
              required
            />
            <button
              className="shrink-0 rounded-xl bg-forest px-4 font-semibold text-white"
              type="submit"
            >
              Add
            </button>
          </form>

          <ul className="mt-6 divide-y divide-ink/10">
            {employees.map((employee) => (
              <li className="flex items-center justify-between gap-4 py-4" key={employee.id}>
                <div>
                  <p className="font-semibold">{employee.display_name}</p>
                  <p className="text-sm text-muted">
                    {employee.active ? "Active" : "Inactive"}
                  </p>
                </div>
                <form action={setEmployeeActive}>
                  <input name="employeeId" type="hidden" value={employee.id} />
                  <input
                    name="active"
                    type="hidden"
                    value={employee.active ? "false" : "true"}
                  />
                  <button
                    className="min-h-10 rounded-xl border border-ink/10 px-3 text-sm font-semibold"
                    type="submit"
                  >
                    {employee.active ? "Deactivate" : "Reactivate"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-copper">QUALIFICATIONS</p>
          <h2 className="mt-1 text-2xl font-semibold">Effective-dated skills</h2>
          <form action={setQualification} className="mt-6 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="text-sm font-semibold">Employee</span>
              <select className={`mt-2 ${inputClass}`} name="employeeId" required>
                {employees.filter((employee) => employee.active).map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold">Category</span>
              <select className={`mt-2 ${inputClass}`} name="categoryId" required>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold">Level</span>
              <select className={`mt-2 ${inputClass}`} name="level" required>
                <option value="primary">Primary</option>
                <option value="general">General</option>
                <option value="busy_only">Busy-only backup</option>
                <option value="cannot_perform">Cannot perform</option>
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold">Note</span>
              <input className={`mt-2 ${inputClass}`} name="notes" placeholder="Optional" />
            </label>
            <button
              className="min-h-11 rounded-xl bg-forest px-4 font-semibold text-white sm:col-span-2"
              type="submit"
            >
              Save qualification
            </button>
          </form>
          <p className="mt-5 text-sm leading-6 text-muted">
            {qualifications.length} current category qualifications are stored. Saving
            another value closes the previous effective range.
          </p>
        </section>

        <section className="rounded-3xl border border-ink/10 bg-white p-6 shadow-sm xl:col-span-2">
          <p className="text-sm font-semibold text-copper">SERVICE CATALOG</p>
          <h2 className="mt-1 text-2xl font-semibold">Services and current prices</h2>

          <form action={addService} className="mt-6 grid gap-4 md:grid-cols-5">
            <label>
              <span className="text-sm font-semibold">Service</span>
              <input className={`mt-2 ${inputClass}`} name="name" required />
            </label>
            <label>
              <span className="text-sm font-semibold">Category</span>
              <select className={`mt-2 ${inputClass}`} name="categoryId" required>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold">Turn calculation</span>
              <select className={`mt-2 ${inputClass}`} name="calculation" required>
                <option value="dollar">Dollar-based</option>
                <option value="mens_haircut">Men’s haircut</option>
                <option value="womens_haircut">Women’s haircut</option>
                <option value="excluded">Excluded</option>
              </select>
            </label>
            <label>
              <span className="text-sm font-semibold">Minutes</span>
              <input className={`mt-2 ${inputClass}`} min="1" name="duration" required type="number" />
            </label>
            <label>
              <span className="text-sm font-semibold">Listed price</span>
              <input className={`mt-2 ${inputClass}`} min="0" name="listedPrice" required step="0.01" type="number" />
            </label>
            <button
              className="min-h-11 rounded-xl bg-forest px-4 font-semibold text-white md:col-span-5"
              type="submit"
            >
              Add service and initial price
            </button>
          </form>

          <div className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/15 text-muted">
                  <th className="px-3 py-3 font-semibold">Service</th>
                  <th className="px-3 py-3 font-semibold">Category</th>
                  <th className="px-3 py-3 font-semibold">Calculation</th>
                  <th className="px-3 py-3 font-semibold">Current price</th>
                  <th className="px-3 py-3 font-semibold">New price version</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8">
                {services.map((service) => {
                  const price = priceByService.get(service.id);
                  return (
                    <tr key={service.id}>
                      <td className="px-3 py-4 font-semibold">{service.name}</td>
                      <td className="px-3 py-4 text-muted">
                        {categoryById.get(service.category_id)}
                      </td>
                      <td className="px-3 py-4 text-muted">
                        {service.turn_calculation.replaceAll("_", " ")}
                      </td>
                      <td className="px-3 py-4 font-semibold">
                        {price ? `$${Number(price.listed_price).toFixed(2)}` : "Missing"}
                      </td>
                      <td className="px-3 py-4">
                        <form action={addPriceVersion} className="flex gap-2">
                          <input name="serviceId" type="hidden" value={service.id} />
                          <input
                            aria-label={`New price for ${service.name}`}
                            className="w-24 rounded-lg border border-ink/15 px-2 py-2"
                            min="0"
                            name="listedPrice"
                            placeholder="$"
                            required
                            step="0.01"
                            type="number"
                          />
                          <input
                            aria-label={`Price-change reason for ${service.name}`}
                            className="min-w-40 flex-1 rounded-lg border border-ink/15 px-2 py-2"
                            name="reason"
                            placeholder="Reason"
                            required
                          />
                          <button
                            className="rounded-lg border border-forest/20 px-3 font-semibold text-forest"
                            type="submit"
                          >
                            Save
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
