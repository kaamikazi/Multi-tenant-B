import type { Metadata } from "next";
import Link from "next/link";
import { acceptInvitation, signOut } from "../../actions";
import { SignupForm } from "../../auth-forms";
import { Alert, Button, Card } from "@/components/ui";
import { getAuthUser, getMember } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Invitation · TenantFlow" };

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: invite } = await supabase.rpc("get_invitation", { p_token: token }).maybeSingle();

  if (!invite || invite.status !== "valid") {
    const reason =
      invite?.status === "accepted"
        ? "This invitation has already been used."
        : invite?.status === "expired"
          ? "This invitation has expired."
          : invite?.status === "no_seats"
            ? "This workspace has no free seats on its current plan right now."
            : "This invitation link isn't valid.";
    return (
      <Card className="p-6">
        <h1 className="text-xl font-semibold">Invitation unavailable</h1>
        <p className="mt-2 text-sm text-muted">{reason} Ask a workspace admin to send you a new one.</p>
      </Card>
    );
  }

  const authUser = await getAuthUser();

  if (!authUser) {
    return (
      <SignupForm
        invite={{ token, email: invite.email, tenantName: invite.tenant_name, roleLabel: ROLE_LABEL[invite.role] }}
      />
    );
  }

  const member = await getMember();
  const wrongAccount = authUser.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <Card className="grid gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Join {invite.tenant_name}</h1>
        <p className="mt-1 text-sm text-muted">
          Invitation for {invite.email} as {ROLE_LABEL[invite.role].toLowerCase()}.
        </p>
      </div>

      {typeof error === "string" && <Alert>{error}</Alert>}

      {member ? (
        <>
          <Alert tone="info">
            You&apos;re signed in as {authUser.email}, which already belongs to{" "}
            <strong>{member.tenant.name}</strong>. Each account belongs to one workspace.
          </Alert>
          <Link href="/dashboard" className="text-sm font-medium text-accent hover:underline">
            Go to your dashboard
          </Link>
        </>
      ) : wrongAccount ? (
        <>
          <Alert tone="info">
            You&apos;re signed in as {authUser.email}. Sign out, then open this link again as {invite.email}.
          </Alert>
          <form action={signOut}>
            <Button variant="secondary" type="submit">Sign out</Button>
          </form>
        </>
      ) : (
        <form action={acceptInvitation}>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" className="w-full">Accept invitation</Button>
        </form>
      )}
    </Card>
  );
}
