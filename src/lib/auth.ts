import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Plan } from "@/lib/billing";
import type { Role } from "@/lib/rbac";

export type Member = {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  tenant: { id: string; name: string; slug: string; plan: Plan };
};

/** The signed-in auth user's id and email, or null. Deduplicated per request. */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) return null;
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? "" };
});

/**
 * The signed-in user's membership: who they are, their tenant, their role.
 * Read through RLS, so it can only ever return the caller's own row.
 */
export const getMember = cache(async (): Promise<Member | null> => {
  const authUser = await getAuthUser();
  if (!authUser) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, email, full_name, role, tenant:tenants (id, name, slug, plan)")
    .eq("id", authUser.id)
    .maybeSingle();

  if (!data?.tenant) return null;
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    tenant: data.tenant,
  };
});

/** For pages behind sign-in. Sends visitors to /login, tenantless users to /no-workspace. */
export async function requireMember(): Promise<Member> {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");
  const member = await getMember();
  if (!member) redirect("/no-workspace");
  return member;
}

/** For pages only some roles may open. Others land back on the dashboard. */
export async function requireRole(...roles: Role[]): Promise<Member> {
  const member = await requireMember();
  if (!roles.includes(member.role)) redirect("/dashboard?denied=1");
  return member;
}
