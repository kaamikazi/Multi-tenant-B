import type { Metadata } from "next";
import { revokeInvitation } from "./actions";
import { InviteForm, MemberControls } from "./team-controls";
import { CopyLinkButton } from "@/components/copy-link-button";
import { Alert, Button, Card, CardHeader, PageHeader, RoleBadge } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { absoluteUrl } from "@/lib/security/urls";
import { can, canRemove, canRevokeInvite, invitableRoles, type Role } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team · TenantFlow" };

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, member: 2 };

export default async function TeamPage() {
  const me = await requireMember();
  const supabase = await createClient();

  const { data: users } = await supabase.from("users").select("id, email, full_name, role, created_at");
  const team = (users ?? []).sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.email.localeCompare(b.email),
  );

  const showInvites = can(me.role, "team:view_invitations");
  const { data: invitations } = showInvites
    ? await supabase
        .from("invitations")
        .select("id, email, role, token, expires_at")
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };

  const { data: seats } = showInvites ? await supabase.rpc("get_seat_usage").maybeSingle() : { data: null };


  return (
    <>
      <PageHeader
        title="Team"
        description={`${team.length} ${team.length === 1 ? "person" : "people"} in ${me.tenant.name}.`}
      />

      <div className="grid gap-6">
        {seats?.over_limit && (
          <Alert>
            This workspace has {seats.members} members but its plan includes {seats.seat_limit} seats. Nobody has been
            removed, but no one new can join until the plan is upgraded or seats are freed.
          </Alert>
        )}
        {showInvites && (
          <Card>
            <CardHeader title="Invite a teammate" description="They'll get a link to join this workspace." />
            <InviteForm
              roles={invitableRoles(me.role)}
              seats={seats ? { used: seats.used, limit: seats.seat_limit } : null}
            />
          </Card>
        )}

        <Card>
          <CardHeader title="Members" />
          <ul className="divide-y divide-line">
            {team.map((user) => {
              const isMe = user.id === me.id;
              const name = user.full_name ?? user.email;
              const controls = {
                canChangeRole: !isMe && user.role !== "owner" && can(me.role, "roles:change"),
                canRemove: !isMe && canRemove(me.role, user.role),
                canTransfer: !isMe && can(me.role, "ownership:transfer"),
              };
              return (
                <li key={user.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      <span className="truncate">{name}</span>
                      {isMe && <span className="text-xs font-normal text-muted">(you)</span>}
                    </p>
                    <p className="truncate text-sm text-muted">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {!controls.canChangeRole && <RoleBadge role={user.role} />}
                    {(controls.canChangeRole || controls.canRemove || controls.canTransfer) && (
                      <MemberControls userId={user.id} name={name} role={user.role} {...controls} />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        {showInvites && (
          <Card>
            <CardHeader
              title="Pending invitations"
              description="Links expire after 7 days. Anyone with the link can join as the invited email."
            />
            {invitations?.length ? (
              <ul className="divide-y divide-line">
                {invitations.map((invite) => {
                  const expired = new Date(invite.expires_at) < new Date();
                  return (
                    <li key={invite.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{invite.email}</p>
                        <p className="text-sm text-muted">
                          <RoleBadge role={invite.role} />{" "}
                          {expired ? (
                            <span className="text-danger">Expired</span>
                          ) : (
                            `Expires ${new Date(invite.expires_at).toLocaleDateString("en", { month: "short", day: "numeric" })}`
                          )}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {!expired && <CopyLinkButton url={absoluteUrl(`/invite/${invite.token}`)} />}
                        {canRevokeInvite(me.role, invite.role) && (
                          <form action={revokeInvitation}>
                            <input type="hidden" name="id" value={invite.id} />
                            <Button type="submit" variant="danger">Revoke</Button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">No pending invitations.</p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
