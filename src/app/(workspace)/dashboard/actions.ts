"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManagerContext, requireUserContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation";

const idSchema = postgresUuidSchema;
const statusSchema = z.enum([
  "available",
  "busy",
  "unavailable",
  "not_accepting_walk_ins",
]);

function dashboardRedirect(
  message: string,
  kind: "notice" | "error" = "notice",
): never {
  redirect(`/dashboard?${kind}=${encodeURIComponent(message)}`);
}

async function runRotationCommand(
  command: string,
  parameters: Record<string, string | boolean | null>,
  successMessage: string,
) {
  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc(command, parameters);

  if (error) {
    dashboardRedirect(error.message, "error");
  }

  revalidatePath("/dashboard");
  dashboardRedirect(successMessage);
}

export async function openWorkday(formData: FormData) {
  const context = await requireManagerContext();
  const notes = z.string().trim().max(500).catch("").parse(formData.get("notes"));

  await runRotationCommand(
    "open_workday",
    {
      target_location_id: context.locationId,
      target_business_date: null,
      workday_notes: notes || null,
    },
    "The workday is open. Clock in employees in their actual arrival order.",
  );
}

export async function closeWorkday(formData: FormData) {
  await requireManagerContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));

  if (!workdayId.success) {
    dashboardRedirect("Invalid workday.", "error");
  }

  await runRotationCommand(
    "close_workday",
    { target_workday_id: workdayId.data, closing_notes: null },
    "The workday was closed and daily partial credits were reset.",
  );
}

export async function clockInEmployee(formData: FormData) {
  await requireUserContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));
  const employeeId = idSchema.safeParse(formData.get("employeeId"));

  if (!workdayId.success || !employeeId.success) {
    dashboardRedirect("Invalid clock-in request.", "error");
  }

  await runRotationCommand(
    "clock_in_employee",
    {
      target_workday_id: workdayId.data,
      target_employee_id: employeeId.data,
      event_notes: null,
    },
    "Employee clocked in at the end of the active rotations.",
  );
}

export async function clockOutEmployee(formData: FormData) {
  await requireUserContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));
  const employeeId = idSchema.safeParse(formData.get("employeeId"));

  if (!workdayId.success || !employeeId.success) {
    dashboardRedirect("Invalid clock-out request.", "error");
  }

  await runRotationCommand(
    "clock_out_employee",
    {
      target_workday_id: workdayId.data,
      target_employee_id: employeeId.data,
      event_notes: null,
    },
    "Employee clocked out. A same-day return will join the end.",
  );
}

export async function setEmployeeStatus(formData: FormData) {
  await requireUserContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));
  const employeeId = idSchema.safeParse(formData.get("employeeId"));
  const status = statusSchema.safeParse(formData.get("status"));

  if (!workdayId.success || !employeeId.success || !status.success) {
    dashboardRedirect("Invalid status update.", "error");
  }

  await runRotationCommand(
    "set_employee_status",
    {
      target_workday_id: workdayId.data,
      target_employee_id: employeeId.data,
      new_status: status.data,
      status_reason: null,
      expected_end_at: null,
    },
    "Availability updated without changing rotation position.",
  );
}

export async function startEmployeeBreak(formData: FormData) {
  await requireUserContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));
  const employeeId = idSchema.safeParse(formData.get("employeeId"));
  const minutes = z.coerce.number().int().min(1).max(180).safeParse(
    formData.get("minutes"),
  );

  if (!workdayId.success || !employeeId.success || !minutes.success) {
    dashboardRedirect("Enter a break between 1 and 180 minutes.", "error");
  }

  const expectedEnd = new Date(Date.now() + minutes.data * 60_000).toISOString();
  await runRotationCommand(
    "start_employee_break",
    {
      target_workday_id: workdayId.data,
      target_employee_id: employeeId.data,
      expected_end_at: expectedEnd,
      break_notes: "Approved break",
    },
    "Break started. The employee kept both rotation positions.",
  );
}

export async function endEmployeeBreak(formData: FormData) {
  await requireUserContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));
  const employeeId = idSchema.safeParse(formData.get("employeeId"));

  if (!workdayId.success || !employeeId.success) {
    dashboardRedirect("Invalid break update.", "error");
  }

  await runRotationCommand(
    "end_employee_break",
    {
      target_workday_id: workdayId.data,
      target_employee_id: employeeId.data,
    },
    "Break ended without changing rotation position.",
  );
}

export async function setBusyMode(formData: FormData) {
  await requireManagerContext();
  const workdayId = idSchema.safeParse(formData.get("workdayId"));
  const activate = z.enum(["true", "false"]).safeParse(formData.get("activate"));
  const reason = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .safeParse(formData.get("reason"));

  if (!workdayId.success || !activate.success || !reason.success) {
    dashboardRedirect("Enter a reason for changing busy mode.", "error");
  }

  await runRotationCommand(
    "set_busy_mode",
    {
      target_workday_id: workdayId.data,
      activate: activate.data === "true",
      mode_reason: reason.data,
    },
    activate.data === "true"
      ? "Busy mode activated. Busy-only qualifications are now eligible."
      : "Busy mode ended. Normal qualifications are active.",
  );
}
