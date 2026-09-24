import type { Metadata } from "next";
import { openBillingPortal, startCheckout } from "./actions";
import { Alert, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { PLANS, stripe, type Plan } from "@/lib/billing";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Billing · TenantFlow" };

const ERRORS: Record<string, string> = {
  "owner-only": "Only the workspace owner can change the plan.",
  "not-configured": "Stripe isn't configured for this deployment yet.",
  "no-price": "The Pro price doesn't exist in Stripe yet. Run `npm run stripe:setup`.",
  portal: "Stripe's customer portal isn't set up. Save the portal settings once in the Stripe test dashboard.",
  checkout: "We couldn't confirm that checkout. If you were charged, it will appear here shortly.",
};

export default async function BillingPage({ searchParams }: PageProps<"/settings/billing">) {
  const member = await requireRole("owner", "admin");
  const { error, checkout } = await searchParams;
  const canManage = can(member.role, "billing:manage");
  const current = member.tenant.plan;

  const supabase = await createClient();
  const [{ data: billing }, { data: seats }] = await Promise.all([
    supabase
      .from("billing")
      .select("stripe_customer_id, subscription_status, current_period_end, cancel_at_period_end")
      .maybeSingle(),
    supabase.rpc("get_seat_usage").maybeSingle(),
  ]);

  const periodEnd = billing?.current_period_end
    ? new Date(billing.current_period_end).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <>
      <PageHeader title="Billing" description={`Plan and subscription for ${member.tenant.name}.`} />

      <div className="grid gap-6">
        {typeof error === "string" && ERRORS[error] && <Alert>{ERRORS[error]}</Alert>}
        {checkout === "success" && <Alert tone="success">You&apos;re on Pro. Thanks for upgrading!</Alert>}
        {checkout === "cancelled" && <Alert tone="info">Checkout cancelled. Nothing was charged.</Alert>}

        <Alert tone="info">
          {stripe
            ? "Demo: Stripe runs in test mode. Pay with card 4242 4242 4242 4242, any future date and any CVC."
            : "Demo: Stripe keys aren't configured, so upgrading is disabled. Plans and limits still apply."}
        </Alert>

        <Card>
          <CardHeader
            title={`Current plan: ${PLANS[current].name}`}
            description={
              current === "pro" && periodEnd
                ? billing?.cancel_at_period_end
                  ? `Cancels on ${periodEnd}. You keep Pro until then.`
                  : `Renews on ${periodEnd}.`
                : "Free forever. Upgrade any time."
            }
            action={
              canManage && stripe && billing?.stripe_customer_id && current === "pro" ? (
                <form action={openBillingPortal}>
                  <Button type="submit" variant="secondary">Manage billing</Button>
                </form>
              ) : null
            }
          />
          {seats && <SeatMeter used={seats.used} limit={seats.seat_limit} />}
          {billing?.subscription_status && billing.subscription_status !== "active" && (
            <p className="px-5 pb-4 text-sm text-muted">Stripe status: {billing.subscription_status}</p>
          )}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(PLANS) as Plan[]).map((key) => {
            const plan = PLANS[key];
            const isCurrent = key === current;
            return (
              <Card key={key} className={`flex flex-col p-5 ${isCurrent ? "ring-2 ring-accent" : ""}`}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-semibold">{plan.name}</h2>
                  {isCurrent && <span className="text-xs font-medium text-accent">Current plan</span>}
                </div>
                <p className="mt-2">
                  <span className="text-3xl font-semibold">${plan.price}</span>
                  <span className="text-sm text-muted"> / month</span>
                </p>
                <ul className="mt-4 grid gap-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span aria-hidden className="text-success">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-5">
                  {key === "pro" && !isCurrent && (
                    canManage ? (
                      <form action={startCheckout}>
                        <Button type="submit" className="w-full" disabled={!stripe}>Upgrade to Pro</Button>
                      </form>
                    ) : (
                      <p className="text-sm text-muted">Only the workspace owner can upgrade.</p>
                    )
                  )}
                  {key === "free" && current === "pro" && canManage && (
                    <p className="text-sm text-muted">To downgrade, cancel in Manage billing.</p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}

function SeatMeter({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="px-5 py-4">
      <div className="flex justify-between text-sm">
        <span className="font-medium">Team seats</span>
        <span className="text-muted">{limit ? `${used} of ${limit} used` : `${used} used · unlimited`}</span>
      </div>
      {limit && (
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-background"
          role="progressbar"
          aria-valuenow={used}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label="Team seats used"
        >
          <div className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-muted">Pending invitations count as seats until they expire.</p>
    </div>
  );
}
