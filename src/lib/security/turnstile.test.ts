import { test } from "node:test";
import assert from "node:assert/strict";
import { captchaMode, verifyCaptcha } from "./turnstile.ts";

const on = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" };
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
const never = (async () => { throw new Error("must not call Cloudflare"); }) as typeof fetch;

test("with no keys the CAPTCHA is off and the demo works", async () => {
  assert.equal(captchaMode({}), "off");
  assert.deepEqual(await verifyCaptcha(null, "1.1.1.1", {}, never), { ok: true });
});

test("half-configured keys fail closed", async () => {
  assert.equal(captchaMode({ TURNSTILE_SECRET_KEY: "s" }), "misconfigured");
  assert.equal(captchaMode({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" }), "misconfigured");
  assert.deepEqual(await verifyCaptcha("tok", "ip", { TURNSTILE_SECRET_KEY: "s" }, never), { ok: false, reason: "misconfigured" });
});

test("a missing token is refused without calling Cloudflare", async () => {
  assert.deepEqual(await verifyCaptcha(null, "ip", on, never), { ok: false, reason: "missing" });
  assert.deepEqual(await verifyCaptcha("", "ip", on, never), { ok: false, reason: "missing" });
});

test("only an explicit success passes", async () => {
  assert.deepEqual(await verifyCaptcha("t", "ip", on, reply({ success: true })), { ok: true });
  assert.deepEqual(await verifyCaptcha("t", "ip", on, reply({ success: false })), { ok: false, reason: "failed" });
  assert.deepEqual(await verifyCaptcha("t", "ip", on, reply({ success: "true" })), { ok: false, reason: "failed" });
});

test("Cloudflare errors or outages fail closed", async () => {
  assert.deepEqual(await verifyCaptcha("t", "ip", on, reply({}, 500)), { ok: false, reason: "unavailable" });
  assert.deepEqual(await verifyCaptcha("t", "ip", on, never), { ok: false, reason: "unavailable" });
});

test("the secret is sent only to Cloudflare's verify endpoint", async () => {
  let seen: { url: string; body: string } | null = null;
  const spy = (async (url: string, init: RequestInit) => {
    seen = { url, body: String(init.body) };
    return new Response(JSON.stringify({ success: true }));
  }) as typeof fetch;
  await verifyCaptcha("tok", "9.9.9.9", on, spy);
  assert.equal(seen!.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.match(seen!.body, /secret=secret/);
  assert.match(seen!.body, /remoteip=9\.9\.9\.9/);
});
