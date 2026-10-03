"use server";

import { redirect } from "next/navigation";
import { BOOKING_LIMITS } from "@/lib/rate-limit";
import { allow, requestIp } from "@/lib/rate-limit-server";
import { verifyCaptcha } from "@/lib/security/turnstile";
import { createClient } from "@/lib/supabase/server";

export type BookingState = { error?: string; values?: Record<string, string> };

// Runs for anonymous visitors. Checks, cheapest first:
//   1. input shape (UX only; the database validates again);
//   2. per-IP rate limits (abuse brake, see src/lib/rate-limit.ts);
//   3. Turnstile, when configured. A failed check never reaches the database.
// book_appointment then re-checks everything authoritatively: the slot must
// be open, one email holds at most 3 upcoming bookings, a workspace takes at
// most 50 booking-page bookings a day, and the exclusion constraint makes a
// double booking impossible.
export async function bookSlot(_: BookingState, formData: FormData): Promise<BookingState> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const slug = text("slug").slice(0, 100);
  const startsAt = text("starts_at");
  const values = { name: text("name"), email: text("email"), notes: text("notes") };

  if (!values.name || !values.email) return { error: "Enter your name and email.", values };
  if (values.name.length > 120) return { error: "Keep your name under 120 characters.", values };
  if (values.email.length > 254) return { error: "Enter a valid email address.", values };
  if (values.notes.length > 1000) return { error: "Keep notes under 1,000 characters.", values };

  const ip = await requestIp();
  const withinLimits =
    (await allow(`book:${ip}:${slug}`, BOOKING_LIMITS.bookPerIp)) &&
    (await allow(`book:${ip}`, BOOKING_LIMITS.bookPerIpGlobal));
  if (!withinLimits) return { error: "Too many booking attempts. Please try again in a few minutes.", values };

  const captcha = await verifyCaptcha(formData.get("cf-turnstile-response") as string | null, ip);
  if (!captcha.ok) {
    if (captcha.reason === "misconfigured") console.error("booking: Turnstile is half-configured; set both keys or neither");
    return {
      error: captcha.reason === "missing" || captcha.reason === "failed"
        ? "Please complete the verification check and try again."
        : "Booking is temporarily unavailable. Please try again shortly.",
      values,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("book_appointment", {
      p_slug: slug,
      p_starts_at: startsAt,
      p_name: values.name,
      p_email: values.email,
      p_notes: values.notes || undefined,
    })
    .single();

  if (error) {
    // Messages from our own checks (22023 invalid input, P0001 business rule, P0002 not found,
    // 54000 limit) are written for visitors; anything else stays generic.
    const message =
      error.code === "23514" ? "Enter a valid email address."
      : error.code === "23P01" ? "Someone just booked that time. Please pick another slot."
      : ["22023", "P0001", "P0002", "54000"].includes(error.code) ? error.message
      : "We couldn't complete that booking. Please try again.";
    return { error: message, values };
  }

  redirect(`/book/manage/${data.cancel_token}?new=1`);
}

export async function cancelBooking(formData: FormData) {
  const token = String(formData.get("token") ?? "").slice(0, 200);
  const path = `/book/manage/${encodeURIComponent(token)}`;
  if (!(await allow(`cancel:${await requestIp()}`, BOOKING_LIMITS.bookPerIpGlobal))) redirect(`${path}?error=1`);

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking", { p_token: token });
  redirect(`${path}${error ? "?error=1" : "?cancelled=1"}`);
}
