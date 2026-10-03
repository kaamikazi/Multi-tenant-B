import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { stripe, syncCustomer } from "@/lib/billing";
import { absoluteUrl } from "@/lib/security/urls";
import { createClient } from "@/lib/supabase/server";

// Stripe Checkout's success_url. Syncs immediately so the upgrade shows even
// when webhooks don't reach this machine; the webhook runs the same
// idempotent sync in production.
export async function GET(request: NextRequest) {
  const back = (query: string) => NextResponse.redirect(absoluteUrl(`/settings/billing?${query}`));

  const sessionId = request.nextUrl.searchParams.get("session_id");
  const member = await getMember();
  if (!stripe || !sessionId || !member) return back("error=checkout");

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;

  // Only sync a session for the caller's own tenant AND its recorded customer
  // (read with the caller's own client: RLS limits it to their tenant).
  const supabase = await createClient();
  const { data: billing } = await supabase.from("billing").select("stripe_customer_id").eq("tenant_id", member.tenant.id).maybeSingle();
  if (session.client_reference_id !== member.tenant.id || !customer || customer !== billing?.stripe_customer_id) {
    return back("error=checkout");
  }

  const result = await syncCustomer(customer);
  return back(result.ok && result.plan === "pro" ? "checkout=success" : "error=checkout");
}
