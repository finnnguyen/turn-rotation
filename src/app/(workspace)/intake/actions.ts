"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation";

const visitTypeSchema = z.enum([
  "walk_in",
  "appointment",
  "requested_walk_in",
  "requested_appointment",
]);

function intakeRedirect(
  path: string,
  message: string,
  kind: "notice" | "error" = "notice",
): never {
  redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

export async function createVisit(formData: FormData) {
  await requireManagerContext();
  const workdayId = postgresUuidSchema.safeParse(formData.get("workdayId"));
  const visitType = visitTypeSchema.safeParse(formData.get("visitType"));
  const serviceIds = z
    .array(postgresUuidSchema)
    .min(1)
    .safeParse(formData.getAll("serviceIds"));
  const requestedValue = formData.get("requestedEmployeeId");
  const requestedEmployeeId =
    typeof requestedValue === "string" && requestedValue.length > 0
      ? postgresUuidSchema.safeParse(requestedValue)
      : null;
  const customerName = z
    .string()
    .trim()
    .max(120)
    .catch("")
    .parse(formData.get("customerName"));

  if (
    !workdayId.success ||
    !visitType.success ||
    !serviceIds.success ||
    (requestedEmployeeId !== null && !requestedEmployeeId.success)
  ) {
    intakeRedirect("/intake", "Select at least one valid service.", "error");
  }

  if (
    visitType.data.startsWith("requested_") &&
    requestedEmployeeId === null
  ) {
    intakeRedirect(
      "/intake",
      "Choose an employee for a requested customer.",
      "error",
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("app")
    .rpc("create_visit_and_recommend", {
      target_workday_id: workdayId.data,
      selected_service_ids: serviceIds.data,
      selected_visit_type: visitType.data,
      customer_name: customerName || null,
      target_requested_employee_id: requestedEmployeeId?.data ?? null,
      visit_notes: null,
    });

  if (error) {
    intakeRedirect("/intake", error.message, "error");
  }

  const result = data as { visit_id?: string; ticket_number?: number } | null;
  if (!result?.visit_id) {
    intakeRedirect("/intake", "Recommendation was not created.", "error");
  }

  revalidatePath("/intake");
  redirect(
    `/intake/${result.visit_id}?notice=${encodeURIComponent(
      `Ticket ${result.ticket_number} was created.`,
    )}`,
  );
}

export async function confirmAssignment(formData: FormData) {
  await requireManagerContext();
  const visitId = postgresUuidSchema.safeParse(formData.get("visitId"));
  const decisionId = postgresUuidSchema.safeParse(formData.get("decisionId"));
  const employeeId = postgresUuidSchema.safeParse(formData.get("employeeId"));
  const stateVersion = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(formData.get("stateVersion"));
  const overrideReason = z
    .string()
    .trim()
    .max(500)
    .catch("")
    .parse(formData.get("overrideReason"));

  if (
    !visitId.success ||
    !decisionId.success ||
    !employeeId.success ||
    !stateVersion.success
  ) {
    intakeRedirect("/intake", "Invalid assignment request.", "error");
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc("confirm_assignment", {
    target_decision_id: decisionId.data,
    selected_employee_id: employeeId.data,
    expected_state_version: stateVersion.data,
    command_idempotency_key: crypto.randomUUID(),
    override_reason: overrideReason || null,
  });

  if (error) {
    intakeRedirect(`/intake/${visitId.data}`, error.message, "error");
  }

  revalidatePath("/intake");
  revalidatePath(`/intake/${visitId.data}`);
  intakeRedirect(
    `/intake/${visitId.data}`,
    "Assignment confirmed for all selected services.",
  );
}

export async function refreshRecommendation(formData: FormData) {
  await requireManagerContext();
  const visitId = postgresUuidSchema.safeParse(formData.get("visitId"));

  if (!visitId.success) {
    intakeRedirect("/intake", "Invalid recommendation request.", "error");
  }

  const supabase = await createClient();
  const { error } = await supabase
    .schema("app")
    .rpc("refresh_visit_recommendation", {
      target_visit_id: visitId.data,
    });

  if (error) {
    intakeRedirect(`/intake/${visitId.data}`, error.message, "error");
  }

  revalidatePath(`/intake/${visitId.data}`);
  revalidatePath("/intake");
  intakeRedirect(
    `/intake/${visitId.data}`,
    "Recommendation refreshed using the current rotation and assignments.",
  );
}

async function runServiceCommand(
  command: "start_visit_services" | "complete_visit_services",
  formData: FormData,
  successMessage: string,
) {
  await requireManagerContext();
  const visitId = postgresUuidSchema.safeParse(formData.get("visitId"));
  const stateVersion = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(formData.get("stateVersion"));

  if (!visitId.success || !stateVersion.success) {
    intakeRedirect("/intake", "Invalid service command.", "error");
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc(command, {
    target_visit_id: visitId.data,
    expected_state_version: stateVersion.data,
    command_idempotency_key: crypto.randomUUID(),
  });

  if (error) {
    intakeRedirect(`/intake/${visitId.data}`, error.message, "error");
  }

  revalidatePath("/dashboard");
  revalidatePath("/intake");
  revalidatePath(`/intake/${visitId.data}`);
  intakeRedirect(`/intake/${visitId.data}`, successMessage);
}

export async function startVisitServices(formData: FormData) {
  await runServiceCommand(
    "start_visit_services",
    formData,
    "Service started. Listed prices were captured and rotation credit was applied.",
  );
}

export async function completeVisitServices(formData: FormData) {
  await runServiceCommand(
    "complete_visit_services",
    formData,
    "Service completed. The employee is available for the next customer.",
  );
}

export async function recordRefusal(formData: FormData) {
  await requireManagerContext();
  const visitId = postgresUuidSchema.safeParse(formData.get("visitId"));
  const decisionId = postgresUuidSchema.safeParse(formData.get("decisionId"));
  const employeeId = postgresUuidSchema.safeParse(formData.get("employeeId"));
  const reason = z.string().trim().min(1).max(500).safeParse(formData.get("reason"));
  const approved = formData.get("approvedInability") === "true";

  if (
    !visitId.success ||
    !decisionId.success ||
    !employeeId.success ||
    !reason.success
  ) {
    intakeRedirect("/intake", "Enter a valid refusal reason.", "error");
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc("record_employee_refusal", {
    target_decision_id: decisionId.data,
    target_employee_id: employeeId.data,
    refusal_reason: reason.data,
    approved_inability: approved,
  });
  if (error) {
    intakeRedirect(`/intake/${visitId.data}`, error.message, "error");
  }

  revalidatePath("/dashboard");
  revalidatePath(`/intake/${visitId.data}`);
  intakeRedirect(
    `/intake/${visitId.data}`,
    approved
      ? "Approved inability recorded with no rotation penalty."
      : "Refusal recorded; employee moved to the master rotation end.",
  );
}

export async function convertCustomerDecline(formData: FormData) {
  await requireManagerContext();
  const visitId = postgresUuidSchema.safeParse(formData.get("visitId"));
  const decisionId = postgresUuidSchema.safeParse(formData.get("decisionId"));
  const rejectedEmployeeId = postgresUuidSchema.safeParse(
    formData.get("rejectedEmployeeId"),
  );
  const requestedEmployeeId = postgresUuidSchema.safeParse(
    formData.get("requestedEmployeeId"),
  );

  if (
    !visitId.success ||
    !decisionId.success ||
    !rejectedEmployeeId.success ||
    !requestedEmployeeId.success
  ) {
    intakeRedirect("/intake", "Choose another requested employee.", "error");
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc("convert_customer_decline", {
    target_decision_id: decisionId.data,
    rejected_employee_id: rejectedEmployeeId.data,
    requested_employee_id: requestedEmployeeId.data,
  });
  if (error) {
    intakeRedirect(`/intake/${visitId.data}`, error.message, "error");
  }

  revalidatePath(`/intake/${visitId.data}`);
  intakeRedirect(
    `/intake/${visitId.data}`,
    "Customer converted to a requested visit; the rejected employee kept their position.",
  );
}
