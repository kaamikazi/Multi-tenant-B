"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getOrCreateCustomer, proPrices, stripe, syncCustomer } from "@/lib/billing";
import { can } from "@/lib/rbac";
import { absoluteUrl } from "@/lib/security/urls";

// Stripe calls happen outside the database, so RLS cannot guard them: each
// action checks the role itself before touching Stripe. Redirect URLs use the
// configured canonical origin, never request headers.

async function requireBillingOwner() {
  const member = await requireMember();
  if (!can(member.role, "billing:manage")) redirect("/settings/billing?error=owner-only");
  if (!stripe) redirect("/settings/billing?error=not-configured");
  return { member, stripe };
}

export async function startCheckout() {
  const { member, stripe } = await requireBillingOwner();
  const customer = await getOrCreateCustomer(member.tenant, member.email);

  // Stripe is the source of truth: if a paying subscription already exists,
  // sync it instead of starting a second one.
  const current = await syncCustomer(customer);
  if (current.ok && current.plan === "pro") redirect("/settings/billing");

  const prices = await proPrices();
  if (!prices.ids.length) redirect("/settings/billing?error=no-price");

  let url: string;
  try {
    // Reuse an open checkout for this tenant rather than creating another.
    const open = await stripe.checkout.sessions.list({ customer, status: "open", limit: 10 });
    const reusable = open.data.find((s) => s.metadata?.tenant_id === member.tenant.id && s.url);
    if (reusable?.url) {
      url = reusable.url;
    } else {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          customer,
          line_items: [{ price: prices.ids[0], quantity: 1 }],
          client_reference_id: member.tenant.id,
          metadata: { tenant_id: member.tenant.id },
          subscription_data: { metadata: { tenant_id: member.tenant.id } },
          success_url: `${absoluteUrl("/api/stripe/checkout-return")}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: absoluteUrl("/settings/billing?checkout=cancelled"),
        },
        // Repeated clicks within 10 minutes return the same session.
        { idempotencyKey: `tenantflow:checkout:${member.tenant.id}:${Math.floor(Date.now() / 600_000)}` },
      );
      url = session.url!;
    }
  } catch (e) {
    console.error("Stripe checkout failed", e instanceof Error ? e.message : e);
    redirect("/settings/billing?error=checkout-failed");
  }
  redirect(url);
}

export async function openBillingPortal() {
  const { member, stripe } = await requireBillingOwner();
  const customer = await getOrCreateCustomer(member.tenant, member.email);

  let url: string;
  try {
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: absoluteUrl("/settings/billing") });
    url = session.url;
  } catch {
    // Most often: the test-mode portal has never been configured in Stripe.
    redirect("/settings/billing?error=portal");
  }
  redirect(url);
}
