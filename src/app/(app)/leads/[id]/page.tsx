import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteLead, logEngagement } from "../actions";
import { LeadForm } from "../lead-form";
import { ScoreBadge, ScoreBreakdown } from "../score-ui";
import { Alert, Button, Card, CardHeader } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import {
  SOURCE_LABEL,
  STATUS_LABEL,
  asTier,
  canDeleteLead,
  canEditLead,
  formatEngaged,
  formatMoney,
  parseBreakdown,
} from "@/lib/leads";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Lead · TenantFlow" };

export default async function LeadPage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const me = await requireMember();
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  // RLS: a lead from another tenant is simply not found.
  const { data: lead } = await supabase.from("leads_scored").select("*").eq("id", id).maybeSingle();
  if (!lead?.id || !lead.name) notFound();

  const { data: team } = await supabase.from("users").select("id, full_name, email");
  const assignees = (team ?? []).map((u) => ({ id: u.id, name: u.full_name ?? u.email }));
  const ownerName = assignees.find((a) => a.id === lead.owner_id)?.name;
  const editable = canEditLead(me.role, me.id, lead.owner_id);
  const tier = asTier(lead.tier);

  return (
    <>
      <Link href="/leads" className="text-sm text-muted hover:text-foreground">← Leads</Link>

      <header className="mt-2 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{lead.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[lead.company, lead.email].filter(Boolean).join(" · ") || "No company or email yet"}
          </p>
        </div>
        <ScoreBadge score={lead.score ?? 0} tier={tier} />
      </header>

      {error === "delete" && (
        <div className="mb-6"><Alert>Only owners and admins can delete leads.</Alert></div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader
              title={`Score: ${lead.score} / 100`}
              description="Hot is 70 or more, warm 40–69, cold below 40."
            />
            <div className="px-5 py-4">
              <ScoreBreakdown breakdown={parseBreakdown(lead.breakdown)} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title={editable ? "Edit lead" : "Details"}
              description={editable ? undefined : "Members can only edit leads assigned to them."}
            />
            {editable ? (
              <LeadForm
                lead={{
                  id: lead.id,
                  name: lead.name,
                  email: lead.email,
                  company: lead.company,
                  company_size: lead.company_size,
                  budget_usd: lead.budget_usd,
                  source: lead.source ?? "other",
                  status: lead.status ?? "new",
                  owner_id: lead.owner_id,
                  notes: lead.notes,
                }}
                assignees={me.role === "member" ? null : assignees}
              />
            ) : (
              <dl className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-2">
                <Detail label="Source" value={lead.source ? SOURCE_LABEL[lead.source] : "—"} />
                <Detail label="Status" value={lead.status ? STATUS_LABEL[lead.status] : "—"} />
                <Detail label="Budget" value={formatMoney(lead.budget_usd)} />
                <Detail label="Company size" value={lead.company_size?.toLocaleString("en-US") ?? "—"} />
                <div className="sm:col-span-2"><Detail label="Notes" value={lead.notes ?? "—"} /></div>
              </dl>
            )}
          </Card>
        </div>

        <aside className="grid content-start gap-4">
          <Card className="grid gap-3 p-5 text-sm">
            <Detail label="Assigned to" value={lead.owner_id === me.id ? "You" : (ownerName ?? "Unassigned")} />
            <Detail label="Last engaged" value={formatEngaged(lead.last_engaged_at)} />
            <Detail label="Status" value={lead.status ? STATUS_LABEL[lead.status] : "—"} />
            {editable && (
              <form action={logEngagement}>
                <input type="hidden" name="id" value={lead.id} />
                <Button type="submit" variant="secondary" className="w-full">Log engagement now</Button>
              </form>
            )}
          </Card>
          {canDeleteLead(me.role) && (
            <form action={deleteLead}>
              <input type="hidden" name="id" value={lead.id} />
              <Button type="submit" variant="danger" className="w-full">Delete lead</Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{value}</dd>
    </div>
  );
}
