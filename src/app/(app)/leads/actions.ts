"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "../settings/team/actions";
import { requireMember } from "@/lib/auth";
import { SOURCE_LABEL, STATUS_LABEL, type LeadSource, type LeadStatus } from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

// As elsewhere, the database decides who may create, edit or delete a lead
// (RLS on public.leads). These actions validate input and translate results.

function parseLead(formData: FormData) {
  const text = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v === "" ? null : v;
  };
  const int = (key: string) => {
    const v = text(key);
    if (v === null) return null;
    const n = Number(v.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : NaN;
  };

  const source = text("source");
  const status = text("status");
  const lead = {
    name: text("name"),
    email: text("email"),
    company: text("company"),
    company_size: int("company_size"),
    budget_usd: int("budget_usd"),
    source: (source && source in SOURCE_LABEL ? source : "other") as LeadSource,
    status: (status && status in STATUS_LABEL ? status : "new") as LeadStatus,
    owner_id: text("owner_id"),
    notes: text("notes"),
  };

  if (!lead.name) return { error: "Give the lead a name." } as const;
  if (Number.isNaN(lead.company_size) || Number.isNaN(lead.budget_usd)) {
    return { error: "Company size and budget must be whole numbers." } as const;
  }
  return { lead: { ...lead, name: lead.name } } as const;
}

function friendly(error: { code?: string; message: string }) {
  if (error.code === "23503") return "That teammate isn't in this workspace.";
  if (error.code === "23514") return "Check the email address and numbers.";
  if (error.code === "42501") return "Your role can't make that change to this lead.";
  return error.message;
}

export async function createLead(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await requireMember();
  const parsed = parseLead(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...parsed.lead,
      // Members' new leads are theirs; owners/admins can assign anyone.
      owner_id: me.role === "member" ? me.id : parsed.lead.owner_id,
      last_engaged_at: formData.get("engaged_now") ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (error) return { error: friendly(error) };

  revalidatePath("/leads");
  redirect(`/leads/${data.id}`);
}

export async function updateLead(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await requireMember();
  const parsed = parseLead(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { owner_id, ...rest } = parsed.lead;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .update(me.role === "member" ? rest : { ...rest, owner_id })
    .eq("id", String(formData.get("id")))
    .select("id");
  if (error) return { error: friendly(error) };
  if (!data?.length) return { error: "You can only edit leads assigned to you." };

  revalidatePath("/leads", "layout");
  return { success: "Lead saved." };
}

/** Records an interaction now, which refreshes the lead's recency score. */
export async function logEngagement(formData: FormData) {
  await requireMember();
  const id = String(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("leads").update({ last_engaged_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/leads", "layout");
}

export async function deleteLead(formData: FormData) {
  await requireMember();
  const supabase = await createClient();
  const { data } = await supabase.from("leads").delete().eq("id", String(formData.get("id"))).select("id");
  if (!data?.length) redirect(`/leads/${formData.get("id")}?error=delete`);
  revalidatePath("/leads");
  redirect("/leads");
}
