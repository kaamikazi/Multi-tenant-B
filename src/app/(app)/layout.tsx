import { signOut } from "../(auth)/actions";
import { NavLinks, type NavItem } from "./nav-links";
import { Logo } from "@/components/logo";
import { Button, RoleBadge } from "@/components/ui";
import { requireMember } from "@/lib/auth";
import { PLANS } from "@/lib/billing";
import { can } from "@/lib/rbac";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const member = await requireMember();

  // Links a role cannot use are not rendered at all. The pages themselves
  // also check the role, and the database checks it again.
  const nav: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/leads", label: "Leads" },
    { href: "/assistant", label: "Assistant" },
    { href: "/settings/team", label: "Team" },
    ...(can(member.role, "billing:view") ? [{ href: "/settings/billing", label: "Billing" }] : []),
    { href: "/settings/workspace", label: "Workspace" },
  ];

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b border-line bg-surface p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between md:block">
          <Logo href="/dashboard" />
          <form action={signOut} className="md:hidden">
            <Button variant="ghost" type="submit">Sign out</Button>
          </form>
        </div>

        <div className="rounded-lg border border-line px-3 py-2.5">
          <p className="truncate text-sm font-medium" title={member.tenant.name}>
            {member.tenant.name}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <RoleBadge role={member.role} />
            <span className="text-xs text-muted">{PLANS[member.tenant.plan].name} plan</span>
          </div>
        </div>

        <NavLinks items={nav} />

        <div className="mt-auto hidden border-t border-line pt-4 md:block">
          <p className="truncate text-sm font-medium">{member.fullName ?? member.email}</p>
          <p className="truncate text-xs text-muted">{member.email}</p>
          <form action={signOut} className="mt-3">
            <Button variant="secondary" type="submit" className="w-full">Sign out</Button>
          </form>
        </div>
      </aside>

      <main className="w-full max-w-5xl flex-1 px-4 py-8 md:px-10">{children}</main>
    </div>
  );
}
