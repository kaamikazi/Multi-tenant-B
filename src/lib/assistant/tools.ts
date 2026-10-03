import "server-only";

import type { FunctionDeclaration } from "@google/genai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Member } from "@/lib/auth";
import { PLANS } from "@/lib/billing";
import { SOURCE_LABEL, STATUS_LABEL, parseBreakdown, topReasons, type LeadStatus } from "@/lib/leads";
import { dayKey, formatDay, formatRange, zonedTimeToUtc } from "@/lib/appointments";
import { BUDGET, sanitizeToolResult, withTimeout } from "./limits";
import type { Database } from "@/lib/supabase/database.types";

// Tools the assistant may call to answer questions.
//
// Security model (see README, "AI assistant"):
//  - Every tool queries through `supabase`, the *signed-in user's* client,
//    never the admin client, so the model sees exactly what this user's role
//    can see under RLS. It cannot widen that: it only picks which of these
//    read-only functions to call.
//  - Every collection is bounded, and aggregation happens in SQL
//    (migration 20260927000009), so cost doesn't grow with the tenant.
//  - Tools return the fewest fields that answer the question. Free text that
//    isn't needed (lead notes, email addresses) is not returned at all; the
//    rest is sanitised and labelled as untrusted data (see limits.ts).

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
      description: "Workspace name, plan, the current user's role, team size by role, seat usage and AI message usage this month.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase, member }) {
      const [{ data: team }, { data: seats }, { data: ai }] = await Promise.all([
        supabase.rpc("ai_team_overview").maybeSingle(),
        supabase.rpc("get_seat_usage").maybeSingle(),
        supabase.rpc("get_ai_usage").maybeSingle(),
      ]);
      return {
        workspace: member.tenant.name,
        plan: PLANS[member.tenant.plan].name,
        your_role: member.role,
        team: team ?? null,
        seats: seats ? { used: seats.used, limit: seats.seat_limit ?? "unlimited", over_limit: seats.over_limit } : null,
        ai_messages_this_month: ai ? { used: ai.used, limit: ai.message_limit ?? "unlimited" } : null,
      };
    },
  },
  {
    label: "team members",
    declaration: {
      name: "list_team_members",
      description: "People in the workspace (up to 50): name, role and when they joined.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          role: { type: "string", enum: ["owner", "admin", "member"], description: "Only return people with this role." },
        },
      },
    },
    async run({ supabase }, args) {
      let query = supabase.from("users").select("full_name, role, created_at").order("created_at").limit(50);
      if (args.role === "owner" || args.role === "admin" || args.role === "member") query = query.eq("role", args.role);
      const { data } = await query;
      return (data ?? []).map((u) => ({ name: u.full_name ?? "(no name)", role: u.role, joined: u.created_at.slice(0, 10) }));
    },
  },
  {
    label: "pending invitations",
    declaration: {
      name: "list_pending_invitations",
      description: "Invitations sent but not accepted yet, up to 25 (owners and admins only).",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase, member }) {
      if (member.role === "member") return NOT_VISIBLE("Invitations", member.role);
      const { data } = await supabase
        .from("invitations")
        .select("email, role, expires_at")
        .is("accepted_at", null)
        .order("created_at")
        .limit(25);
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
      if (member.role === "member") return NOT_VISIBLE("Billing", member.role);
      const { data } = await supabase
        .from("billing")
        .select("subscription_status, current_period_end, cancel_at_period_end")
        .maybeSingle();
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
    async run({ supabase }, args) {
      const status = typeof args.status === "string" && (args.status === "open" || args.status === "all" || args.status in STATUS_LABEL)
        ? args.status
        : "open";
      const { data } = await supabase.rpc("ai_list_leads", {
        p_tier: args.tier === "hot" || args.tier === "warm" || args.tier === "cold" ? args.tier : undefined,
        p_status: status as "open" | "all" | LeadStatus,
        p_mine: args.assigned_to_me === true,
        p_limit: Number(args.limit) || 10,
      });
      return (data ?? []).map((l) => ({
        name: l.name,
        company: l.company,
        score: l.score,
        tier: l.tier,
        status: l.status,
        source: l.source ? SOURCE_LABEL[l.source] : null,
        owner: l.owner_is_me ? "you" : (l.owner_name ?? "unassigned"),
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
        "The score breakdown for up to 3 leads matching a name or company: points per factor " +
        "(budget, company size, source, recency) out of the maximum, with the reason for each.",
      parametersJsonSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Part of the lead's name or company." } },
        required: ["query"],
      },
    },
    async run({ supabase }, args) {
      // PostgREST filter syntax is built from this string, so strip its operators.
      const q = String(args.query ?? "").replace(/[%_,().*"\\]/g, " ").trim().slice(0, 80);
      if (!q) return { error: "Say which lead." };
      // Notes are deliberately not returned: they aren't needed to explain a
      // score and are the easiest place to plant instructions for the model.
      const { data } = await supabase
        .from("leads_scored")
        .select("name, company, status, score, tier, breakdown")
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
        })),
      };
    },
  },
  {
    label: "pipeline summary",
    declaration: {
      name: "get_pipeline_summary",
      description: "Counts of leads by tier and status, average score of open leads, and unassigned open leads.",
      parametersJsonSchema: { type: "object", properties: {} },
    },
    async run({ supabase }) {
      const { data } = await supabase.rpc("ai_pipeline_summary").maybeSingle();
      return data ?? { total_leads: 0 };
    },
  },
  {
    label: "appointments",
    declaration: {
      name: "list_appointments",
      description:
        "The team's appointments in a date range (up to 50), soonest first, in the workspace timezone: time, who with, " +
        "status, whether it was booked online or by the team, and the linked lead. " +
        "Use for 'what's on my calendar this week?' or 'when am I meeting Priya?'.",
      parametersJsonSchema: {
        type: "object",
        properties: {
          range: {
            type: "string",
            enum: ["today", "this_week", "next_7_days", "next_30_days", "past_30_days"],
            description: "Which period to list. Default next_7_days.",
          },
          include_cancelled: { type: "boolean", description: "Also list cancelled appointments. Default false." },
          mine_only: { type: "boolean", description: "Only meetings the user booked or with leads assigned to them." },
        },
      },
    },
    async run({ supabase }, args) {
      const { data: settings } = await supabase.from("booking_settings").select("timezone").maybeSingle();
      const tz = settings?.timezone ?? "UTC";
      const day = 86_400_000;
      const now = Date.now();
      const startOfToday = zonedTimeToUtc(dayKey(new Date(now).toISOString(), tz), "00:00", tz)!.getTime();
      const range = typeof args.range === "string" ? args.range : "next_7_days";
      const [from, to] =
        range === "today" ? [startOfToday, startOfToday + day]
        : range === "this_week" ? [startOfToday, startOfToday + 7 * day]
        : range === "next_30_days" ? [now, now + 30 * day]
        : range === "past_30_days" ? [now - 30 * day, now]
        : [now, now + 7 * day];

      const { data } = await supabase.rpc("ai_list_appointments", {
        p_from: new Date(from).toISOString(),
        p_to: new Date(to).toISOString(),
        p_include_cancelled: args.include_cancelled === true,
        p_mine: args.mine_only === true,
      });
      const rows = (data ?? []).map((a) => ({
        when: `${formatDay(a.starts_at, tz, "short")}, ${formatRange(a.starts_at, a.ends_at, tz)}`,
        with: a.name,
        status: a.status,
        booked: a.source === "booking_page" ? "online" : "by the team",
        lead: a.lead_name,
      }));
      return { timezone: tz, range, count: rows.length, appointments: rows };
    },
  },
];

export const toolDeclarations = TOOLS.map((t) => t.declaration);

export function toolLabel(name: string) {
  return TOOLS.find((t) => t.declaration.name === name)?.label ?? name;
}

/** Runs one tool within its time budget; returns a sanitised, labelled result. */
export async function runTool(ctx: ToolContext, name: string, args: Record<string, unknown> = {}) {
  const tool = TOOLS.find((t) => t.declaration.name === name);
  if (!tool) return { error: `Unknown tool ${name}` };
  try {
    return sanitizeToolResult(await withTimeout(tool.run(ctx, args), BUDGET.toolTimeoutMs, `Tool ${name}`));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Tool failed" };
  }
}
