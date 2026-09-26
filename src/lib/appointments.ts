import type { Database } from "@/lib/supabase/database.types";
import type { Role } from "@/lib/rbac";

// Availability and double-booking rules live in the database
// (private.open_slots and the appointments exclusion constraint). This file
// only formats times and mirrors the edit policy for the UI.

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  booked: "Booked",
  cancelled: "Cancelled",
  completed: "Completed",
};

export const WEEKDAYS = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 7, short: "Sun" },
];

export const SLOT_LENGTHS = [15, 20, 30, 45, 60];

/** YYYY-MM-DD of an instant as seen in `timeZone` (used to group slots by day). */
export function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone: string, style: "long" | "short" = "long") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: style === "long" ? "long" : "short",
    month: style === "long" ? "long" : "short",
    day: "numeric",
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatRange(startIso: string, endIso: string, timeZone: string) {
  return `${formatTime(startIso, timeZone)} – ${formatTime(endIso, timeZone)}`;
}

/** Offset of `timeZone` from UTC at `utcMs`, in minutes (e.g. +60 for Paris in winter). */
function offsetMinutes(utcMs: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * Converts a wall-clock date and time in `timeZone` (as typed into a form) to
 * a UTC instant. Two passes so times next to a DST change resolve correctly.
 */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  let utc = naive - offsetMinutes(naive, timeZone) * 60_000;
  utc = naive - offsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc);
}

/** Mirrors the appointments UPDATE policy. */
export function canEditAppointment(
  role: Role,
  userId: string,
  appointment: { created_by: string | null; leadOwnerId: string | null },
) {
  return role !== "member" || appointment.created_by === userId || appointment.leadOwnerId === userId;
}

/** Common IANA zones for the settings picker (any valid zone is accepted by the database). */
export const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];
