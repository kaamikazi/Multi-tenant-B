import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildCsp, createNonce, isSecretLinkPath, SECRET_LINK_HEADERS } from "@/lib/security/headers";

export async function proxy(request: NextRequest) {
  // A fresh nonce per request. Next.js reads it from the request's CSP header
  // and puts it on its own scripts, so every page must render dynamically
  // (the root layout calls connection()).
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    https: request.nextUrl.protocol === "https:",
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  });

  const response = await updateSession(request, { "Content-Security-Policy": csp, "x-nonce": nonce });
  response.headers.set("Content-Security-Policy", csp);

  if (isSecretLinkPath(request.nextUrl.pathname)) {
    for (const [key, value] of Object.entries(SECRET_LINK_HEADERS)) response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except the Stripe webhook and cron endpoints (they
    // authenticate themselves, without cookies), static assets and images.
    "/((?!api/stripe/webhook|api/cron/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
