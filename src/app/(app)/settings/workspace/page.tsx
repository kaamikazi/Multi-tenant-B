import type { Metadata } from "next";
import { setAiEnabled } from "./actions";
import { RenameForm } from "./rename-form";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const metadata: Metadata = { title: "Workspace · TenantFlow" };

export default async function WorkspacePage() {
  const member = await requireMember();
  const owner = can(member.role, "workspace:rename");

  return (
    <>
      <PageHeader title="Workspace" description="Settings shared by everyone in this workspace." />
      <div className="grid max-w-3xl gap-6">
        <Card>
          <CardHeader title="General" description={<>Workspace ID <code className="font-mono">{member.tenant.slug}</code></>} />
          <RenameForm name={member.tenant.name} editable={owner} />
        </Card>

        <Card>
          <CardHeader
            title="AI assistant"
            description="When on, questions and the workspace data needed to answer them (team, leads, meetings, plan) are sent to Google Gemini for processing."
          />
          <form action={setAiEnabled} className="grid gap-3 px-5 py-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="ai_enabled"
                defaultChecked={member.tenant.aiEnabled}
                disabled={!owner}
                className="size-4 accent-[var(--accent)]"
              />
              Allow the AI assistant in this workspace
            </label>
            {owner ? (
              <div><Button type="submit" variant="secondary">Save</Button></div>
            ) : (
              <p className="text-xs text-muted">Only the owner can change this.</p>
            )}
          </form>
        </Card>
      </div>
    </>
  );
}
