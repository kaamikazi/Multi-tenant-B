// Demo data: three realistic workspaces so the app looks alive on first login.
//
//   npm run seed          wipe the demo workspaces and recreate them
//
// Everything goes through the same paths real users take where it matters:
// owners sign up (the trigger creates their workspace), teammates join via
// invitations, and lead scores come from the database's scoring function.
// Demo passwords are random and written to .demo-credentials.local.md
// (gitignored), never printed. All emails use the reserved .example domain.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// The demo world
// ---------------------------------------------------------------------------
const DAY = 86_400_000;
const WORKSPACES = [
  {
    company: "Northwind Traders",
    plan: "pro",
    booking: { timezone: "UTC", headline: "Book a 30-minute product walkthrough" },
    people: [
      { key: "olivia", name: "Olivia Bennett", email: "olivia@northwind.example", role: "owner" },
      { key: "adam", name: "Adam Clarke", email: "adam@northwind.example", role: "admin" },
      { key: "mia", name: "Mia Chen", email: "mia@northwind.example", role: "member" },
      { key: "sam", name: "Sam Rivera", email: "sam@northwind.example", role: "member" },
    ],
    pendingInvites: [{ email: "jordan@northwind.example", role: "member" }],
    leads: [
      { name: "Priya Shah", company: "Initech", email: "priya@initech.example", budget: 75000, size: 420, source: "referral", status: "qualified", owner: "mia", engaged: 1, notes: "Wants SSO and an annual contract. Decision by end of month." },
      { name: "Tom Becker", company: "Hooli", email: "tom@hooli.example", budget: 30000, size: 120, source: "demo_request", status: "contacted", owner: "adam", engaged: 2, notes: "Asked for a security questionnaire." },
      { name: "Elena Petrova", company: "Stark Logistics", email: "elena@starklogistics.example", budget: 52000, size: 800, source: "webinar", status: "qualified", owner: "sam", engaged: 4 },
      { name: "Marcus Lee", company: "Umbrella Retail", email: "marcus@umbrella.example", budget: 22000, size: 60, source: "referral", status: "new", owner: null, engaged: 6 },
      { name: "Lena Ortiz", company: "Vandelay Industries", email: "lena@vandelay.example", budget: 12000, size: 35, source: "webinar", status: "new", owner: "mia", engaged: 12 },
      { name: "Sam Okafor", company: "Pied Piper", email: "sam.okafor@piedpiper.example", budget: 8000, size: 15, source: "organic_search", status: "contacted", owner: null, engaged: 25 },
      { name: "Hannah Wright", company: "Wonka Foods", email: "hannah@wonka.example", budget: 15000, size: 90, source: "paid_ads", status: "contacted", owner: "sam", engaged: 9 },
      { name: "Diego Alvarez", company: "Soylent Corp", email: "diego@soylent.example", budget: null, size: 8, source: "cold_outreach", status: "new", owner: "adam", engaged: null },
      { name: "Grace Liu", company: "Massive Dynamic", email: "grace@massive.example", budget: 3000, size: 12, source: "social", status: "new", owner: null, engaged: 40 },
      { name: "Omar Haddad", company: "Wayne Enterprises", email: "omar@wayne.example", budget: 90000, size: 5000, source: "paid_ads", status: "won", owner: "olivia", engaged: 20 },
      { name: "Chloe Martin", company: "Cyberdyne", email: "chloe@cyberdyne.example", budget: 40000, size: 300, source: "demo_request", status: "lost", owner: "adam", engaged: 60, notes: "Went with an in-house build." },
      { name: "Ravi Kumar", company: "Oscorp", email: "ravi@oscorp.example", budget: 18000, size: 45, source: "referral", status: "qualified", owner: "mia", engaged: 3 },
    ],
    // day: business days from today (negative = past), time: local wall-clock time
    appointments: [
      { lead: "Priya Shah", day: 1, time: "10:00", minutes: 30, source: "booking_page", status: "booked", notes: "Walkthrough of SSO setup" },
      { lead: "Tom Becker", day: 1, time: "14:00", minutes: 45, source: "team", by: "adam", status: "booked", notes: "Security review call" },
      { lead: "Elena Petrova", day: 2, time: "11:30", minutes: 30, source: "booking_page", status: "booked" },
      { lead: "Ravi Kumar", day: 3, time: "09:30", minutes: 30, source: "team", by: "mia", status: "booked", notes: "Pricing follow-up" },
      { lead: "Marcus Lee", day: 5, time: "15:00", minutes: 30, source: "booking_page", status: "cancelled" },
      { lead: "Omar Haddad", day: -6, time: "13:00", minutes: 60, source: "team", by: "olivia", status: "completed", notes: "Contract signing" },
      { lead: "Hannah Wright", day: -2, time: "10:30", minutes: 30, source: "booking_page", status: "completed" },
    ],
  },
  {
    company: "Globex Health",
    plan: "free",
    booking: { timezone: "America/New_York", headline: "Schedule a clinic onboarding call" },
    people: [
      { key: "gary", name: "Gary Nolan", email: "gary@globexhealth.example", role: "owner" },
      { key: "nina", name: "Nina Patel", email: "nina@globexhealth.example", role: "admin" },
      { key: "leo", name: "Leo Brooks", email: "leo@globexhealth.example", role: "member" },
    ],
    pendingInvites: [],
    leads: [
      { name: "Dr. Aisha Rahman", company: "Riverside Clinic", email: "aisha@riverside.example", budget: 28000, size: 150, source: "referral", status: "qualified", owner: "nina", engaged: 2 },
      { name: "Peter Walsh", company: "Maple Dental Group", email: "peter@mapledental.example", budget: 9000, size: 40, source: "demo_request", status: "contacted", owner: "leo", engaged: 5 },
      { name: "Sofia Romero", company: "Harbor Physio", email: "sofia@harborphysio.example", budget: 6000, size: 18, source: "organic_search", status: "new", owner: null, engaged: 11 },
      { name: "James O'Connor", company: "Summit Pediatrics", email: "james@summitpeds.example", budget: 55000, size: 260, source: "webinar", status: "qualified", owner: "gary", engaged: 1 },
      { name: "Mei Tanaka", company: "Lotus Wellness", email: "mei@lotuswellness.example", budget: null, size: 6, source: "social", status: "new", owner: null, engaged: null },
      { name: "Ben Carter", company: "Northside Labs", email: "ben@northsidelabs.example", budget: 14000, size: 75, source: "paid_ads", status: "contacted", owner: "leo", engaged: 19 },
      { name: "Fatima Zahra", company: "Cedar Health", email: "fatima@cedarhealth.example", budget: 32000, size: 210, source: "demo_request", status: "won", owner: "nina", engaged: 14 },
    ],
    appointments: [
      { lead: "James O'Connor", day: 1, time: "11:00", minutes: 30, source: "booking_page", status: "booked" },
      { lead: "Dr. Aisha Rahman", day: 2, time: "15:30", minutes: 45, source: "team", by: "nina", status: "booked", notes: "Data migration plan" },
      { lead: "Fatima Zahra", day: -4, time: "10:00", minutes: 30, source: "team", by: "nina", status: "completed" },
    ],
  },
  {
    company: "Acme Studio",
    plan: "free",
    booking: { timezone: "Europe/London", headline: "Book a creative brief call" },
    people: [
      { key: "ava", name: "Ava Thompson", email: "ava@acmestudio.example", role: "owner" },
      { key: "noah", name: "Noah Williams", email: "noah@acmestudio.example", role: "member" },
    ],
    pendingInvites: [],
    leads: [
      { name: "Isabel Moreno", company: "Bright Coffee Co", email: "isabel@brightcoffee.example", budget: 12000, size: 25, source: "referral", status: "qualified", owner: "ava", engaged: 3 },
      { name: "Kofi Mensah", company: "Urban Threads", email: "kofi@urbanthreads.example", budget: 5000, size: 12, source: "social", status: "new", owner: "noah", engaged: 8 },
      { name: "Lucy Grant", company: "Parkside Hotel", email: "lucy@parksidehotel.example", budget: 20000, size: 140, source: "demo_request", status: "contacted", owner: null, engaged: 1 },
      { name: "Oliver Stone", company: "Stone & Co Legal", email: "oliver@stonelegal.example", budget: 2500, size: 9, source: "cold_outreach", status: "new", owner: null, engaged: 70 },
    ],
    appointments: [
      { lead: "Lucy Grant", day: 2, time: "10:00", minutes: 30, source: "booking_page", status: "booked", notes: "Rebrand for the hotel's 50th anniversary" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const password = () => `Demo-${randomBytes(9).toString("base64url")}`;
const ago = (days) => (days == null ? null : new Date(Date.now() - days * DAY).toISOString());

function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

// Wall-clock date/time in a timezone -> UTC (same method as src/lib/appointments.ts).
function offsetMinutes(utcMs, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]),
  );
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs) / 60_000);
}
// `businessDays` counts weekdays only, so demo meetings land Mon-Fri like the
// booking page (e.g. +1 on a Friday means Monday).
function localDayToUtc(businessDays, time, timeZone) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [y, m, d] = today.split("-").map(Number);
  const isWeekend = (offset) => [0, 6].includes(new Date(Date.UTC(y, m - 1, d + offset)).getUTCDay());
  let offset = 0;
  for (let counted = 0; counted < Math.abs(businessDays); ) {
    offset += Math.sign(businessDays);
    if (!isWeekend(offset)) counted++;
  }
  const [hh, mm] = time.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d + offset, hh, mm);
  let utc = naive - offsetMinutes(naive, timeZone) * 60_000;
  utc = naive - offsetMinutes(utc, timeZone) * 60_000;
  return new Date(utc);
}

