import type Stripe from "stripe";
import { NextResponse, type NextRequest } from "next/server";
import { stripe, syncCustomer } from "@/lib/billing";

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

  // Sync the whole customer, not just this event's subscription, so an event
  // about an unrelated product can't change a tenant's plan, and duplicate or
  // out-of-order events converge.
  let customer: string | null = null;
  if (event.type === "checkout.session.completed") {
    const c = event.data.object.customer;
    customer = typeof c === "string" ? c : (c?.id ?? null);
  } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const c = (event.data.object as Stripe.Subscription).customer;
    customer = typeof c === "string" ? c : c.id;
  }

  if (customer) {
    // A thrown error returns 500, and Stripe retries the event later.
    await syncCustomer(customer);
  }

  return NextResponse.json({ received: true });
}
