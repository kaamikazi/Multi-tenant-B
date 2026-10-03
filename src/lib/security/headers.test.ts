import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, createNonce, isSecretLinkPath, SECRET_LINK_HEADERS, staticSecurityHeaders } from "./headers.ts";

const directives = (csp: string) =>
  Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

const prod = directives(buildCsp({ nonce: "abc", isDev: false, https: true, turnstile: false }));

test("scripts need this request's nonce; no inline or eval in production", () => {
  assert.deepEqual(prod["script-src"], ["'self'", "'nonce-abc'", "'strict-dynamic'"]);
});

test("the browser can only fetch same-origin resources (no exfiltration via images, fetch or fonts)", () => {
  assert.deepEqual(prod["img-src"], ["'self'", "data:", "blob:"]);
  assert.deepEqual(prod["connect-src"], ["'self'"]);
  assert.deepEqual(prod["font-src"], ["'self'"]);
  assert.deepEqual(prod["default-src"], ["'self'"]);
  for (const list of Object.values(prod)) {
    for (const source of list) assert.ok(source !== "*" && source !== "https:" && source !== "http:", `wildcard source ${source}`);
  }
});

test("no framing, plugins or base-tag hijacking", () => {
  assert.deepEqual(prod["frame-ancestors"], ["'none'"]);
  assert.deepEqual(prod["frame-src"], ["'none'"]);
  assert.deepEqual(prod["object-src"], ["'none'"]);
  assert.deepEqual(prod["base-uri"], ["'self'"]);
});

test("forms may only post to the app and hand off to Stripe", () => {
  assert.deepEqual(prod["form-action"], ["'self'", "https://checkout.stripe.com", "https://billing.stripe.com"]);
});

test("development adds unsafe-eval (React debugging) and no upgrade-insecure-requests", () => {
  const dev = directives(buildCsp({ nonce: "n", isDev: true, https: false, turnstile: false }));
  assert.ok(dev["script-src"].includes("'unsafe-eval'"));
  assert.equal(dev["upgrade-insecure-requests"], undefined);
  assert.ok("upgrade-insecure-requests" in prod);
});

test("Turnstile origin is allowed only when Turnstile is configured", () => {
  const t = directives(buildCsp({ nonce: "n", isDev: false, https: true, turnstile: true }));
  assert.ok(t["script-src"].includes("https://challenges.cloudflare.com"));
  assert.deepEqual(t["frame-src"], ["https://challenges.cloudflare.com"]);
  assert.ok(!prod["script-src"].includes("https://challenges.cloudflare.com"));
});

test("nonces are unique and long enough", () => {
  const a = createNonce();
  assert.notEqual(a, createNonce());
  assert.ok(atob(a).length >= 16);
});

test("static headers cover sniffing, framing, referrer and powerful features; HSTS only in production", () => {
  const get = (isProd: boolean) => Object.fromEntries(staticSecurityHeaders(isProd).map((h) => [h.key, h.value]));
  const p = get(true);
  assert.equal(p["X-Content-Type-Options"], "nosniff");
  assert.equal(p["X-Frame-Options"], "DENY");
  assert.equal(p["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.match(p["Permissions-Policy"], /camera=\(\)/);
  assert.match(p["Strict-Transport-Security"], /max-age=\d+/);
  assert.equal(get(false)["Strict-Transport-Security"], undefined);
});

test("secret-link pages are recognised and get no-referrer / no-store / noindex", () => {
  assert.ok(isSecretLinkPath("/invite/abc123"));
  assert.ok(isSecretLinkPath("/book/manage/tok"));
  assert.ok(!isSecretLinkPath("/book/acme"));
  assert.ok(!isSecretLinkPath("/invite"));
  assert.ok(!isSecretLinkPath("/dashboard"));
  assert.equal(SECRET_LINK_HEADERS["Referrer-Policy"], "no-referrer");
  assert.match(SECRET_LINK_HEADERS["Cache-Control"], /no-store/);
});
