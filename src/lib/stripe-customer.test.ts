import { test } from "node:test";
import assert from "node:assert/strict";
import { customerIdempotencyKey, getOrCreateCustomerId, type CustomerApi, type CustomerStore } from "./stripe-customer.ts";

// A database fake with the same conditional-write semantics as the real
// "update billing set stripe_customer_id = $1 where tenant_id = $2 and stripe_customer_id is null".
function fakeStore(): CustomerStore & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    async get(t) {
      await tick();
      return rows.get(t) ?? null;
    },
    async claim(t, id) {
      await tick();
      if (!rows.has(t)) rows.set(t, id);
      return rows.get(t)!;
    },
  };
}

// A Stripe fake: honours idempotency keys unless told the window has passed.
function fakeStripe({ honourIdempotency = true } = {}): CustomerApi & { created: string[]; removed: string[] } {
  const byKey = new Map<string, string>();
  const created: string[] = [];
  const removed: string[] = [];
  let n = 0;
  return {
    created,
    removed,
    async create(_input, key) {
      await tick();
      if (honourIdempotency && byKey.has(key)) return byKey.get(key)!;
      const id = `cus_${++n}`;
      created.push(id);
      byKey.set(key, id);
      return id;
    },
    async remove(id) {
      removed.push(id);
    },
  };
}

const tick = () => new Promise((r) => setImmediate(r));
const tenant = { id: "t1", name: "Acme" };

test("an existing customer is reused without calling Stripe", async () => {
  const store = fakeStore();
  store.rows.set("t1", "cus_existing");
  const api = fakeStripe();
  assert.equal(await getOrCreateCustomerId(tenant, "o@acme.test", store, api), "cus_existing");
  assert.equal(api.created.length, 0);
});

test("ten concurrent upgrade clicks create exactly one customer", async () => {
  const store = fakeStore();
  const api = fakeStripe();
  const ids = await Promise.all(Array.from({ length: 10 }, () => getOrCreateCustomerId(tenant, "o@acme.test", store, api)));
  assert.equal(new Set(ids).size, 1);
  assert.equal(api.created.length, 1);
  assert.equal(api.removed.length, 0);
});

test("if Stripe returns different customers anyway, one wins and the orphans are deleted", async () => {
  const store = fakeStore();
  const api = fakeStripe({ honourIdempotency: false });
  const ids = await Promise.all(Array.from({ length: 5 }, () => getOrCreateCustomerId(tenant, "o@acme.test", store, api)));
  assert.equal(new Set(ids).size, 1, "every caller gets the recorded winner");
  assert.equal(api.created.length, 5);
  assert.deepEqual(new Set(api.removed), new Set(api.created.filter((id) => id !== ids[0])), "all losers are removed");
});

test("the idempotency key is stable per tenant and distinct across tenants", () => {
  assert.equal(customerIdempotencyKey("t1"), customerIdempotencyKey("t1"));
  assert.notEqual(customerIdempotencyKey("t1"), customerIdempotencyKey("t2"));
});
