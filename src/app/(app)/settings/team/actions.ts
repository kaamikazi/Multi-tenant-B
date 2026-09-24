"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import type { Role } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error?: string; success?: string };

const ROLES: Role[] = ["owner", "admin", "member"];
const asRole = (value: FormDataEntryValue | null) =>
  ROLES.includes(value as Role) ? (value as Role) : null;

// None of these check the caller's role themselves. The database decides:
// RLS policies for invitations and removals, checked RPCs for role changes.
// Actions only translate the database's answer into a message.

export async function inviteMember(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const member = await requireMember();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = asRole(formData.get("role"));
  if (!email || !role) return { error: "Enter an email and pick a role." };

  const supabase = await createClient();

  const { data: existing } = await supabase.from("users").select("id").ilike("email", email).maybeSingle();
  if (existing) return { error: `${email} is already on the team.` };

  const { error } = await supabase.from("invitations").insert({ email, role });
  if (error) {
    if (error.code === "23505") return { error: `There's already a pending invitation for ${email}.` };
    if (error.code === "42501") return { error: `Your role (${member.role}) can't invite ${role}s.` };
    if (error.code === "23514") return { error: "Enter a valid email address." };
    return { error: error.message };
  }

  revalidatePath("/settings/team");
  return { success: `Invitation created for ${email}. Copy the link below and send it to them.` };
}

export async function revokeInvitation(formData: FormData) {
  await requireMember();
  const supabase = await createClient();
  await supabase.from("invitations").delete().eq("id", String(formData.get("id")));
  revalidatePath("/settings/team");
}

export async function removeMember(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .delete()
    .eq("id", String(formData.get("userId")))
    .select("email");

  if (error) return { error: error.message };
  // RLS turns a forbidden delete into "0 rows", not an error.
  if (!data?.length) return { error: "You don't have permission to remove this person." };

  revalidatePath("/settings/team");
  return { success: `${data[0].email} was removed.` };
}

export async function changeRole(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireMember();
  const role = asRole(formData.get("role"));
  if (!role) return { error: "Pick a role." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member_role", {
    p_user_id: String(formData.get("userId")),
    p_role: role,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return { success: "Role updated." };
}

export async function transferOwnership(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_ownership", {
    p_new_owner: String(formData.get("userId")),
  });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return { success: "Ownership transferred. You are now an admin." };
}
