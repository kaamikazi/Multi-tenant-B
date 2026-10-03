import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BookingForm } from "./booking-form";
import { Card } from "@/components/ui";
import { dayKey, formatDay, formatRange, formatTime } from "@/lib/appointments";
import { BOOKING_LIMITS } from "@/lib/rate-limit";
import { allow, requestIp } from "@/lib/rate-limit-server";
import { captchaMode } from "@/lib/security/turnstile";
import { createClient } from "@/lib/supabase/server";

type Props = PageProps<"/book/[slug]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_page", { p_slug: slug }).maybeSingle();
  return { title: data ? `Book with ${data.tenant_name}` : "Booking" };
}

export default async function BookingPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { date, slot } = await searchParams;

  // Each view computes two weeks of open slots, so repeated scraping is
  // throttled per IP (see src/lib/rate-limit.ts).
  if (!(await allow(`view:${await requestIp()}`, BOOKING_LIMITS.viewPerIp))) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold">Too many requests</h1>
        <p className="mt-2 text-sm text-muted">Please wait a minute and reload the page.</p>
      </Card>
    );
  }

  // Public: these RPCs run for anonymous visitors and reveal only free slots.
  const supabase = await createClient();
  const { data: page } = await supabase.rpc("get_booking_page", { p_slug: slug }).maybeSingle();
  if (!page) notFound();

  if (!page.enabled) {
    return (
      <Card className="p-8 text-center">
        <h1 className="text-xl font-semibold">{page.tenant_name}</h1>
        <p className="mt-2 text-sm text-muted">This booking page isn&apos;t taking new bookings right now.</p>
      </Card>
    );
  }

  const { data: slots } = await supabase.rpc("get_open_slots", { p_slug: slug, p_days: 14 });
  const tz = page.timezone;
  const byDay = new Map<string, { starts_at: string; ends_at: string }[]>();
  for (const s of slots ?? []) {
    const key = dayKey(s.starts_at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), s]);
  }
  const days = [...byDay.keys()];
  const selectedDay = typeof date === "string" && byDay.has(date) ? date : days[0];
  const daySlots = selectedDay ? byDay.get(selectedDay)! : [];
  const chosen = typeof slot === "string" ? (slots ?? []).find((s) => s.starts_at === slot || new Date(s.starts_at).toISOString() === slot) : undefined;
  const staleSlot = typeof slot === "string" && !chosen;
  const href = (q: Record<string, string>) => `/book/${slug}?${new URLSearchParams(q)}`;

  return (
    <div className="grid gap-6">
      <header className="text-center">
        <p className="text-sm font-medium text-accent">{page.tenant_name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{page.headline}</h1>
        <p className="mt-2 text-sm text-muted">
          {page.slot_minutes} minutes · Times shown in {tz.replaceAll("_", " ")}
        </p>
      </header>

      {days.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">
          No open times in the next two weeks. Please check back soon.
        </Card>
      ) : chosen ? (
        <Card className="mx-auto w-full max-w-md p-6">
          <Link href={href({ date: dayKey(chosen.starts_at, tz) })} className="text-sm text-muted hover:text-foreground">
            ← Pick a different time
          </Link>
          <h2 className="mt-3 mb-4 text-lg font-semibold">Your details</h2>
          <BookingForm
            slug={slug}
            startsAt={chosen.starts_at}
            summary={`${formatDay(chosen.starts_at, tz)}, ${formatRange(chosen.starts_at, chosen.ends_at, tz)}`}
            turnstile={captchaMode() === "on" ? { siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!, nonce: (await headers()).get("x-nonce") ?? undefined } : undefined}
          />
        </Card>
      ) : (
        <Card className="grid overflow-hidden md:grid-cols-[15rem_1fr]">
          <nav aria-label="Days" className="flex gap-2 overflow-x-auto border-b border-line p-3 md:grid md:content-start md:border-r md:border-b-0">
            {days.map((d) => {
              const first = byDay.get(d)![0].starts_at;
              const active = d === selectedDay;
              return (
                <Link
                  key={d}
                  href={href({ date: d })}
                  aria-current={active ? "date" : undefined}
                  className={`shrink-0 rounded-md px-3 py-2 text-sm transition ${active ? "bg-accent text-accent-foreground" : "hover:bg-background"}`}
                >
                  <span className="font-medium">{formatDay(first, tz, "short")}</span>
                  <span className={`ml-2 text-xs ${active ? "" : "text-muted"}`}>{byDay.get(d)!.length} open</span>
                </Link>
              );
            })}
          </nav>
          <section className="p-4 sm:p-6">
            {staleSlot && (
              <p role="alert" className="mb-4 text-sm text-danger">That time was just taken. Please pick another.</p>
            )}
            <h2 className="mb-4 font-semibold">{formatDay(daySlots[0].starts_at, tz)}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {daySlots.map((s) => (
                <Link
                  key={s.starts_at}
                  href={href({ date: selectedDay, slot: s.starts_at })}
                  className="rounded-md border border-line px-3 py-2.5 text-center text-sm font-medium transition hover:border-accent hover:text-accent"
                >
                  {formatTime(s.starts_at, tz)}
                </Link>
              ))}
            </div>
          </section>
        </Card>
      )}
    </div>
  );
}
