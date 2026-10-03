// Maps Stripe subscription state to TenantFlow entitlement. The ONLY place
// that decides whether Stripe data grants Pro. Pure (no Stripe SDK, no
// database), so every rule is unit-tested in stripe-entitlement.test.ts.
//
// Rules (fail closed: anything unrecognised means Free):
//   * The subscription must contain a TenantFlow Pro price. Other products on
//     the same Stripe account never grant Pro.
//   * Its metadata.tenant_id must equal the workspace that owns the Stripe
//     customer in our database. Missing or different -> not ours -> Free.
//   * Status:
//       active     -> Pro   (paid and current)
//       trialing   -> Pro   (a trial Stripe started; TenantFlow's checkout
//                            doesn't offer trials, but if one is configured in
//                            Stripe it's intended access)
//       past_due   -> Pro   (grace period: Stripe is retrying the payment and
//                            will move the subscription to unpaid or canceled
//                            per the account's retry settings; access ends
//                            then, not at the first failed attempt)
//       unpaid, canceled, incomplete, incomplete_expired, paused -> Free

export type StripeStatus =
  | "active" | "trialing" | "past_due" | "unpaid" | "canceled"
  | "incomplete" | "incomplete_expired" | "paused";

export type SubscriptionLike = {
  id: string;
  status: StripeStatus | string;
  metadata: Record<string, string | undefined> | null;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  items: {
    data: Array<{
      price: { id: string; lookup_key?: string | null } | null;
      current_period_end?: number | null;
    }>;
  };
};

export type ProPrice = { ids: readonly string[]; lookupKey: string };

export type Decision = {
  plan: "pro" | "free";
  reason: string;
  /** The subscription's Pro item's period end, when it grants Pro. */
  periodEnd: number | null;
  /** True when the subscription is a TenantFlow Pro subscription for this tenant at all. */
  isTenantFlowPro: boolean;
};

const GRANTING = new Set<string>(["active", "trialing", "past_due"]);

export function isProItem(item: SubscriptionLike["items"]["data"][number], pro: ProPrice) {
  const price = item.price;
  if (!price) return false;
  return pro.ids.includes(price.id) || (price.lookup_key != null && price.lookup_key === pro.lookupKey);
}

/** Entitlement granted by one subscription to `tenantId`. */
export function entitlementFor(sub: SubscriptionLike, tenantId: string, pro: ProPrice): Decision {
  const metaTenant = sub.metadata?.tenant_id;
  if (!metaTenant) return { plan: "free", reason: "subscription has no tenant_id metadata", periodEnd: null, isTenantFlowPro: false };
  if (metaTenant !== tenantId) return { plan: "free", reason: "subscription belongs to a different tenant", periodEnd: null, isTenantFlowPro: false };

  const proItem = sub.items.data.find((item) => isProItem(item, pro));
  if (!proItem) return { plan: "free", reason: "subscription is not for the TenantFlow Pro price", periodEnd: null, isTenantFlowPro: false };

  if (!GRANTING.has(sub.status)) {
    return { plan: "free", reason: `status ${sub.status} does not grant access`, periodEnd: proItem.current_period_end ?? null, isTenantFlowPro: true };
  }
  return { plan: "pro", reason: `status ${sub.status}`, periodEnd: proItem.current_period_end ?? null, isTenantFlowPro: true };
}

export type CustomerEntitlement = Decision & {
  /** The subscription the billing row should describe (granting one if any). */
  subscription: SubscriptionLike | null;
  /** More than one subscription grants Pro: a duplicate the owner may be paying twice for. */
  duplicateGrants: number;
};

/**
 * Entitlement across all of a customer's subscriptions. Pro if any TenantFlow
 * Pro subscription for this tenant grants it; otherwise Free, describing the
 * most recent TenantFlow subscription (so a cancelled one is still shown).
 */
export function entitlementForCustomer(subs: SubscriptionLike[], tenantId: string, pro: ProPrice): CustomerEntitlement {
  const decided = subs.map((sub) => ({ sub, decision: entitlementFor(sub, tenantId, pro) }));
  const granting = decided.filter((d) => d.decision.plan === "pro");
  if (granting.length) {
    // Prefer the one paid furthest ahead.
    granting.sort((a, b) => (b.decision.periodEnd ?? 0) - (a.decision.periodEnd ?? 0));
    return { ...granting[0].decision, subscription: granting[0].sub, duplicateGrants: granting.length - 1 };
  }
  const ours = decided.find((d) => d.decision.isTenantFlowPro);
  if (ours) return { ...ours.decision, subscription: ours.sub, duplicateGrants: 0 };
  return { plan: "free", reason: "no TenantFlow Pro subscription", periodEnd: null, isTenantFlowPro: false, subscription: null, duplicateGrants: 0 };
}
