import "server-only";

import Stripe from "stripe";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrCreateCustomerId, type CustomerApi, type CustomerStore } from "@/lib/stripe-customer";
import { entitlementForCustomer, type ProPrice, type SubscriptionLike } from "@/lib/stripe-entitlement";

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

// ---------------------------------------------------------------------------
// Which Stripe prices are "TenantFlow Pro"
// ---------------------------------------------------------------------------
let cachedPrices: { value: ProPrice; at: number } | null = null;

/**
 * The prices that grant Pro. STRIPE_PRO_PRICE_ID (comma-separated) pins them
 * explicitly; otherwise they're resolved by lookup key and cached briefly.
 * A subscription item also matches by lookup key, so a price rotated in
 * Stripe (same lookup key) keeps working.
 */
export async function proPrices(): Promise<ProPrice> {
  const pinned = (process.env.STRIPE_PRO_PRICE_ID ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (pinned.length) return { ids: pinned, lookupKey: PRO_PRICE_LOOKUP_KEY };
  if (cachedPrices && Date.now() - cachedPrices.at < 10 * 60_000) return cachedPrices.value;
  const list = stripe ? await stripe.prices.list({ lookup_keys: [PRO_PRICE_LOOKUP_KEY], active: true, limit: 10 }) : { data: [] };
  const value = { ids: list.data.map((p) => p.id), lookupKey: PRO_PRICE_LOOKUP_KEY };
  cachedPrices = { value, at: Date.now() };
  return value;
}

// ---------------------------------------------------------------------------
// One Stripe customer per tenant (idempotent, race-safe)
// ---------------------------------------------------------------------------
const customerStore: CustomerStore = {
  async get(tenantId) {
    const { data } = await createAdminClient().from("billing").select("stripe_customer_id").eq("tenant_id", tenantId).maybeSingle();
    return data?.stripe_customer_id ?? null;
  },
  async claim(tenantId, customerId) {
    const admin = createAdminClient();
    await admin.from("billing").upsert({ tenant_id: tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
    // Conditional write: only the first customer id recorded for a tenant sticks.
    await admin.from("billing").update({ stripe_customer_id: customerId }).eq("tenant_id", tenantId).is("stripe_customer_id", null);
    const { data, error } = await admin.from("billing").select("stripe_customer_id").eq("tenant_id", tenantId).single();
    // Fail closed: never assume our customer won without reading the winner back.
    if (error || !data?.stripe_customer_id) throw new Error("could not record the Stripe customer");
    return data.stripe_customer_id;
  },
};

function customerApi(client: Stripe): CustomerApi {
  return {
    async create({ tenantId, name, email }, idempotencyKey) {
      const customer = await client.customers.create({ name, email, metadata: { tenant_id: tenantId } }, { idempotencyKey });
      return customer.id;
    },
    async remove(customerId) {
      await client.customers.del(customerId);
    },
  };
}

export async function getOrCreateCustomer(tenant: { id: string; name: string }, email: string) {
  if (!stripe) throw new Error("Stripe is not configured");
  return getOrCreateCustomerId(tenant, email, customerStore, customerApi(stripe));
}

// ---------------------------------------------------------------------------
// Sync: Stripe is the source of truth
// ---------------------------------------------------------------------------
export type SyncResult =
  | { ok: true; tenantId: string; plan: Plan; previousPlan: Plan; reason: string; duplicateGrants: number }
  | { ok: false; reason: string };

/**
 * Re-reads every subscription of `customerId` from Stripe and writes the
 * resulting entitlement for the tenant that owns that customer in OUR
 * database. Used by the webhook, the checkout return and reconciliation, so
 * all three converge on the same answer; running it twice is harmless.
 */
export async function syncCustomer(customerId: string): Promise<SyncResult> {
  if (!stripe) return { ok: false, reason: "Stripe is not configured" };
  const admin = createAdminClient();

  // The tenant comes from our own record of who owns this customer, never
  // from subscription metadata alone.
  const { data: billing } = await admin.from("billing").select("tenant_id").eq("stripe_customer_id", customerId).maybeSingle();
  if (!billing) return { ok: false, reason: "customer is not linked to any workspace" };
  const { data: tenant } = await admin.from("tenants").select("plan").eq("id", billing.tenant_id).single();

  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
  const decision = entitlementForCustomer(subs.data as unknown as SubscriptionLike[], billing.tenant_id, await proPrices());
  const sub = decision.subscription;

  const { error: billingError } = await admin.from("billing").update({
    stripe_subscription_id: sub?.id ?? null,
    subscription_status: sub?.status ?? null,
    current_period_end: decision.periodEnd ? new Date(decision.periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub ? sub.cancel_at_period_end || sub.cancel_at !== null : false,
  }).eq("tenant_id", billing.tenant_id);
  if (billingError) throw billingError;

  const { error: planError } = await admin.from("tenants").update({ plan: decision.plan }).eq("id", billing.tenant_id);
  if (planError) throw planError;

  if (decision.duplicateGrants > 0) {
    console.warn(`billing: tenant ${billing.tenant_id} has ${decision.duplicateGrants + 1} paying Pro subscriptions`);
  }
  return {
    ok: true,
    tenantId: billing.tenant_id,
    plan: decision.plan,
    previousPlan: tenant?.plan ?? "free",
    reason: decision.reason,
    duplicateGrants: decision.duplicateGrants,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation: repairs drift if webhooks were lost
// ---------------------------------------------------------------------------
export type ReconcileReport = {
  checked: number;
  changed: { tenantId: string; from: Plan; to: Plan }[];
  duplicates: { tenantId: string; paying: number }[];
  errors: { tenantId: string; reason: string }[];
};

export async function reconcileBilling(): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, changed: [], duplicates: [], errors: [] };
  if (!stripe) return report;
  const admin = createAdminClient();

  for (let from = 0; ; from += 500) {
    const { data: rows, error } = await admin
      .from("billing")
      .select("tenant_id, stripe_customer_id")
      .not("stripe_customer_id", "is", null)
      .order("tenant_id")
      .range(from, from + 499);
    if (error) throw error;
    for (const row of rows ?? []) {
      report.checked++;
      try {
        const result = await syncCustomer(row.stripe_customer_id!);
        if (!result.ok) report.errors.push({ tenantId: row.tenant_id, reason: result.reason });
        else {
          if (result.plan !== result.previousPlan) report.changed.push({ tenantId: row.tenant_id, from: result.previousPlan, to: result.plan });
          if (result.duplicateGrants > 0) report.duplicates.push({ tenantId: row.tenant_id, paying: result.duplicateGrants + 1 });
        }
      } catch (e) {
        report.errors.push({ tenantId: row.tenant_id, reason: e instanceof Error ? e.message : "sync failed" });
      }
    }
    if (!rows || rows.length < 500) break;
  }
  return report;
}
