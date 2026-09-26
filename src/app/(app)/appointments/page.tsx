import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { setAppointmentStatus } from "./actions";
import { NewAppointmentForm } from "./forms";
import { CopyLinkButton } from "@/components/copy-link-button";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { STATUS_LABEL, canEditAppointment, dayKey, formatDay, formatRange } from "@/lib/appointments";
import { requireMember } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Appointments · TenantFlow" };

const STATUS_STYLE = {
  booked: "bg-accent/15 text-accent",
  completed: "bg-success/15 text-success",
  cancelled: "bg-zinc-500/15 text-muted",
} as const;

export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const me = await requireMember();
  const { view } = await searchParams;
  const past = view === "past";
  const now = new Date().toISOString();

  // RLS scopes all of this to the caller's tenant.
  const supabase = await createClient();
  let query = supabase
    .from("appointments")
    .select("id, starts_at, ends_at, name, email, notes, status, source, lead_id, created_by")
    .limit(100);
  query = past ? query.lt("ends_at", now).order("starts_at", { ascending: false }) : query.gte("ends_at", now).order("starts_at");

  const [{ data: appointments }, { data: settings }, { data: leads }] = await Promise.all([
    query,
    supabase.from("booking_settings").select("enabled, timezone, slot_minutes").maybeSingle(),
    supabase.from("leads").select("id, name, email, owner_id").order("name"),
  ]);
  const tz = settings?.timezone ?? "UTC";
  const leadById = new Map((leads ?? []).map((l) => [l.id, l]));

  const groups = new Map<string, NonNullable<typeof appointments>>();
  for (const a of appointments ?? []) {
    const key = dayKey(a.starts_at, tz);
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }

  const h = await headers();
  const bookingUrl = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/book/${me.tenant.slug}`;
  const manager = can(me.role, "booking:settings");

  return (
    <>
      <PageHeader
        title="Appointments"
        description={`Your team calendar. Times in ${tz.replaceAll("_", " ")}. Double bookings are blocked by the database.`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-4">
          <div role="group" aria-label="View" className="flex w-fit gap-1 rounded-lg border border-line bg-surface p-1 text-sm">
            {[["upcoming", "Upcoming"], ["past", "Past"]].map(([v, label]) => (
              <Link
                key={v}
                href={v === "past" ? "/appointments?view=past" : "/appointments"}
                aria-current={(v === "past") === past ? "true" : undefined}
                className={`rounded-md px-2.5 py-1 ${(v === "past") === past ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"}`}
              >
                {label}
              </Link>
            ))}
          </div>

          {groups.size === 0 ? (
            <Card className="px-5 py-10 text-center text-sm text-muted">
              {past ? "No past appointments yet." : "Nothing booked yet. Share your booking page, or book one for a lead."}
            </Card>
          ) : (
            [...groups.entries()].map(([day, items]) => (
              <Card key={day}>
                <h2 className="border-b border-line px-5 py-3 text-sm font-semibold">{formatDay(items[0].starts_at, tz)}</h2>
                <ul className="divide-y divide-line">
                  {items.map((a) => {
                    const lead = a.lead_id ? leadById.get(a.lead_id) : undefined;
                    const editable = canEditAppointment(me.role, me.id, { created_by: a.created_by, leadOwnerId: lead?.owner_id ?? null });
                    const live = a.status === "booked" && !past;
                    return (
                      <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium tabular-nums ${a.status === "cancelled" ? "text-muted line-through" : ""}`}>
                            {formatRange(a.starts_at, a.ends_at, tz)}
                          </p>
                          <p className="mt-0.5 truncate font-medium">
                            {lead ? <Link href={`/leads/${lead.id}`} className="hover:text-accent">{a.name}</Link> : a.name}
                            <span className="ml-2 text-sm font-normal text-muted">{a.email}</span>
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_STYLE[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                            <span className="text-muted">{a.source === "booking_page" ? "Booked online" : "Booked by the team"}</span>
                            {a.notes && <span className="truncate text-muted">· {a.notes}</span>}
                          </div>
                        </div>
                        {live && editable && (
                          <div className="flex shrink-0 gap-2">
                            <form action={setAppointmentStatus}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="status" value="completed" />
                              <Button type="submit" variant="secondary">Mark done</Button>
                            </form>
                            <form action={setAppointmentStatus}>
                              <input type="hidden" name="id" value={a.id} />
                              <input type="hidden" name="status" value="cancelled" />
                              <Button type="submit" variant="danger">Cancel</Button>
                            </form>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
        </div>

        <aside className="grid content-start gap-4">
          <Card>
            <CardHeader
              title="Your booking page"
              description={settings?.enabled ? "Anyone with the link can book an open slot." : "Turned off: visitors can't book right now."}
            />
            <div className="grid gap-3 px-5 py-4">
              <p className="truncate rounded-md bg-background px-3 py-2 font-mono text-xs" title={bookingUrl}>{bookingUrl}</p>
              <div className="flex flex-wrap gap-2">
                <CopyLinkButton url={bookingUrl} />
                <Link href={`/book/${me.tenant.slug}`} target="_blank" className="inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium text-muted hover:bg-background hover:text-foreground">
                  Open
                </Link>
                {manager && (
                  <Link href="/appointments/settings" className="inline-flex h-9 items-center rounded-md px-3.5 text-sm font-medium text-accent hover:bg-background">
                    Settings
                  </Link>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Book for a lead" description="Blocked if it overlaps another booking." />
            <NewAppointmentForm
              leads={(leads ?? []).map((l) => ({ id: l.id, name: l.name, email: l.email }))}
              today={dayKey(now, tz)}
              defaultMinutes={settings?.slot_minutes ?? 30}
            />
          </Card>
        </aside>
      </div>
    </>
  );
}
