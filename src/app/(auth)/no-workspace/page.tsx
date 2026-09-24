import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "../actions";
import { Button, Card } from "@/components/ui";
import { getAuthUser, getMember } from "@/lib/auth";

export const metadata: Metadata = { title: "No workspace · TenantFlow" };

// Reached by an account that exists but belongs to no tenant, e.g. someone
// who was removed from their team. They need a new invitation to get back in.
export default async function NoWorkspacePage() {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");
  if (await getMember()) redirect("/dashboard");

  return (
    <Card className="p-6">
      <h1 className="text-xl font-semibold">You&apos;re not in a workspace</h1>
      <p className="mt-2 text-sm text-muted">
        {authUser.email} isn&apos;t a member of any workspace right now. Ask a workspace admin to invite you, then
        open the link they send.
      </p>
      <form action={signOut} className="mt-6">
        <Button variant="secondary" type="submit" className="w-full">Sign out</Button>
      </form>
    </Card>
  );
}
