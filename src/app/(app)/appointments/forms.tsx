"use client";

import { useActionState } from "react";
import { createAppointment, saveBookingSettings } from "./actions";
import type { ActionResult } from "../settings/team/actions";
import { Alert, Button, Field } from "@/components/ui";
import { COMMON_TIMEZONES, SLOT_LENGTHS, WEEKDAYS } from "@/lib/appointments";

const selectClass =
  "h-10 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function Select({ label, children, ...props }: React.ComponentProps<"select"> & { label: string }) {
  return (
    <label className="grid min-w-0 content-start gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <select className={selectClass} {...props}>{children}</select>
    </label>
  );
}

type Lead = { id: string; name: string; email: string | null };

export function NewAppointmentForm({ leads, today, defaultMinutes }: { leads: Lead[]; today: string; defaultMinutes: number }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createAppointment, {});

  return (
    <form action={action} className="grid gap-3 px-5 py-4">
      <Select label="Lead (optional)" name="lead_id" defaultValue="">
        <option value="">No lead</option>
        {leads.map((l) => (
          <option key={l.id} value={l.id}>{l.name}{l.email ? ` · ${l.email}` : ""}</option>
        ))}
      </Select>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" name="date" type="date" required min={today} defaultValue={today} />
        <Field label="Time" name="time" type="time" required step={300} defaultValue="10:00" />
      </div>
      <Select label="Duration" name="duration" defaultValue={String(defaultMinutes)}>
        {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}
      </Select>
      <Field label="Name" name="name" placeholder="Filled from the lead if blank" maxLength={120} />
      <Field label="Email" name="email" type="email" placeholder="Filled from the lead if blank" />
      <Field label="Notes" name="notes" maxLength={1000} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
      <div><Button type="submit" disabled={pending}>{pending ? "Booking…" : "Book appointment"}</Button></div>
    </form>
  );
}

type Settings = {
  enabled: boolean;
  headline: string;
  timezone: string;
  days: number[];
  start_time: string;
  end_time: string;
  slot_minutes: number;
  min_notice_hours: number;
  horizon_days: number;
};

export function BookingSettingsForm({ settings }: { settings: Settings }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(saveBookingSettings, {});
  const zones = COMMON_TIMEZONES.includes(settings.timezone) ? COMMON_TIMEZONES : [settings.timezone, ...COMMON_TIMEZONES];

  return (
    <form action={action} className="grid gap-4 px-5 py-4">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-4 accent-[var(--accent)]" />
        Accept bookings on the public page
      </label>
      <Field label="Headline" name="headline" required maxLength={120} defaultValue={settings.headline} />
      <fieldset className="grid gap-1.5 text-sm">
        <legend className="mb-1.5 font-medium">Days</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <label key={d.value} className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5">
              <input type="checkbox" name="days" value={d.value} defaultChecked={settings.days.includes(d.value)} className="accent-[var(--accent)]" />
              {d.short}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" name="start_time" type="time" required defaultValue={settings.start_time.slice(0, 5)} />
        <Field label="Until" name="end_time" type="time" required defaultValue={settings.end_time.slice(0, 5)} />
        <Select label="Timezone" name="timezone" defaultValue={settings.timezone}>
          {zones.map((z) => <option key={z} value={z}>{z.replaceAll("_", " ")}</option>)}
        </Select>
        <Select label="Slot length" name="slot_minutes" defaultValue={String(settings.slot_minutes)}>
          {SLOT_LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
        </Select>
        <Field label="Minimum notice (hours)" name="min_notice_hours" type="number" min={0} max={168} defaultValue={settings.min_notice_hours} />
        <Field label="Bookable up to (days ahead)" name="horizon_days" type="number" min={1} max={90} defaultValue={settings.horizon_days} />
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert tone="success">{state.success}</Alert>}
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button></div>
    </form>
  );
}
