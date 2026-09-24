import type { Metadata } from "next";
import { Alert, Card, CardHeader, PageHeader, RoleBadge } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { ROLE_DESCRIPTION, describePermissions } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard · TenantFlow" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const member = await requireMember();
  const { denied } = await searchParams;

  // RLS scopes this to the caller's tenant; no tenant filter needed or trusted.
  const supabase = await createClient();
  const { data: team } = await supabase.from("users").select("role");
  const counts = { owner: 0, admin: 0, member: 0 };
  team?.forEach((u) => counts[u.role]++);

  const firstName = member.fullName?.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        description={`You're working in ${member.tenant.name}.`}
      />

      {denied && (
        <div className="mb-6">
          <Alert>Your role doesn&apos;t have access to that page.</Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Team members" value={team?.length ?? 0} />
        <Stat label="Owners & admins" value={counts.owner + counts.admin} />
        <Stat label="Workspace" value={member.tenant.slug} mono />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Your access"
          description={
            <>
              You are {member.role === "admin" ? "an" : "a"} <RoleBadge role={member.role} /> here.{" "}
              {ROLE_DESCRIPTION[member.role]}
            </>
          }
        />
        <ul className="grid gap-x-8 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
          {describePermissions(member.role).map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className={`grid size-5 place-items-center rounded-full text-xs ${
                  p.allowed ? "bg-success/15 text-success" : "bg-zinc-500/10 text-muted"
                }`}
              >
                {p.allowed ? "✓" : "–"}
              </span>
              <span className={p.allowed ? "" : "text-muted"}>{p.label}</span>
              <span className="sr-only">{p.allowed ? "allowed" : "not allowed"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Stat({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 truncate text-2xl font-semibold ${mono ? "font-mono text-lg leading-8" : ""}`}>{value}</p>
    </Card>
  );
}
