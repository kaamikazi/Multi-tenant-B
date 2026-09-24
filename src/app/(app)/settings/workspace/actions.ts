"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "../team/actions";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function renameWorkspace(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const member = await requireMember();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 100) return { error: "Use a name between 1 and 100 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({ name })
    .eq("id", member.tenant.id)
    .select("id");

  if (error) return { error: error.message };
  // RLS: only the owner's update matches a row.
  if (!data?.length) return { error: "Only the owner can rename the workspace." };

  revalidatePath("/", "layout");
  return { success: "Workspace renamed." };
}
