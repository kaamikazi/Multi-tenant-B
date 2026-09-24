"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function deleteThread(formData: FormData) {
  await requireMember();
  const supabase = await createClient();
  // RLS: only the conversation's author can delete it.
  await supabase.from("chat_threads").delete().eq("id", String(formData.get("id")));
  redirect("/assistant");
}
