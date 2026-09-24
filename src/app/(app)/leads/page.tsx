import type { Metadata } from "next";
import Link from "next/link";
import { ScoreBadge } from "./score-ui";
import { Card, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import {
  OPEN_STATUSES,
  SOURCE_LABEL,
  STATUS_LABEL,
  TIER_LABEL,
  asTier,
  formatEngaged,
  formatMoney,
  parseBreakdown,
  topReasons,
  type Tier,
} from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leads · TenantFlow" };

const TIERS: (Tier | "all")[] = ["all", "hot", "warm", "cold"];
const VIEWS = { open: "Open", won: "Won", lost: "Lost", all: "All" } as const;

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const me = await requireMember();
  const params = await searchParams;
  const tier = TIERS.includes(params.tier as Tier) ? (params.tier as Tier | "all") : "all";
  const view = (params.view as keyof typeof VIEWS) in VIEWS ? (params.view as keyof typeof VIEWS) : "open";
  const mine = params.mine === "1";

  // RLS scopes this to the caller's tenant; the view adds score and breakdown.
  const supabase = await createClient();
  let query = supabase
    .from("leads_scored")
    .select("id, name, company, source, status, budget_usd, company_size, last_engaged_at, owner_id, score, tier, breakdown")
    .order("score", { ascending: false })
    .order("last_engaged_at", { ascending: false, nullsFirst: false });
  if (tier !== "all") query = query.eq("tier", tier);
  if (view === "open") query = query.in("status", OPEN_STATUSES);
  else if (view !== "all") query = query.eq("status", view);
  if (mine) query = query.eq("owner_id", me.id);

  const [{ data: leads }, { data: team }] = await Promise.all([
    query,
    supabase.from("users").select("id, full_name, email"),
  ]);
  const nameOf = new Map((team ?? []).map((u) => [u.id, u.full_name ?? u.email]));

  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams({ tier, view, ...(mine ? { mine: "1" } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    if (next.get("tier") === "all") next.delete("tier");
    if (next.get("view") === "open") next.delete("view");
    const qs = next.toString();
    return qs ? `/leads?${qs}` : "/leads";
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Leads"
          description="Ranked by score. Open any lead to see exactly why it scored what it did."
        />
        <Link
          href="/leads/new"
          className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Add lead
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <FilterGroup label="Tier">
          {TIERS.map((t) => (
            <Chip key={t} href={href({ tier: t })} active={tier === t}>
              {t === "all" ? "All tiers" : TIER_LABEL[t]}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Status">
          {Object.entries(VIEWS).map(([v, label]) => (
            <Chip key={v} href={href({ view: v })} active={view === v}>{label}</Chip>
          ))}
        </FilterGroup>
        <Chip href={href({ mine: mine ? null : "1" })} active={mine}>Assigned to me</Chip>
      </div>

      <Card className="overflow-hidden">
        {leads?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Lead</th>
                  <th className="px-4 py-2.5 font-medium">Score</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Why</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Source</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Budget</th>
                  <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Last engaged</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Owner</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-background">
                    <td className="px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="font-medium hover:text-accent">
                        {lead.name}
                      </Link>
                      {lead.company && <p className="text-xs text-muted">{lead.company}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBadge score={lead.score ?? 0} tier={asTier(lead.tier)} />
                    </td>
                    <td className="hidden max-w-60 px-4 py-3 text-xs text-muted md:table-cell">
                      {topReasons(parseBreakdown(lead.breakdown)).join(" · ") || "—"}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{lead.source ? SOURCE_LABEL[lead.source] : "—"}</td>
                    <td className="hidden px-4 py-3 tabular-nums lg:table-cell">{formatMoney(lead.budget_usd)}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">{formatEngaged(lead.last_engaged_at)}</td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      {lead.owner_id ? (lead.owner_id === me.id ? "You" : nameOf.get(lead.owner_id)) : "—"}
                    </td>
                    <td className="px-4 py-3">{lead.status ? STATUS_LABEL[lead.status] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-muted">
            No leads match these filters.{" "}
            <Link href="/leads/new" className="font-medium text-accent hover:underline">Add one</Link>
          </p>
        )}
      </Card>
    </>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
      {children}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded-md px-2.5 py-1 transition ${active ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"}`}
    >
      {children}
    </Link>
  );
}
