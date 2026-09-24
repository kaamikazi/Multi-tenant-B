import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { stripe, syncSubscription } from "@/lib/billing";

const SUBSCRIPTION_EVENTS = new Set<Stripe.Event.Type>([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !secret || !signature) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 400 });
  }

  // The signature covers the raw body, so read it as text before parsing.
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let subscriptionId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
    subscriptionId = (event.data.object as Stripe.Subscription).id;
  }

  if (subscriptionId) {
    // A thrown error returns 500, and Stripe retries the event later.
    await syncSubscription(subscriptionId);
  }

  return NextResponse.json({ received: true });
}
