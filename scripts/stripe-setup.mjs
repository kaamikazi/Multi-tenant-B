// One-time, idempotent: creates the "TenantFlow Pro" product and its monthly
// price in Stripe (test mode), found later by lookup key. Safe to re-run.
//   npm run stripe:setup
import Stripe from "stripe";

const LOOKUP_KEY = "tenantflow_pro_monthly"; // PRO_PRICE_LOOKUP_KEY in src/lib/billing.ts
const key = process.env.STRIPE_SECRET_KEY;

if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local");
  process.exit(1);
}
if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
  console.error("Refusing to run: this demo only uses Stripe test-mode keys (sk_test_...).");
  process.exit(1);
}

const stripe = new Stripe(key);
const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 });
if (existing.data[0]) {
  console.log(`Pro price already exists: ${existing.data[0].id}`);
  process.exit(0);
}

const product = await stripe.products.create({
  name: "TenantFlow Pro",
  description: "Unlimited team seats (demo).",
});
const price = await stripe.prices.create({
  product: product.id,
  currency: "usd",
  unit_amount: 2900,
  recurring: { interval: "month" },
  lookup_key: LOOKUP_KEY,
});
console.log(`Created ${product.id} with monthly price ${price.id} ($29/mo)`);
