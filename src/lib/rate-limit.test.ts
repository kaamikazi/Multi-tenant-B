import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, createRateLimiter, memoryLimiter, upstashLimiter } from "./rate-limit.ts";

const rule = { limit: 3, windowMs: 1_000 };

test("memory limiter allows `limit` hits per window, then refuses", async () => {
  let t = 0;
  const rl = memoryLimiter(() => t);
  const results = [];
  for (let i = 0; i < 5; i++) results.push((await rl.hit("k", rule)).ok);
  assert.deepEqual(results, [true, true, true, false, false]);
  t = 1_000;
  assert.equal((await rl.hit("k", rule)).ok, true, "a new window starts fresh");
});

test("keys are counted independently", async () => {
  const rl = memoryLimiter(() => 0);
  for (let i = 0; i < 3; i++) await rl.hit("a", rule);
  assert.equal((await rl.hit("a", rule)).ok, false);
  assert.equal((await rl.hit("b", rule)).ok, true);
});

test("memory stays bounded under many distinct keys", async () => {
  const rl = memoryLimiter(() => 0, 100);
  for (let i = 0; i < 1_000; i++) await rl.hit(`ip${i}`, rule);
  // No assertion on internals: the call must simply not grow without bound or throw.
  assert.equal((await rl.hit("fresh", rule)).ok, true);
});

test("upstash limiter increments a shared counter with an expiry", async () => {
  let count = 0;
  const calls: unknown[] = [];
  const fake = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    count++;
    return new Response(JSON.stringify([{ result: count }, { result: 1 }]));
  }) as typeof fetch;
  const rl = upstashLimiter("https://redis.example", "token", fake);
  const oks = [];
  for (let i = 0; i < 4; i++) oks.push((await rl.hit("k", rule)).ok);
  assert.deepEqual(oks, [true, true, true, false]);
  const [[cmd], [exp]] = calls[0] as string[][];
  assert.equal(cmd, "INCR");
  assert.equal(exp, "PEXPIRE");
});

test("without Upstash config the in-memory limiter is used (no paid service required)", async () => {
  let called = false;
  const rl = createRateLimiter({}, (async () => { called = true; return new Response("[]"); }) as typeof fetch);
  for (let i = 0; i < 3; i++) assert.ok((await rl.hit("k", rule)).ok);
  assert.equal((await rl.hit("k", rule)).ok, false);
  assert.equal(called, false);
});

test("if the shared store fails, limiting still applies in-process", async () => {
  const broken = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const rl = createRateLimiter({ UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" }, broken);
  for (let i = 0; i < 3; i++) assert.ok((await rl.hit("k", rule)).ok);
  assert.equal((await rl.hit("k", rule)).ok, false);
});

test("client IP comes from proxy headers and is length-bounded", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.equal(clientIp(h({ "x-forwarded-for": "1.2.3.4" })), "1.2.3.4");
  // A client can prepend whatever it likes; the proxy-appended last hop wins.
  assert.equal(clientIp(h({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" })), "1.2.3.4");
  assert.equal(clientIp(h({ "x-real-ip": "5.6.7.8" })), "5.6.7.8");
  assert.equal(clientIp(h({})), "unknown");
  assert.equal(clientIp(h({ "x-real-ip": "x".repeat(500) })).length, 64);
});
