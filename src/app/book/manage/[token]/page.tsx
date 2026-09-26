import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelBooking } from "../../[slug]/actions";
import { Alert, Button, Card } from "@/components/ui";
import { formatDay, formatRange } from "@/lib/appointments";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Your booking" };

// The token in this URL is the visitor's only credential for their booking,
// so the page shows just their own appointment and nothing else.
export default async function ManageBookingPage({ params, searchParams }: PageProps<"/book/manage/[token]">) {
  const { token } = await params;
  const { new: isNew, cancelled, error } = await searchParams;

  const supabase = await createClient();
  const { data: booking } = await supabase.rpc("get_booking", { p_token: token }).maybeSingle();
  if (!booking) notFound();

  const tz = booking.timezone;
  const upcoming = booking.status === "booked" && new Date(booking.starts_at) > new Date();

  return (
    <Card className="mx-auto w-full max-w-md p-6 text-center">
      {isNew && booking.status === "booked" && (
        <div className="mb-4"><Alert tone="success">You&apos;re booked! Save this page to change your plans later.</Alert></div>
      )}
      {cancelled && <div className="mb-4"><Alert tone="info">Your booking has been cancelled.</Alert></div>}
      {error && <div className="mb-4"><Alert>This booking can no longer be cancelled.</Alert></div>}

      <p className="text-sm font-medium text-accent">{booking.tenant_name}</p>
      <h1 className="mt-1 text-xl font-semibold">{formatDay(booking.starts_at, tz)}</h1>
      <p className="mt-1 text-muted">
        {formatRange(booking.starts_at, booking.ends_at, tz)} · {tz.replaceAll("_", " ")}
      </p>
      <p className="mt-4 text-sm">
        Booked for <strong>{booking.name}</strong> ·{" "}
        <span className={booking.status === "cancelled" ? "text-danger" : "text-muted"}>
          {booking.status === "booked" ? (upcoming ? "Confirmed" : "Past") : booking.status === "cancelled" ? "Cancelled" : "Completed"}
        </span>
      </p>

      <div className="mt-6 grid gap-2">
        {upcoming && (
          <form action={cancelBooking}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" variant="secondary" className="w-full">Cancel this booking</Button>
          </form>
        )}
        <Link href={`/book/${booking.tenant_slug}`} className="text-sm font-medium text-accent hover:underline">
          {upcoming ? "Book another time" : "Book a new time"}
        </Link>
      </div>
    </Card>
  );
}
