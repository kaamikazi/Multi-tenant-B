import "server-only";

import Stripe from "stripe";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export type Plan = Database["public"]["Enums"]["plan"];

// Keep these limits in sync with private.seat_limit() and
// private.ai_message_limit() in the migrations, which enforce them.
export const PLANS: Record<Plan, { name: string; price: number; seats: number | null; features: string[] }> = {
  free: {
    name: "Free",
    price: 0,
    seats: 3,
    features: ["Up to 3 team seats", "25 AI assistant messages / month", "Owner, admin and member roles"],
  },
  pro: {
    name: "Pro",
    price: 29,
    seats: null,
    features: ["Unlimited team seats", "1,000 AI assistant messages / month", "Everything in Free"],
  },
};

/** Stripe price for Pro, found by lookup key. Created by `npm run stripe:setup`. */
export const PRO_PRICE_LOOKUP_KEY = "tenantflow_pro_monthly";

// Null when no key is configured: the app still runs, billing shows as a demo.
export const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

/** Stripe statuses that keep a workspace on Pro. */
const PAID_STATUSES: Stripe.Subscription.Status[] = ["active", "trialing", "past_due"];

/**
 * Copies a subscription's current state from Stripe into the database.
 *
 * Always re-reads the subscription from Stripe rather than trusting an
 * event payload, so duplicate or out-of-order webhooks converge on the
 * same result and are safe to process more than once.
 */
export async function syncSubscription(subscriptionId: string) {
  if (!stripe) throw new Error("Stripe is not configured");

  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const tenantId = sub.metadata.tenant_id;
  if (!tenantId) throw new Error(`Subscription ${sub.id} has no tenant_id metadata`);

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEnd = sub.items.data[0]?.current_period_end;
  const plan: Plan = PAID_STATUSES.includes(sub.status) ? "pro" : "free";

  const admin = createAdminClient();
  const { error: billingError } = await admin.from("billing").upsert({
    tenant_id: tenantId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end || sub.cancel_at !== null,
  });
  if (billingError) throw billingError;

  const { error: planError } = await admin.from("tenants").update({ plan }).eq("id", tenantId);
  if (planError) throw planError;

  return { tenantId, plan, status: sub.status };
}
