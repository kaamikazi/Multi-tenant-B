import type { Metadata } from "next";
import Link from "next/link";
import { BookingSettingsForm } from "../forms";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Booking settings · TenantFlow" };

export default async function BookingSettingsPage() {
  // The page is for owners and admins; the database's RLS enforces the same.
  const me = await requireRole("owner", "admin");
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("booking_settings")
    .select("enabled, headline, timezone, days, start_time, end_time, slot_minutes, min_notice_hours, horizon_days")
    .eq("tenant_id", me.tenant.id)
    .single();

  return (
    <>
      <Link href="/appointments" className="text-sm text-muted hover:text-foreground">← Appointments</Link>
      <PageHeader title="Booking settings" description="When visitors can book time with your team on the public page." />
      <Card className="max-w-2xl">
        <CardHeader title="Availability" description={`Public link: /book/${me.tenant.slug}`} />
        {settings && <BookingSettingsForm settings={settings} />}
      </Card>
    </>
  );
}
