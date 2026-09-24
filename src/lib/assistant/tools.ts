import "server-only";

import type { FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "@/lib/auth";
import { PLANS } from "@/lib/billing";
import { OPEN_STATUSES, SOURCE_LABEL, STATUS_LABEL, parseBreakdown, topReasons, type LeadStatus } from "@/lib/leads";
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
  {
    label: "leads",
    declaration: {
      name: "list_leads",
      description:
        "Leads ranked by score (0-100, highest first) with tier, status, owner and the top reasons for the score. " +
        "Use for questions like 'who are my hottest leads?'. Defaults to open leads (new, contacted, qualified).",
      parametersJsonSchema: {
        type: "object",
        properties: {
          tier: { type: "string", enum: ["hot", "warm", "cold"], description: "Only leads in this tier." },
          status: {
            type: "string",
            enum: ["open", "new", "contacted", "qualified", "won", "lost", "all"],
            description: "Filter by status. 'open' (default) means new, contacted or qualified.",
          },
          assigned_to_me: { type: "boolean", description: "Only leads assigned to the current user." },
          limit: { type: "integer", description: "How many to return, 1-25. Default 10." },
        },
      },
    },
    async run({ supabase, member }, args) {
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      let query = supabase
        .from("leads_scored")
        .select("name, company, source, status, score, tier, breakdown, owner_id, last_engaged_at")
        .order("score", { ascending: false })
        .limit(limit);
      if (args.tier === "hot" || args.tier === "warm" || args.tier === "cold") query = query.eq("tier", args.tier);
      const status = typeof args.status === "string" ? args.status : "open";
      if (status === "open") query = query.in("status", OPEN_STATUSES);
      else if (status !== "all" && status in STATUS_LABEL) query = query.eq("status", status as LeadStatus);
      if (args.assigned_to_me === true) query = query.eq("owner_id", member.id);

      const [{ data: leads }, owners] = await Promise.all([query, ownerNames(supabase)]);
      return (leads ?? []).map((l) => ({
        name: l.name,
        company: l.company,
        score: l.score,
        tier: l.tier,
        status: l.status,
        source: l.source ? SOURCE_LABEL[l.source] : null,
        owner: l.owner_id ? (l.owner_id === member.id ? "you" : owners.get(l.owner_id)) : "unassigned",
        last_engaged: l.last_engaged_at?.slice(0, 10) ?? "never",
        why: topReasons(parseBreakdown(l.breakdown), 3),
      }));
    },
  },
  {
    label: "lead score breakdown",
    declaration: {
      name: "explain_lead_score",
      description:
        "The full score breakdown for leads matching a name or company: points per factor " +
        "(budget, company size, source, recency) out of the maximum, with the reason for each.",
      parametersJsonSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Part of the lead's name or company." } },
        required: ["query"],
      },
    },
    async run({ supabase }, args) {
      const q = String(args.query ?? "").replace(/[%_,()]/g, " ").trim();
      if (!q) return { error: "Say which lead." };
      const { data } = await supabase
        .from("leads_scored")
        .select("name, company, status, score, tier, breakdown, notes")
        .or(`name.ilike.%${q}%,company.ilike.%${q}%`)
        .order("score", { ascending: false })
        .limit(3);
      if (!data?.length) return { found: false, note: `No lead matches "${q}".` };
      return {
        found: true,
        leads: data.map((l) => ({
          name: l.name,
          company: l.company,
          status: l.status,
          score: l.score,
          tier: l.tier,
          breakdown: parseBreakdown(l.breakdown),
          // User-entered text: returned as data only (see system instruction).
          notes: l.notes?.slice(0, 500) ?? null,
        })),
      };
    },
  },
  {
    label: "pipeline summary",
    declaration: {
      name: "get_pipeline_summary",
      description: "Counts of leads by tier and by status, average score of open leads, and unassigned open leads.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase }) {
      const { data } = await supabase.from("leads_scored").select("status, tier, score, owner_id");
      const leads = data ?? [];
      const open = leads.filter((l) => l.status && OPEN_STATUSES.includes(l.status));
      const count = <K extends string>(rows: typeof leads, key: (r: (typeof leads)[number]) => K | null) =>
        rows.reduce<Record<string, number>>((acc, r) => {
          const k = key(r) ?? "unknown";
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {});
      return {
        total_leads: leads.length,
        open_leads: open.length,
        open_by_tier: count(open, (l) => l.tier),
        by_status: count(leads, (l) => l.status),
        average_open_score: open.length
          ? Math.round(open.reduce((s, l) => s + (l.score ?? 0), 0) / open.length)
          : null,
        unassigned_open_leads: open.filter((l) => !l.owner_id).length,
      };
    },
  },
];

async function ownerNames(supabase: SupabaseClient<Database>) {
  const { data } = await supabase.from("users").select("id, full_name, email");
  return new Map((data ?? []).map((u) => [u.id, u.full_name ?? u.email]));
}

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
