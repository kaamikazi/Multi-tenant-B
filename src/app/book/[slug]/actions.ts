"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type BookingState = { error?: string; values?: Record<string, string> };

// Runs for anonymous visitors. book_appointment re-checks everything itself:
// the slot must be open, one email can hold at most 3 upcoming bookings, and
// the exclusion constraint makes a double booking impossible.
export async function bookSlot(_: BookingState, formData: FormData): Promise<BookingState> {
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const slug = text("slug");
  const startsAt = text("starts_at");
  const values = { name: text("name"), email: text("email"), notes: text("notes") };

  if (!values.name || !values.email) return { error: "Enter your name and email.", values };
  if (values.notes.length > 1000) return { error: "Keep notes under 1,000 characters.", values };

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
    const message =
      error.code === "23514" ? "Enter a valid email address."
      : error.code === "23P01" ? "Someone just booked that time. Please pick another slot."
      : error.message;
    return { error: message, values };
  }

  redirect(`/book/manage/${data.cancel_token}?new=1`);
}

export async function cancelBooking(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking", { p_token: token });
  redirect(`/book/manage/${encodeURIComponent(token)}${error ? "?error=1" : "?cancelled=1"}`);
}
