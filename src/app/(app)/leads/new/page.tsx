import type { Metadata } from "next";
import Link from "next/link";
import { LeadForm } from "../lead-form";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add lead · TenantFlow" };

export default async function NewLeadPage() {
  const me = await requireMember();
  const supabase = await createClient();
  const { data: team } = me.role === "member" ? { data: null } : await supabase.from("users").select("id, full_name, email");

  return (
    <>
      <Link href="/leads" className="text-sm text-muted hover:text-foreground">← Leads</Link>
      <PageHeader title="Add a lead" description="The score is calculated as soon as you save." />
      <Card>
        <CardHeader
          title="Lead details"
          description={me.role === "member" ? "New leads you add are assigned to you." : undefined}
        />
        <LeadForm
          lead={{ owner_id: me.id }}
          assignees={team ? team.map((u) => ({ id: u.id, name: u.full_name ?? u.email })) : null}
        />
      </Card>
    </>
  );
}
