import { test } from "node:test";
import assert from "node:assert/strict";
import { seedRefusal } from "./seed-guard.mjs";

const base = { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "k" };

test("the seed refuses without the explicit opt-in", () => {
  assert.match(seedRefusal(base), /ALLOW_DESTRUCTIVE_DEMO_SEED=true/);
  assert.match(seedRefusal({ ...base, ALLOW_DESTRUCTIVE_DEMO_SEED: "1" }), /Refusing/);
  assert.match(seedRefusal({ ...base, ALLOW_DESTRUCTIVE_DEMO_SEED: "TRUE" }), /Refusing/);
});

test("the seed always refuses in production", () => {
  assert.match(seedRefusal({ ...base, ALLOW_DESTRUCTIVE_DEMO_SEED: "true", NODE_ENV: "production" }), /production/);
});

test("the seed runs only when opted in and configured", () => {
  assert.equal(seedRefusal({ ...base, ALLOW_DESTRUCTIVE_DEMO_SEED: "true" }), null);
  assert.match(seedRefusal({ ALLOW_DESTRUCTIVE_DEMO_SEED: "true" }), /SUPABASE_SECRET_KEY/);
});
