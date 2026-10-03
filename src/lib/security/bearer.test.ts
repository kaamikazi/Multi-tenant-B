import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerMatches } from "./bearer.ts";

const secret = "s".repeat(40);

test("only the exact secret is accepted", () => {
  assert.equal(bearerMatches(`Bearer ${secret}`, secret), true);
  assert.equal(bearerMatches(`Bearer ${secret}x`, secret), false);
  assert.equal(bearerMatches(`Bearer ${secret.slice(1)}`, secret), false);
  assert.equal(bearerMatches(secret, secret), false, "scheme is required");
  assert.equal(bearerMatches(null, secret), false);
});

test("an unset or weak secret disables the endpoint", () => {
  assert.equal(bearerMatches("Bearer ", undefined), false);
  assert.equal(bearerMatches("Bearer ", ""), false);
  assert.equal(bearerMatches("Bearer short", "short"), false);
});
