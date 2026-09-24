import type { Metadata } from "next";
import { RenameForm } from "./rename-form";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const metadata: Metadata = { title: "Workspace · TenantFlow" };

export default async function WorkspacePage() {
  const member = await requireMember();

  return (
    <>
      <PageHeader title="Workspace" description="Settings shared by everyone in this workspace." />
      <Card>
        <CardHeader title="General" description={<>Workspace ID <code className="font-mono">{member.tenant.slug}</code></>} />
        <RenameForm name={member.tenant.name} editable={can(member.role, "workspace:rename")} />
      </Card>
    </>
  );
}
