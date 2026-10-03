"use client";

import Script from "next/script";
import { useActionState } from "react";
import { bookSlot, type BookingState } from "./actions";
import { Alert, Button, Field } from "@/components/ui";

type Turnstile = { siteKey: string; nonce?: string };

export function BookingForm({ slug, startsAt, summary, turnstile }: { slug: string; startsAt: string; summary: string; turnstile?: Turnstile }) {
  const [state, action, pending] = useActionState<BookingState, FormData>(bookSlot, {});

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="starts_at" value={startsAt} />
      <p className="rounded-md bg-background px-3 py-2 text-sm">{summary}</p>
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="Your name" name="name" autoComplete="name" required maxLength={120} defaultValue={state.values?.name} />
      <Field label="Email" name="email" type="email" autoComplete="email" required defaultValue={state.values?.email} />
      <label className="grid min-w-0 content-start gap-1.5 text-sm">
        <span className="font-medium">What would you like to discuss? <span className="font-normal text-muted">(optional)</span></span>
        <textarea
          name="notes"
          rows={3}
          maxLength={1000}
          defaultValue={state.values?.notes}
          className="rounded-md border border-line bg-surface px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>
      {turnstile && (
        <>
          {/* Renders the check and adds a cf-turnstile-response field that the server verifies. */}
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={turnstile.nonce} />
          <div className="cf-turnstile" data-sitekey={turnstile.siteKey} />
        </>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Booking…" : "Confirm booking"}</Button>
    </form>
  );
}
