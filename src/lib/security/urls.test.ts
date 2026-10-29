import { test } from "node:test";
import assert from "node:assert/strict";
import { absoluteUrl, safeRelativePath, siteOrigin } from "./urls.ts";

const ORIGIN = "https://app.example.com";
const safe = (input: unknown) => safeRelativePath(input, "/dashboard", ORIGIN);

test("accepts ordinary application paths", () => {
  assert.equal(safe("/dashboard"), "/dashboard");
  assert.equal(safe("/leads?id=1"), "/leads?id=1");
  assert.equal(safe("/invite/abc#top"), "/invite/abc#top");
  assert.equal(safe("/settings/team?tab=a&b=2"), "/settings/team?tab=a&b=2");
});

test("rejects scheme-relative and backslash tricks", () => {
  for (const bad of ["//evil.com", "//evil.com/dashboard", "/\\evil.com", "/\\/evil.com", "\\\\evil.com", "/%5Cevil.com", "/%5cevil.com", "/%2F%2Fevil.com", "/%2f/evil.com"]) {
    assert.equal(safe(bad), "/dashboard", `should reject ${bad}`);
  }
});

test("rejects absolute and non-http URLs", () => {
  for (const bad of ["https://evil.com", "http://app.example.com.evil.com/x", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "evil.com", "dashboard"]) {
    assert.equal(safe(bad), "/dashboard", `should reject ${bad}`);
  }
});

test("rejects control characters, malformed encoding and non-strings", () => {
  for (const bad of ["/dash\nboard", "/dash\tboard", "/x%0d%0aSet-Cookie:a=b", "/%E0%A4%A", "", undefined, null, 42, "/" + "a".repeat(3000)]) {
    assert.equal(safe(bad), "/dashboard", `should reject ${JSON.stringify(bad)}`);
  }
});

test("normalises dot segments but never leaves the origin", () => {
  assert.equal(safe("/leads/../dashboard"), "/dashboard");
  assert.equal(safe("/../../etc/passwd"), "/etc/passwd"); // still same-origin, just a 404
});

test("uses the caller's fallback", () => {
  assert.equal(safeRelativePath("//evil.com", "/login", ORIGIN), "/login");
});

test("siteOrigin trusts configuration, not requests", () => {
  assert.equal(siteOrigin({ NEXT_PUBLIC_SITE_URL: "https://app.example.com/some/path" }), "https://app.example.com");
  assert.equal(siteOrigin({ NODE_ENV: "development" }), "http://localhost:3000");
  assert.throws(() => siteOrigin({ NODE_ENV: "production" }), /must be set/);
  assert.throws(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "http://app.example.com", NODE_ENV: "production" }), /https/);
  assert.equal(siteOrigin({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000", NODE_ENV: "production" }), "http://localhost:3000");
  assert.throws(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "ftp://x.com" }), /http/);
  assert.throws(() => siteOrigin({ NEXT_PUBLIC_SITE_URL: "not a url" }), /valid URL/);
});

test("on Vercel, an unset site URL falls back to the project's production domain", () => {
  const vercel = { NODE_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "my-app.vercel.app" };
  assert.equal(siteOrigin(vercel), "https://my-app.vercel.app");
  // An explicit setting always wins (e.g. a custom domain).
  assert.equal(siteOrigin({ ...vercel, NEXT_PUBLIC_SITE_URL: "https://app.example.com" }), "https://app.example.com");
});

test("absoluteUrl builds links on the canonical origin only", () => {
  assert.equal(absoluteUrl("/invite/tok", ORIGIN), "https://app.example.com/invite/tok");
  assert.equal(absoluteUrl("//evil.com", ORIGIN), "https://app.example.com/");
});
