"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { postgresUuidSchema } from "@/lib/validation";

function returnToImport(message: string, kind: "notice" | "error" = "notice"): never {
  redirect(`/manager/import?${kind}=${encodeURIComponent(message)}`);
}

export async function uploadMenu(formData: FormData) {
  const context = await requireManagerContext();
  const file = formData.get("menu");
  if (!(file instanceof File) || !["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
    returnToImport("Choose a JPEG or PNG no larger than 5 MB.", "error");
  }
  const supabase = await createClient();
  const importId = crypto.randomUUID();
  const extension = file.type === "image/png" ? "png" : "jpg";
  const path = `${context.locationId}/${importId}.${extension}`;
  const { error: storageError } = await supabase.storage.from("service-menu-imports")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (storageError) returnToImport(storageError.message, "error");
  const { error: insertError } = await supabase.schema("app").from("service_menu_imports").insert({
    id: importId, location_id: context.locationId, source_path: path,
    original_filename: file.name, mime_type: file.type, created_by: context.userId,
  });
  if (insertError) returnToImport(insertError.message, "error");
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) returnToImport("Your session expired. Sign in and try again.", "error");
  const { data: functionData, error: functionError } = await supabase.functions.invoke("process-service-menu", {
    body: { importId },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  revalidatePath("/manager/import");
  let functionMessage = functionError?.message;
  if (functionError && "context" in functionError && functionError.context instanceof Response) {
    try {
      const payload = (await functionError.context.json()) as { error?: string };
      functionMessage = payload.error ?? functionMessage;
    } catch {
      // Keep the SDK message when the response does not contain JSON.
    }
  }
  const counts = functionData as { lines?: number; drafts?: number } | null;
  const successMessage = counts?.drafts
    ? `Textract found ${counts.lines ?? 0} lines and created ${counts.drafts} service drafts for review.`
    : `Textract found ${counts?.lines ?? 0} lines, but none contained both a service name and price. Upload the actual price-list image.`;
  returnToImport(functionError ? `Image saved, but OCR could not start: ${functionMessage}` : successMessage, functionError ? "error" : "notice");
}

const confirmSchema = z.object({
  draftId: postgresUuidSchema, categoryId: postgresUuidSchema,
  name: z.string().trim().min(1).max(120), price: z.coerce.number().min(0),
  calculation: z.enum(["dollar", "mens_haircut", "womens_haircut", "excluded"]),
  duration: z.coerce.number().int().min(1).max(720),
});

export async function confirmDraft(formData: FormData) {
  await requireManagerContext();
  const parsed = confirmSchema.safeParse({
    draftId: formData.get("draftId"), categoryId: formData.get("categoryId"),
    name: formData.get("name"), price: formData.get("price"),
    calculation: formData.get("calculation"), duration: formData.get("duration"),
  });
  if (!parsed.success) returnToImport("Review every service field.", "error");
  const supabase = await createClient();
  const { error } = await supabase.schema("app").rpc("confirm_service_import_draft", {
    target_draft_id: parsed.data.draftId, target_category_id: parsed.data.categoryId,
    service_name: parsed.data.name, calculation: parsed.data.calculation,
    duration_minutes: parsed.data.duration, listed_price: parsed.data.price,
  });
  if (error) returnToImport(error.message, "error");
  revalidatePath("/manager/import");
  revalidatePath("/manager/catalog");
  returnToImport(`${parsed.data.name} was reviewed and published.`);
}