async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

// ---------------------------------------------------------------------------
// 1. Wipe previous demo data (only the demo accounts and their workspaces)
// ---------------------------------------------------------------------------
const demoEmails = new Set(WORKSPACES.flatMap((w) => w.people.map((p) => p.email)));
const existing = (await listAllUsers()).filter((u) => demoEmails.has(u.email));
if (existing.length) {
  const rows = must(await db.from("users").select("tenant_id").in("id", existing.map((u) => u.id)), "find demo tenants");
  const tenantIds = [...new Set(rows.map((r) => r.tenant_id))];
  for (const u of existing) must(await db.auth.admin.deleteUser(u.id), `delete ${u.email}`);
  if (tenantIds.length) must(await db.from("tenants").delete().in("id", tenantIds), "delete demo tenants");
  console.log(`Removed previous demo data: ${existing.length} users, ${tenantIds.length} workspaces`);
}

// ---------------------------------------------------------------------------
// 2. Create the workspaces
// ---------------------------------------------------------------------------
const credentials = [];
for (const ws of WORKSPACES) {
  const ids = {};
  const [owner, ...team] = ws.people;

  // The owner signs up; the sign-up trigger creates the workspace.
  const ownerPassword = password();
  const created = must(await db.auth.admin.createUser({
    email: owner.email, password: ownerPassword, email_confirm: true,
    user_metadata: { full_name: owner.name, company_name: ws.company },
  }), `create ${owner.email}`);
  ids[owner.key] = created.user.id;
  credentials.push({ ws: ws.company, ...owner, password: ownerPassword });
  const { tenant_id: tenantId } = must(await db.from("users").select("tenant_id").eq("id", created.user.id).single(), "owner tenant");
  const { slug } = must(await db.from("tenants").select("slug").eq("id", tenantId).single(), "tenant slug");

  // Teammates join through invitations, like real users.
  for (const person of team) {
    const invite = must(await db.from("invitations").insert({ tenant_id: tenantId, email: person.email, role: person.role, invited_by: ids[owner.key] }).select("token").single(), `invite ${person.email}`);
    const pw = password();
    const u = must(await db.auth.admin.createUser({
      email: person.email, password: pw, email_confirm: true,
      user_metadata: { full_name: person.name, invite_token: invite.token },
    }), `create ${person.email}`);
    ids[person.key] = u.user.id;
    credentials.push({ ws: ws.company, ...person, password: pw });
  }
  for (const inv of ws.pendingInvites) {
    must(await db.from("invitations").insert({ tenant_id: tenantId, email: inv.email, role: inv.role, invited_by: ids[owner.key] }), `invite ${inv.email}`);
  }

  // Plan. Pro here is demo state only: there is no Stripe subscription behind it.
  if (ws.plan === "pro") {
    must(await db.from("tenants").update({ plan: "pro" }).eq("id", tenantId), "set plan");
    must(await db.from("billing").upsert({ tenant_id: tenantId, subscription_status: "active", current_period_end: new Date(Date.now() + 23 * DAY).toISOString() }), "billing");
  }

  must(await db.from("booking_settings").update({
    ...ws.booking, days: [1, 2, 3, 4, 5], start_time: "09:00", end_time: "17:00", slot_minutes: 30, min_notice_hours: 12, horizon_days: 21,
  }).eq("tenant_id", tenantId), "booking settings");

  // Leads (scores are computed by the database from these fields).
  const leadRows = must(await db.from("leads").insert(ws.leads.map((l) => ({
    tenant_id: tenantId, name: l.name, company: l.company, email: l.email,
    budget_usd: l.budget, company_size: l.size, source: l.source, status: l.status,
    owner_id: l.owner ? ids[l.owner] : null, last_engaged_at: ago(l.engaged), notes: l.notes ?? null,
    created_by: ids[owner.key],
  }))).select("id, name, email"), "leads");
  const leadByName = new Map(leadRows.map((l) => [l.name, l]));

  // Appointments, placed on real slots in the workspace's timezone.
  const appts = ws.appointments.map((a) => {
    const lead = leadByName.get(a.lead);
    const start = localDayToUtc(a.day, a.time, ws.booking.timezone);
    return {
      tenant_id: tenantId, lead_id: lead.id, name: lead.name, email: lead.email,
      starts_at: start.toISOString(), ends_at: new Date(start.getTime() + a.minutes * 60_000).toISOString(),
      source: a.source, status: a.status, notes: a.notes ?? null, created_by: a.by ? ids[a.by] : null,
    };
  });
  if (appts.length) must(await db.from("appointments").insert(appts), "appointments");

  const scored = must(await db.from("leads_scored").select("tier").eq("tenant_id", tenantId), "scores");
  const tiers = { hot: 0, warm: 0, cold: 0 };
  scored.forEach((s) => tiers[s.tier]++);
  console.log(`${ws.company} (${ws.plan}): ${ws.people.length} people, ${ws.leads.length} leads (${tiers.hot} hot / ${tiers.warm} warm / ${tiers.cold} cold), ${appts.length} appointments, booking page /book/${slug}`);
  ws.slug = slug;
}

// ---------------------------------------------------------------------------
// 3. Credentials file (gitignored). Passwords never go to stdout.
// ---------------------------------------------------------------------------
const lines = [
  "# TenantFlow demo logins",
  "",
  `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by \`npm run seed\`. Re-running the seed replaces these.`,
  "Local file only (gitignored). Rotate by re-running the seed.",
  "",
  "| Workspace | Role | Name | Email | Password |",
  "|---|---|---|---|---|",
  ...credentials.map((c) => `| ${c.ws} | ${c.role} | ${c.name} | ${c.email} | \`${c.password}\` |`),
  "",
  "Public booking pages:",
  ...WORKSPACES.map((w) => `- ${w.company}: ${SITE}/book/${w.slug}`),
  "",
];
writeFileSync(".demo-credentials.local.md", lines.join("\n"));
console.log(`\n${credentials.length} demo logins written to .demo-credentials.local.md (not printed here).`);
