import { DetectDocumentTextCommand, TextractClient } from "npm:@aws-sdk/client-textract@3";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = { "Content-Type": "application/json" };

function namedKey(variable: string) {
  const value = Deno.env.get(variable);
  if (!value) return undefined;
  const keys = JSON.parse(value) as Record<string, string>;
  return keys.default ?? Object.values(keys)[0];
}

function assertResult(result: { error: { message: string } | null }, operation: string) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
}

Deno.serve(async (request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? namedKey("SUPABASE_PUBLISHABLE_KEYS");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? namedKey("SUPABASE_SECRET_KEYS");
  if (!anonKey || !serviceKey) return new Response(JSON.stringify({
    error: "Supabase function keys are unavailable",
  }), { status: 500, headers: corsHeaders });
  const auth = request.headers.get("Authorization") ?? "";
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const admin = createClient(supabaseUrl, serviceKey);
  const token = auth.replace("Bearer ", "");
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  const userId = userData.user?.id;
  const { importId } = await request.json();
  const { data: job } = await userClient.schema("app").from("service_menu_imports")
    .select("id, source_path, status").eq("id", importId).single();
  if (!userId || userError || !job) return new Response(JSON.stringify({
    error: userError?.message ?? "Manager access could not be verified",
  }), { status: 403, headers: corsHeaders });
  if (job.status === "ready_for_review" || job.status === "confirmed")
    return new Response(JSON.stringify({ importId, status: job.status }), { headers: corsHeaders });

  try {
    const processingResult = await admin.schema("app").from("service_menu_imports").update({ status: "processing", error_message: null }).eq("id", importId);
    assertResult(processingResult, "Could not mark import as processing");
    const { data: file, error } = await admin.storage.from("service-menu-imports").download(job.source_path);
    if (error) throw error;
    const client = new TextractClient({ region: Deno.env.get("AWS_REGION") ?? "us-west-2" });
    const result = await client.send(new DetectDocumentTextCommand({
      Document: { Bytes: new Uint8Array(await file.arrayBuffer()) },
    }));
    const lines = (result.Blocks ?? []).filter((block) => block.BlockType === "LINE" && block.Text);
    const linesResult = await admin.schema("app").from("service_menu_lines").upsert(lines.map((line, index) => ({
      import_id: importId, location_id: job.source_path.split("/")[0], line_index: index,
      text: line.Text!, confidence: line.Confidence ?? 0, bounding_box: line.Geometry?.BoundingBox ?? null,
    })), { onConflict: "import_id,line_index" });
    assertResult(linesResult, "Could not retain OCR lines");
    const savedLinesResult = await admin.schema("app").from("service_menu_lines")
      .select("id, text, confidence").eq("import_id", importId).order("line_index");
    assertResult(savedLinesResult, "Could not read retained OCR lines");
    const savedLines = savedLinesResult.data;
    const drafts = (savedLines ?? []).flatMap((line) => {
      const match = line.text.match(/^(.+?)\s*[:.-]?\s*\$\s*(\d+(?:\.\d{1,2})?)\s*$/);
      return match ? [{ import_id: importId, location_id: job.source_path.split("/")[0], source_line_id: line.id,
        proposed_name: match[1].trim(), proposed_price: Number(match[2]), confidence: line.confidence }] : [];
    });
    if (drafts.length) {
      const draftResult = await admin.schema("app").from("service_import_drafts").insert(drafts);
      assertResult(draftResult, "Could not create service drafts");
    }
    const readyResult = await admin.schema("app").from("service_menu_imports").update({
      status: "ready_for_review", raw_response: result, processed_at: new Date().toISOString(),
    }).eq("id", importId);
    assertResult(readyResult, "Could not mark import ready for review");
    return new Response(JSON.stringify({ importId, lines: lines.length, drafts: drafts.length }), { headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Textract failed";
    await admin.schema("app").from("service_menu_imports").update({ status: "failed", error_message: message }).eq("id", importId);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: corsHeaders });
  }
});
