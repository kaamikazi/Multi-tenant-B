import { expect, test } from "@playwright/test";

// 5. Browser hardening as actually served by the production build.

test("the home page has a nonce-based CSP that matches its scripts, and can't be framed", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();

  const csp = headers["content-security-policy"];
  expect(csp).toBeTruthy();
  const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
  expect(scriptSrc).toBeDefined();
  const nonce = scriptSrc!.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  expect(nonce, "script-src carries a per-request nonce").toBeTruthy();
  expect(scriptSrc).toContain("'strict-dynamic'");
  expect(scriptSrc).not.toContain("'unsafe-inline'");
  expect(scriptSrc).not.toContain("'unsafe-eval'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");

  // Next.js puts the same nonce on the scripts it renders.
  const html = await response.text();
  expect(html).toContain(`nonce="${nonce}"`);

  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");

  // A fresh nonce per request.
  const again = await request.get("/");
  expect(again.headers()["content-security-policy"]).not.toContain(`'nonce-${nonce}'`);
});

test("invitation links are served no-referrer and no-store", async ({ request }) => {
  const response = await request.get(`/invite/e2e-not-a-real-token-${Date.now()}`);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(await response.text()).toContain("This invitation link isn");
});
