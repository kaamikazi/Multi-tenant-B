import type { Database, Json } from "@/lib/supabase/database.types";
import type { Role } from "@/lib/rbac";

// Scores are computed in the database (private.score_lead, via the
// leads_scored view). This file only describes and displays them.

export type LeadSource = Database["public"]["Enums"]["lead_source"];
export type LeadStatus = Database["public"]["Enums"]["lead_status"];
export type Tier = "hot" | "warm" | "cold";
export type ScoreFactor = { factor: string; points: number; max: number; reason: string };

export const SOURCE_LABEL: Record<LeadSource, string> = {
  referral: "Referral",
  demo_request: "Demo request",
  webinar: "Webinar",
  organic_search: "Organic search",
  paid_ads: "Paid ads",
  social: "Social",
  cold_outreach: "Cold outreach",
  other: "Other",
};

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  won: "Won",
  lost: "Lost",
};

export const OPEN_STATUSES: LeadStatus[] = ["new", "contacted", "qualified"];

export const TIER_LABEL: Record<Tier, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };

export function asTier(value: string | null): Tier {
  return value === "hot" || value === "warm" ? value : "cold";
}

export function parseBreakdown(value: Json | null): ScoreFactor[] {
  return Array.isArray(value) ? (value as ScoreFactor[]) : [];
}

/** The factor that contributed the most points, for one-line summaries. */
export function topReasons(breakdown: ScoreFactor[], count = 2) {
  return [...breakdown]
    .filter((f) => f.points > 0)
    .sort((a, b) => b.points / b.max - a.points / a.max)
    .slice(0, count)
    .map((f) => f.reason);
}

/** Mirrors the leads UPDATE policy: owners/admins edit any lead, members their own. */
export function canEditLead(role: Role, userId: string, ownerId: string | null) {
  return role !== "member" || ownerId === userId;
}

/** Mirrors the leads DELETE policy. */
export function canDeleteLead(role: Role) {
  return role !== "member";
}

export function formatEngaged(iso: string | null) {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function formatMoney(usd: number | null) {
  return usd == null ? "—" : `$${usd.toLocaleString("en-US")}`;
}
