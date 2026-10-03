"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "../settings/team/actions";
import { SLOT_LENGTHS, zonedTimeToUtc, type AppointmentStatus } from "@/lib/appointments";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// The database decides who may create, change or cancel an appointment (RLS),
// and the exclusion constraint rejects overlaps. These actions translate.

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "").trim();

function friendly(error: { code?: string; message: string }) {
  if (error.code === "23P01") return "That time overlaps another booking.";
  if (error.code === "23514") return "Check the email address and the times.";
  if (error.code === "23503") return "That lead isn't in this workspace.";
  if (error.code === "42501") return "Your role can't make that change.";
  if (error.code === "22023") return "That isn't a timezone we recognise.";
  return error.message;
}

export async function createAppointment(_: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireMember();
  const supabase = await createClient();

  const { data: settings } = await supabase.from("booking_settings").select("timezone").maybeSingle();
  const tz = settings?.timezone ?? "UTC";
  const start = zonedTimeToUtc(text(formData, "date"), text(formData, "time"), tz);
  const minutes = Number(text(formData, "duration"));
  if (!start) return { error: "Pick a date and time." };
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) return { error: "Pick a duration." };
  if (start.getTime() < Date.now() - 60_000) return { error: "That time is in the past." };

  const leadId = text(formData, "lead_id") || null;
  let name = text(formData, "name");
  let email = text(formData, "email");
  if (leadId && (!name || !email)) {
    const { data: lead } = await supabase.from("leads").select("name, email").eq("id", leadId).maybeSingle();
    name ||= lead?.name ?? "";
    email ||= lead?.email ?? "";
  }
  if (!name || !email) return { error: "Add a name and email, or pick a lead that has an email." };

  const { error } = await supabase.from("appointments").insert({
    starts_at: start.toISOString(),
    ends_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    name,
    email,
    notes: text(formData, "notes") || null,
    lead_id: leadId,
  });
  if (error) return { error: friendly(error) };

  revalidatePath("/appointments");
  if (leadId) revalidatePath(`/leads/${leadId}`);
  return { success: "Appointment booked." };
}

export async function setAppointmentStatus(formData: FormData) {
  await requireMember();
  const status = text(formData, "status") as AppointmentStatus;
  if (!["cancelled", "completed"].includes(status)) return;
  const supabase = await createClient();
  const { data, error } = await supabase.from("appointments").update({ status }).eq("id", text(formData, "id")).select("id");
  revalidatePath("/appointments");
  // The database enforces the transition rules; report refusals instead of
  // failing silently. Only fixed codes go in the URL, never raw messages.
  if (error) redirect(`/appointments?error=${error.code === "P0001" ? "transition" : "failed"}`);
  if (!data?.length) redirect("/appointments?error=forbidden");
}

export async function saveBookingSettings(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const me = await requireMember();
  const days = formData.getAll("days").map(Number).filter((d) => d >= 1 && d <= 7);
  const slot = Number(text(formData, "slot_minutes"));
  if (!days.length) return { error: "Pick at least one day." };
  if (!SLOT_LENGTHS.includes(slot)) return { error: "Pick a slot length." };
  const start = text(formData, "start_time");
  const end = text(formData, "end_time");
  if (!start || !end || end <= start) return { error: "The end time must be after the start time." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("booking_settings")
    .update({
      enabled: formData.get("enabled") === "on",
      headline: text(formData, "headline") || "Book a meeting",
      timezone: text(formData, "timezone"),
      days,
      start_time: start,
      end_time: end,
      slot_minutes: slot,
      min_notice_hours: Math.max(0, Math.min(168, Number(text(formData, "min_notice_hours")) || 0)),
      horizon_days: Math.max(1, Math.min(90, Number(text(formData, "horizon_days")) || 21)),
    })
    .eq("tenant_id", me.tenant.id)
    .select("tenant_id");
  if (error) return { error: friendly(error) };
  // RLS turns a forbidden update into zero rows.
  if (!data?.length) return { error: "Only owners and admins can change booking settings." };

  revalidatePath("/appointments", "layout");
  revalidatePath(`/book/${me.tenant.slug}`);
  return { success: "Booking settings saved." };
}
