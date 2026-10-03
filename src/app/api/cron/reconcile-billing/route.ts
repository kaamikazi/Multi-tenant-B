import { NextResponse, type NextRequest } from "next/server";
import { reconcileBilling } from "@/lib/billing";
import { bearerMatches } from "@/lib/security/bearer";

// Re-syncs every workspace that has a Stripe customer from Stripe itself,
// repairing plans that drifted because a webhook was lost. Idempotent: a run
// with nothing to fix changes nothing.
//
// Auth: `Authorization: Bearer $CRON_SECRET` (server-only, >= 32 chars). With
// no secret configured the endpoint answers 404, as if it didn't exist.
//
// POST is the method for manual runs and generic schedulers. GET exists only
// because Vercel Cron can only send GET (with the same bearer header).
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new NextResponse(null, { status: 404 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const report = await reconcileBilling();
  // Details (tenant ids and reasons, no personal data) go to the server log;
  // the response carries counts only.
  if (report.changed.length || report.duplicates.length || report.errors.length) {
    console.warn("billing reconcile", JSON.stringify({ changed: report.changed, duplicates: report.duplicates, errors: report.errors }));
  }
  return NextResponse.json(
    { checked: report.checked, changed: report.changed.length, duplicates: report.duplicates.length, errors: report.errors.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const POST = handle;
export const GET = handle;
