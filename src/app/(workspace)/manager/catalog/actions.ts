"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation";

const employeeSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
});

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  categoryId: postgresUuidSchema,
  calculation: z.enum([
    "dollar",
    "mens_haircut",
    "womens_haircut",
    "excluded",
  ]),
  duration: z.coerce.number().int().min(1).max(720),
  listedPrice: z.coerce.number().min(0).max(100000),
});

const priceSchema = z.object({
  serviceId: postgresUuidSchema,
  listedPrice: z.coerce.number().min(0).max(100000),
  reason: z.string().trim().min(1).max(500),
});

const qualificationSchema = z.object({
  employeeId: postgresUuidSchema,
  categoryId: postgresUuidSchema,
  level: z.enum(["primary", "general", "busy_only", "cannot_perform"]),
  notes: z.string().trim().max(500).optional(),
});

function managerRedirect(
  message: string,
  kind: "notice" | "error" = "notice",
): never {
  redirect(`/manager/catalog?${kind}=${encodeURIComponent(message)}`);
}

export async function addEmployee(formData: FormData) {
  const parsed = employeeSchema.safeParse({
    displayName: formData.get("displayName"),
  });

  if (!parsed.success) {
    managerRedirect("Enter an employee name.", "error");
  }

  const context = await requireManagerContext();
  const supabase = await createClient();
  const { error } = await supabase.schema("app").from("employees").insert({
    location_id: context.locationId,
    display_name: parsed.data.displayName,
  });

  if (error) {
    managerRedirect(error.message, "error");
  }

  revalidatePath("/manager/catalog");
  managerRedirect(`${parsed.data.displayName} was added.`);
}

export async function setEmployeeActive(formData: FormData) {
  const employeeId = postgresUuidSchema.safeParse(formData.get("employeeId"));
  const active = z.enum(["true", "false"]).safeParse(formData.get("active"));

  if (!employeeId.success || !active.success) {
    managerRedirect("Invalid employee update.", "error");
  }

  await requireManagerContext();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .from("employees")
    .update({ active: active.data === "true" })
    .eq("id", employeeId.data);

  if (error) {
    managerRedirect(error.message, "error");
  }

  revalidatePath("/manager/catalog");
  managerRedirect("Employee status updated.");
}

export async function addService(formData: FormData) {
  const parsed = serviceSchema.safeParse({
    name: formData.get("name"),
    categoryId: formData.get("categoryId"),
    calculation: formData.get("calculation"),
    duration: formData.get("duration"),
    listedPrice: formData.get("listedPrice"),
  });

  if (!parsed.success) {
    managerRedirect("Review the service details and try again.", "error");
  }

  const context = await requireManagerContext();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .rpc("create_service_with_price", {
      target_location_id: context.locationId,
      target_category_id: parsed.data.categoryId,
      service_name: parsed.data.name,
      calculation: parsed.data.calculation,
      duration_minutes: parsed.data.duration,
      initial_listed_price: parsed.data.listedPrice,
    });

  if (error) {
    managerRedirect(error.message, "error");
  }

  revalidatePath("/manager/catalog");
  managerRedirect(`${parsed.data.name} was added.`);
}

export async function addPriceVersion(formData: FormData) {
  const parsed = priceSchema.safeParse({
    serviceId: formData.get("serviceId"),
    listedPrice: formData.get("listedPrice"),
    reason: formData.get("reason"),
  });

  if (!parsed.success) {
    managerRedirect("Enter a valid price and reason.", "error");
  }

  await requireManagerContext();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .rpc("create_service_price_version", {
      target_service_id: parsed.data.serviceId,
      new_listed_price: parsed.data.listedPrice,
      starts_at: new Date().toISOString(),
      reason: parsed.data.reason,
    });

  if (error) {
    managerRedirect(error.message, "error");
  }

  revalidatePath("/manager/catalog");
  managerRedirect("A new historical price version was created.");
}

export async function setQualification(formData: FormData) {
  const parsed = qualificationSchema.safeParse({
    employeeId: formData.get("employeeId"),
    categoryId: formData.get("categoryId"),
    level: formData.get("level"),
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    managerRedirect("Review the qualification details.", "error");
  }

  await requireManagerContext();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .rpc("set_employee_category_qualification", {
      target_employee_id: parsed.data.employeeId,
      target_category_id: parsed.data.categoryId,
      new_level: parsed.data.level,
      starts_at: new Date().toISOString(),
      qualification_notes: parsed.data.notes ?? null,
    });

  if (error) {
    managerRedirect(error.message, "error");
  }

  revalidatePath("/manager/catalog");
  managerRedirect("Qualification updated with effective-dated history.");
}
