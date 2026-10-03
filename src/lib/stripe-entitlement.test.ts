import { test } from "node:test";
import assert from "node:assert/strict";
import { entitlementFor, entitlementForCustomer, type SubscriptionLike } from "./stripe-entitlement.ts";

const PRO = { ids: ["price_pro"], lookupKey: "tenantflow_pro_monthly" };
const T = "tenant-1";

function sub(over: Partial<SubscriptionLike> & { price?: string | null; lookup?: string | null; end?: number } = {}): SubscriptionLike {
  const { price = "price_pro", lookup = null, end = 2_000_000_000, ...rest } = over;
  return {
    id: "sub_1",
    status: "active",
    metadata: { tenant_id: T },
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [{ price: price === null ? null : { id: price, lookup_key: lookup }, current_period_end: end }] },
    ...rest,
  };
}

test("an active TenantFlow Pro subscription grants Pro", () => {
  const d = entitlementFor(sub(), T, PRO);
  assert.equal(d.plan, "pro");
  assert.equal(d.periodEnd, 2_000_000_000);
});

test("the Pro price is also recognised by its lookup key", () => {
  assert.equal(entitlementFor(sub({ price: "price_rotated", lookup: "tenantflow_pro_monthly" }), T, PRO).plan, "pro");
});

test("an unrelated active subscription never grants Pro", () => {
  const d = entitlementFor(sub({ price: "price_other_product" }), T, PRO);
  assert.equal(d.plan, "free");
  assert.equal(d.isTenantFlowPro, false);
});

test("an unknown or missing price fails closed", () => {
  assert.equal(entitlementFor(sub({ price: "price_unknown", lookup: "someone_elses_key" }), T, PRO).plan, "free");
  assert.equal(entitlementFor(sub({ price: null }), T, PRO).plan, "free");
  assert.equal(entitlementFor(sub({ items: { data: [] } }), T, PRO).plan, "free");
});

test("missing or wrong tenant metadata fails closed", () => {
  assert.match(entitlementFor(sub({ metadata: {} }), T, PRO).reason, /no tenant_id/);
  assert.match(entitlementFor(sub({ metadata: null }), T, PRO).reason, /no tenant_id/);
  const wrong = entitlementFor(sub({ metadata: { tenant_id: "tenant-2" } }), T, PRO);
  assert.equal(wrong.plan, "free");
  assert.match(wrong.reason, /different tenant/);
});

test("status policy: active/trialing/past_due grant, everything else doesn't", () => {
  const plan = (status: string) => entitlementFor(sub({ status }), T, PRO).plan;
  assert.equal(plan("active"), "pro");
  assert.equal(plan("trialing"), "pro");
  assert.equal(plan("past_due"), "pro");
  for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", "something_new"]) assert.equal(plan(s), "free", s);
});

test("a cancelled Pro subscription is still recognised as ours (for display) but grants Free", () => {
  const d = entitlementFor(sub({ status: "canceled" }), T, PRO);
  assert.equal(d.plan, "free");
  assert.equal(d.isTenantFlowPro, true);
});

test("multiple items: Pro if any item is the Pro price", () => {
  const s = sub({ items: { data: [{ price: { id: "price_addon" }, current_period_end: 5 }, { price: { id: "price_pro" }, current_period_end: 99 }] } });
  const d = entitlementFor(s, T, PRO);
  assert.equal(d.plan, "pro");
  assert.equal(d.periodEnd, 99);
});

test("customer view: an unrelated subscription event can't downgrade a paying tenant", () => {
  const paid = sub({ id: "sub_pro" });
  const unrelatedCancelled = sub({ id: "sub_other", status: "canceled", price: "price_other_product" });
  const d = entitlementForCustomer([unrelatedCancelled, paid], T, PRO);
  assert.equal(d.plan, "pro");
  assert.equal(d.subscription?.id, "sub_pro");
});

test("customer view: duplicate paying subscriptions are reported", () => {
  const d = entitlementForCustomer([sub({ id: "a", end: 10 }), sub({ id: "b", end: 20 })], T, PRO);
  assert.equal(d.plan, "pro");
  assert.equal(d.subscription?.id, "b", "the one paid furthest ahead describes the billing row");
  assert.equal(d.duplicateGrants, 1);
});

test("customer view: no subscriptions, or only foreign ones, means Free", () => {
  assert.equal(entitlementForCustomer([], T, PRO).plan, "free");
  const foreign = entitlementForCustomer([sub({ metadata: { tenant_id: "tenant-2" } })], T, PRO);
  assert.equal(foreign.plan, "free");
  assert.equal(foreign.subscription, null);
});
