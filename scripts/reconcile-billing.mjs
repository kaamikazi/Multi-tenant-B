// Manual, no-cost way to run billing reconciliation (the same endpoint a
// scheduler calls). Reads CRON_SECRET and NEXT_PUBLIC_SITE_URL from the env:
//
//   npm run billing:reconcile                       # against NEXT_PUBLIC_SITE_URL
//   npm run billing:reconcile -- http://localhost:3000
//
// Prints only the counts the endpoint returns; never prints the secret.
const base = process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("Set CRON_SECRET (32+ random characters) in .env.local and in the deployed app's environment.");
  process.exit(1);
}
const res = await fetch(new URL("/api/cron/reconcile-billing", base), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});
console.log(res.status, await res.text());
process.exit(res.ok ? 0 : 1);
