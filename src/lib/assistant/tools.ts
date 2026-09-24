import "server-only";

import type { FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "@/lib/auth";
import { PLANS } from "@/lib/billing";
import type { Database } from "@/lib/supabase/database.types";

// Tools the assistant may call to answer questions.
//
// The isolation guarantee lives here: every tool queries through `supabase`,
// the *signed-in user's* client, never the admin client. So the model sees
// exactly what this user's role can see under RLS: never another tenant's
// rows, and never, say, billing if the user is a member. The model cannot
// widen that, whatever it is asked, because it only chooses which of these
// read-only functions to call.

type ToolContext = { supabase: SupabaseClient<Database>; member: Member };

type Tool = {
  declaration: FunctionDeclaration;
  /** Shown in the chat as "Looked up <label>". */
  label: string;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
};

const NOT_VISIBLE = (what: string, role: string) => ({
  visible: false,
  note: `${what} is not visible to the ${role} role. Only owners and admins can see it.`,
});

const TOOLS: Tool[] = [
  {
    label: "workspace overview",
    declaration: {
      name: "get_workspace_overview",
      description:
        "Workspace name, plan, the current user's role, team size by role, seat usage and AI message usage this month.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase, member }) {
      const [{ data: users }, { data: seats }, { data: ai }] = await Promise.all([
        supabase.from("users").select("role"),
        supabase.rpc("get_seat_usage").maybeSingle(),
        supabase.rpc("get_ai_usage").maybeSingle(),
      ]);
      const byRole = { owner: 0, admin: 0, member: 0 };
      users?.forEach((u) => byRole[u.role]++);
      return {
        workspace: member.tenant.name,
        plan: PLANS[member.tenant.plan].name,
        your_role: member.role,
        team_size: users?.length ?? 0,
        team_by_role: byRole,
        seats: seats ? { used: seats.used, limit: seats.seat_limit ?? "unlimited" } : null,
        ai_messages_this_month: ai ? { used: ai.used, limit: ai.message_limit ?? "unlimited" } : null,
      };
    },
  },
  {
    label: "team members",
    declaration: {
      name: "list_team_members",
      description: "Everyone in the workspace: name, email, role and when they joined.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["owner", "admin", "member"], description: "Only return people with this role." },
        },
      },
    },
    async run({ supabase }, args) {
      let query = supabase.from("users").select("full_name, email, role, created_at").order("created_at");
      if (args.role === "owner" || args.role === "admin" || args.role === "member") query = query.eq("role", args.role);
      const { data } = await query;
      return (data ?? []).map((u) => ({ name: u.full_name, email: u.email, role: u.role, joined: u.created_at.slice(0, 10) }));
    },
  },
  {
    label: "pending invitations",
    declaration: {
      name: "list_pending_invitations",
      description: "Invitations that have been sent but not accepted yet (owners and admins only).",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase, member }) {
      if (member.role === "member") return NOT_VISIBLE("Invitations", member.role);
      const { data } = await supabase
        .from("invitations")
        .select("email, role, expires_at")
        .is("accepted_at", null)
        .order("created_at");
      return {
        visible: true,
        invitations: (data ?? []).map((i) => ({
          email: i.email,
          role: i.role,
          expires: i.expires_at.slice(0, 10),
          expired: new Date(i.expires_at) < new Date(),
        })),
      };
    },
  },
  {
    label: "billing status",
    declaration: {
      name: "get_billing_status",
      description: "Subscription status, renewal or cancellation date (owners and admins only).",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase, member }) {
      // RLS returns nothing for members; say so explicitly rather than "no data".
      const { data } = await supabase
        .from("billing")
        .select("subscription_status, current_period_end, cancel_at_period_end")
        .maybeSingle();
      if (member.role === "member") return NOT_VISIBLE("Billing", member.role);
      return {
        visible: true,
        plan: PLANS[member.tenant.plan].name,
        price_per_month_usd: PLANS[member.tenant.plan].price,
        subscription_status: data?.subscription_status ?? "none (free plan)",
        current_period_end: data?.current_period_end?.slice(0, 10) ?? null,
        cancels_at_period_end: data?.cancel_at_period_end ?? false,
      };
    },
  },
];

export const toolDeclarations = TOOLS.map((t) => t.declaration);

export function toolLabel(name: string) {
  return TOOLS.find((t) => t.declaration.name === name)?.label ?? name;
}

export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown> = {}) {
  const tool = TOOLS.find((t) => t.declaration.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  try {
    return await tool.run(ctx, args);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}
