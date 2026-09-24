"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { PRO_PRICE_LOOKUP_KEY, stripe } from "@/lib/billing";
import { can } from "@/lib/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Stripe calls happen outside the database, so RLS cannot guard them: each
// action checks the role itself before touching Stripe.

async function requireBillingOwner() {
  const member = await requireMember();
  if (!can(member.role, "billing:manage")) redirect("/settings/billing?error=owner-only");
  if (!stripe) redirect("/settings/billing?error=not-configured");
  return { member, stripe };
}

async function origin() {
  const h = await headers();
  return h.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** The tenant's Stripe customer, created on first use. */
async function getOrCreateCustomer(tenant: { id: string; name: string }, email: string) {
  const supabase = await createClient();
  const { data: billing } = await supabase
    .from("billing")
    .select("stripe_customer_id")
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (billing?.stripe_customer_id) return billing.stripe_customer_id;

  const customer = await stripe!.customers.create({
    name: tenant.name,
    email,
    metadata: { tenant_id: tenant.id },
  });
  const { error } = await createAdminClient()
    .from("billing")
    .upsert({ tenant_id: tenant.id, stripe_customer_id: customer.id });
  if (error) throw error;
  return customer.id;
}

export async function startCheckout() {
  const { member, stripe } = await requireBillingOwner();
  if (member.tenant.plan === "pro") redirect("/settings/billing");

  const prices = await stripe.prices.list({ lookup_keys: [PRO_PRICE_LOOKUP_KEY], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) redirect("/settings/billing?error=no-price");

  const customer = await getOrCreateCustomer(member.tenant, member.email);
  const base = await origin();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: price.id, quantity: 1 }],
    client_reference_id: member.tenant.id,
    subscription_data: { metadata: { tenant_id: member.tenant.id } },
    success_url: `${base}/api/stripe/checkout-return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/settings/billing?checkout=cancelled`,
  });

  redirect(session.url!);
}

export async function openBillingPortal() {
  const { member, stripe } = await requireBillingOwner();
  const customer = await getOrCreateCustomer(member.tenant, member.email);

  let url: string;
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${await origin()}/settings/billing`,
    });
    url = session.url;
  } catch {
    // Most often: the test-mode portal has never been configured in Stripe.
    redirect("/settings/billing?error=portal");
  }
  redirect(url);
}
