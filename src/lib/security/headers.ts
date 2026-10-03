// Response security headers. Pure (no Next.js imports) so the policy itself is
// unit-tested in headers.test.ts; src/proxy.ts applies the per-request CSP and
// next.config.ts applies the static headers.

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

export type CspOptions = {
  nonce: string;
  isDev: boolean;
  /** Add upgrade-insecure-requests (only meaningful when served over https). */
  https: boolean;
  /** Allow the Cloudflare Turnstile widget (only when it is configured). */
  turnstile: boolean;
};

/**
 * The Content-Security-Policy for HTML pages.
 *
 * - Scripts run only with this request's nonce ('strict-dynamic' lets those
 *   scripts load Next.js chunks). No inline or third-party script otherwise.
 * - img-src / connect-src / font-src are same-origin only, so text that a
 *   model or a visitor controls cannot make the browser fetch an external URL
 *   (no image beacons, no fetch exfiltration). The browser never talks to
 *   Supabase, Stripe or Gemini directly: all of that is server-side.
 * - style-src allows inline styles because React `style` attributes can't carry
 *   a nonce (and a nonce would disable 'unsafe-inline'). CSS cannot load
 *   anything external because img-src/font-src stay same-origin.
 * - form-action lists Stripe because the Checkout and Billing Portal server
 *   actions end with a redirect there.
 */
export function buildCsp({ nonce, isDev, https, turnstile }: CspOptions): string {
  const t = turnstile ? ` ${TURNSTILE_ORIGIN}` : "";
  const directives = [
    `default-src 'self'`,
    // React needs eval in development only, for its debugging stack traces.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}${t}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'${t}`,
    `frame-src ${turnstile ? TURNSTILE_ORIGIN : "'none'"}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self' https://checkout.stripe.com https://billing.stripe.com`,
    `frame-ancestors 'none'`,
    ...(https && !isDev ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** A fresh, unpredictable nonce for every request (128 bits). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Headers for every response (set in next.config.ts). */
export function staticSecurityHeaders(isProd: boolean): { key: string; value: string }[] {
  return [
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}

/**
 * Pages whose URL itself is a bearer secret (invitation and booking-management
 * links). Their responses must not be cached, indexed, or leak the URL to
 * another site through the Referer header.
 */
export function isSecretLinkPath(pathname: string): boolean {
  return /^\/(invite|book\/manage)\/[^/]+\/?$/.test(pathname);
}

export const SECRET_LINK_HEADERS: Readonly<Record<string, string>> = {
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
};
