import { NextResponse, type NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { stripe, syncSubscription } from "@/lib/billing";

// Stripe Checkout's success_url. Syncs the new subscription immediately so the
// upgrade shows even when webhooks aren't reaching this machine (local dev).
// The webhook performs the same idempotent sync in production.
export async function GET(request: NextRequest) {
  const back = (query: string) => NextResponse.redirect(new URL(`/settings/billing?${query}`, request.url));

  const sessionId = request.nextUrl.searchParams.get("session_id");
  const member = await getMember();
  if (!stripe || !sessionId || !member) return back("error=checkout");

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  // Only sync a session that belongs to the caller's own tenant.
  if (session.client_reference_id !== member.tenant.id || typeof session.subscription !== "string") {
    return back("error=checkout");
  }

  await syncSubscription(session.subscription);
  return back("checkout=success");
}
