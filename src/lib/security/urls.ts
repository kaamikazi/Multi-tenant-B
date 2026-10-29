// URL safety helpers. Pure functions with no framework imports, so they run
// unchanged in Next.js and in `node --test`.

const DEV_ORIGIN = "http://localhost:3000";

/**
 * The canonical origin of this deployment, from NEXT_PUBLIC_SITE_URL.
 *
 * Absolute links we generate (invitations, auth emails, Stripe redirects)
 * use this rather than the request's Host / Origin / X-Forwarded-* headers,
 * which a client or a misconfigured proxy can set to anything.
 * On Vercel, when it is unset, the project's production domain is used
 * (VERCEL_PROJECT_PRODUCTION_URL is set by Vercel itself, not by requests).
 * Otherwise throws in production if the setting is missing or malformed, so
 * a bad deployment fails loudly instead of emitting links to the wrong host.
 */
export function siteOrigin(
  env: { NEXT_PUBLIC_SITE_URL?: string; NODE_ENV?: string; VERCEL_PROJECT_PRODUCTION_URL?: string } = process.env,
): string {
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = env.NEXT_PUBLIC_SITE_URL?.trim() || (vercel ? `https://${vercel}` : "");
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_SITE_URL must be set in production");
    return DEV_ORIGIN;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("NEXT_PUBLIC_SITE_URL must be http(s)");
  if (env.NODE_ENV === "production" && url.protocol !== "https:" && !isLocalHost(url.hostname)) {
    throw new Error("NEXT_PUBLIC_SITE_URL must use https in production");
  }
  return url.origin;
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/** An absolute URL on the canonical origin for an app path such as "/invite/abc". */
export function absoluteUrl(path: string, origin = siteOrigin()): string {
  const safe = safeRelativePath(path, "/", origin);
  return new URL(safe, origin).toString();
}

// Control characters and backslashes never belong in an app path. Browsers
// treat "\" like "/", so "/\evil.com" would become "//evil.com".
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

/**
 * Returns `input` if it is a same-origin application path, else `fallback`.
 *
 * Resolves the value against the canonical origin and accepts it only if the
 * result stays on that origin. Rejects scheme-relative ("//x"), backslash and
 * encoded-backslash tricks ("/\x", "/%5Cx"), absolute URLs to other hosts,
 * control characters and anything that isn't a plain "/path?query#hash".
 */
export function safeRelativePath(input: unknown, fallback = "/dashboard", origin = siteOrigin()): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 2048) return fallback;
  if (!input.startsWith("/") || input.startsWith("//")) return fallback;
  if (UNSAFE.test(input)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return fallback; // malformed percent-encoding
  }
  // Re-check after decoding: "/%5Cevil.com" and "/%2F%2Fevil.com" decode to tricks.
  if (UNSAFE.test(decoded) || decoded.startsWith("//")) return fallback;

  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin) return fallback;
  if (url.pathname.startsWith("//")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
