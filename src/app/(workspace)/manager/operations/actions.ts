"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation";

function operationsRedirect(
  message: string,
  kind: "notice" | "error" = "notice",
): never {
  redirect(`/manager/operations?${kind}=${encodeURIComponent(message)}`);
}

export async function applyBalanceCorrection(formData: FormData) {
  await requireManagerContext();
  const workdayId = postgresUuidSchema.safeParse(formData.get("workdayId"));
  const employeeId = postgresUuidSchema.safeParse(formData.get("employeeId"));
  const dollarBalance = z.coerce.number().min(0).max(29.99).safeParse(
    formData.get("dollarBalance"),
  );
  const haircutBalance = z.coerce.number().min(0).max(0.999999).safeParse(
    formData.get("haircutBalance"),
  );
  const reason = z.string().trim().min(1).max(1000).safeParse(
    formData.get("reason"),
  );
  const moveToEnd = formData.get("moveToEnd") === "true";

  if (
    !workdayId.success ||
    !employeeId.success ||
    !dollarBalance.success ||
    !haircutBalance.success ||
    !reason.success
  ) {
    operationsRedirect(
      "Enter valid partial balances and a correction reason.",
      "error",
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc("apply_balance_correction", {
    target_workday_id: workdayId.data,
    target_employee_id: employeeId.data,
    corrected_dollar_balance: dollarBalance.data,
    corrected_haircut_balance: haircutBalance.data,
    correction_reason: reason.data,
    move_to_master_end: moveToEnd,
  });
  if (error) operationsRedirect(error.message, "error");

  revalidatePath("/dashboard");
  revalidatePath("/manager/operations");
  operationsRedirect("Compensating correction applied and audited.");
}
