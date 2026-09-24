import type { Metadata } from "next";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Billing · TenantFlow" };

export default async function BillingPage() {
  const member = await requireRole("owner", "admin");

  return (
    <>
      <PageHeader title="Billing" description={`Subscription for ${member.tenant.name}.`} />
      <Card>
        <CardHeader title="Plan" description="Only owners and admins can see this page." />
        <p className="px-5 py-4 text-sm text-muted">Stripe subscriptions arrive in the next phase.</p>
      </Card>
    </>
  );
}
