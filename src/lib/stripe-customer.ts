// Idempotent "one Stripe customer per tenant". Pure orchestration over two
// small interfaces, so concurrency behaviour is unit-tested with fakes
// (stripe-customer.test.ts); billing.ts wires in the real Stripe SDK and the
// database.
//
// Race: two upgrade clicks arrive before the tenant has a customer. Both see
// "none" and both create one. Defences, in order:
//   1. Stripe idempotency key per tenant: concurrent creates within Stripe's
//      24h idempotency window return the SAME customer.
//   2. Conditional database write: the id is stored only if the row still has
//      no customer (billing.stripe_customer_id is also UNIQUE). Exactly one
//      writer wins; everyone else reads the winner.
//   3. If a different customer was created anyway (e.g. after the idempotency
//      window), the loser is deleted in Stripe so no orphan is left behind.

export type CustomerStore = {
  /** The tenant's recorded customer id, if any. */
  get(tenantId: string): Promise<string | null>;
  /** Records `customerId` only if none is recorded; returns the id now on record. */
  claim(tenantId: string, customerId: string): Promise<string>;
};

export type CustomerApi = {
  create(input: { tenantId: string; name: string; email: string }, idempotencyKey: string): Promise<string>;
  remove(customerId: string): Promise<void>;
};

export function customerIdempotencyKey(tenantId: string) {
  return `tenantflow:customer:${tenantId}`;
}

export async function getOrCreateCustomerId(
  tenant: { id: string; name: string },
  email: string,
  store: CustomerStore,
  api: CustomerApi,
): Promise<string> {
  const existing = await store.get(tenant.id);
  if (existing) return existing;

  const created = await api.create({ tenantId: tenant.id, name: tenant.name, email }, customerIdempotencyKey(tenant.id));
  const winner = await store.claim(tenant.id, created);
  if (winner !== created) {
    // Someone else recorded a different customer first; ours is an orphan.
    await api.remove(created).catch(() => {});
  }
  return winner;
}
