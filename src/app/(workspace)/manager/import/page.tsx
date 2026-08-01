import type { Metadata } from "next";

import { requireManagerContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { confirmDraft, uploadMenu } from "./actions";

export const metadata: Metadata = { title: "Import service menu" };
const input = "min-h-11 w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const [context, query] = await Promise.all([requireManagerContext(), searchParams]);
  const supabase = await createClient();
  const [{ data: imports }, { data: drafts }, { data: categories }] = await Promise.all([
    supabase.schema("app").from("service_menu_imports").select("id, original_filename, status, error_message, created_at").eq("location_id", context.locationId).order("created_at", { ascending: false }).limit(10),
    supabase.schema("app").from("service_import_drafts").select("id, proposed_name, proposed_price, confidence, status").eq("location_id", context.locationId).eq("status", "draft").order("created_at"),
    supabase.schema("app").from("service_categories").select("id, name").eq("location_id", context.locationId).eq("active", true).order("sort_order"),
  ]);
  const latestReadyImport = imports?.find((job) => job.status === "ready_for_review");
  const { data: extractedLines } = latestReadyImport
    ? await supabase.schema("app").from("service_menu_lines")
        .select("id, line_index, text, confidence")
        .eq("import_id", latestReadyImport.id)
        .order("line_index")
    : { data: [] };
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
    <p className="text-sm font-semibold uppercase tracking-[0.2em] text-copper">Milestone 7 · AWS portfolio feature</p>
    <h1 className="mt-2 text-4xl font-semibold">Import a service menu</h1>
    <p className="mt-2 max-w-3xl text-muted">Amazon Textract reads a private menu image. OCR results remain drafts until a manager reviews and confirms them.</p>
    {query.notice ? <p className="mt-5 rounded-xl bg-emerald-100 p-3 text-sm text-emerald-900">{query.notice}</p> : null}
    {query.error ? <p className="mt-5 rounded-xl bg-rose-100 p-3 text-sm text-rose-900">{query.error}</p> : null}
    <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold">Private image upload</h2>
      <form action={uploadMenu} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1"><span className="text-sm font-semibold">JPEG or PNG, up to 5 MB</span><input accept="image/jpeg,image/png" className={`mt-2 ${input}`} name="menu" required type="file" /></label>
        <button className="min-h-11 rounded-xl bg-forest px-5 font-semibold text-white" type="submit">Upload and extract</button>
      </form>
      <div className="mt-5 space-y-2">{(imports ?? []).map((job) => <div className="flex justify-between rounded-xl bg-ink/[0.03] p-3 text-sm" key={job.id}><span>{job.original_filename}</span><span className="capitalize">{job.status.replaceAll("_", " ")}{job.error_message ? ` · ${job.error_message}` : ""}</span></div>)}</div>
    </section>
    {latestReadyImport ? <section className="mt-8 rounded-3xl border border-ink/10 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-copper">TEXTRACT EVIDENCE</p>
      <h2 className="mt-1 text-2xl font-semibold">Extracted lines from {latestReadyImport.original_filename}</h2>
      <p className="mt-2 text-sm text-muted">A service draft requires a line containing both a service name and a price. These OCR lines are retained for manager review.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {(extractedLines ?? []).map((line) => <div className="flex items-center justify-between gap-4 rounded-xl bg-ink/[0.03] px-3 py-2 text-sm" key={line.id}>
          <span>{line.text}</span>
          <span className={Number(line.confidence) < 85 ? "shrink-0 font-semibold text-amber-700" : "shrink-0 text-muted"}>{Number(line.confidence).toFixed(1)}%</span>
        </div>)}
      </div>
    </section> : null}
    <section className="mt-8 space-y-4">
      <h2 className="text-2xl font-semibold">Drafts awaiting manager review</h2>
      {(drafts ?? []).length === 0 ? <p className="rounded-3xl border border-dashed border-ink/20 p-8 text-muted">No service-price candidates were found. The latest image contains business information rather than service prices; upload the salon price-list image.</p> : (drafts ?? []).map((draft) => <form action={confirmDraft} className="grid gap-3 rounded-3xl border border-ink/10 bg-white p-5 shadow-sm md:grid-cols-6" key={draft.id}>
        <input name="draftId" type="hidden" value={draft.id} />
        <label className="md:col-span-2"><span className="text-xs font-semibold">Service name</span><input className={`mt-1 ${input}`} defaultValue={draft.proposed_name} name="name" required /></label>
        <label><span className="text-xs font-semibold">Price</span><input className={`mt-1 ${input}`} defaultValue={draft.proposed_price ?? ""} min="0" name="price" required step="0.01" type="number" /></label>
        <label><span className="text-xs font-semibold">Category</span><select className={`mt-1 ${input}`} name="categoryId" required>{(categories ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label><span className="text-xs font-semibold">Turn rule</span><select className={`mt-1 ${input}`} name="calculation"><option value="dollar">Dollar</option><option value="mens_haircut">Men haircut</option><option value="womens_haircut">Women haircut</option><option value="excluded">Excluded</option></select></label>
        <label><span className="text-xs font-semibold">Minutes</span><input className={`mt-1 ${input}`} defaultValue="30" min="1" name="duration" required type="number" /></label>
        <div className="flex items-center justify-between md:col-span-6"><span className={Number(draft.confidence) < 85 ? "font-semibold text-amber-700" : "text-muted"}>OCR confidence: {Number(draft.confidence).toFixed(1)}%</span><button className="min-h-11 rounded-xl bg-forest px-5 font-semibold text-white" type="submit">Confirm and publish</button></div>
      </form>)}
    </section>
  </main>;
}
