import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test as setup } from "@playwright/test";
import type { Database } from "../src/lib/supabase/database.types";
import { AUTH_DIR, FIXTURES_FILE, storageStateFor, type Fixtures, type Workspace } from "./support/fixtures";

// Creates the data the specs need through the same paths real users take:
//   - each owner is created with sign-up metadata, so the database's sign-up
//     trigger provisions their workspace (exactly what /signup does);
//   - the member joins workspace A through an invitation token;
//   - each user then signs in through the real login form, and the browser
//     state (session cookies) is saved for the specs.
// Every run uses fresh, uniquely named accounts on the reserved .example
// domain. Passwords are random, kept in memory only and never printed.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

setup("create throwaway workspaces and sign their users in", async ({ browser }) => {
  if (!url || !secret) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY to a LOCAL Supabase stack (npx supabase status -o env).",
    );
  }
  // This creates accounts with the service key, so only ever against a local stack.
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`Refusing to create e2e fixtures on ${host}: the e2e suite only runs against a local Supabase stack.`);
  }

  const db = createClient<Database>(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const must = <T>({ data, error }: { data: T; error: { message: string } | null }, what: string): NonNullable<T> => {
    if (error || data == null) throw new Error(`${what}: ${error?.message ?? "no data"}`);
    return data;
  };
  // Confirmed straight away, as on the local stack (email confirmations off).
  async function createUser(email: string, pw: string, metadata: Record<string, string>) {
    const { data, error } = await db.auth.admin.createUser({ email, password: pw, email_confirm: true, user_metadata: metadata });
    if (error || !data.user) throw new Error(`create ${email}: ${error?.message ?? "no user"}`);
    return data.user;
  }

  const runId = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const password = () => `E2e-${randomBytes(12).toString("base64url")}`;
  const users: { key: "ownerA" | "memberA" | "ownerB"; email: string; password: string }[] = [];

  async function createWorkspace(label: string, key: "ownerA" | "ownerB"): Promise<Workspace & { tenantId: string; ownerId: string }> {
    const name = `E2E ${label} ${runId}`;
    const email = `owner-${label.toLowerCase()}-${runId}@e2e.example`;
    const pw = password();
    const owner = await createUser(email, pw, { full_name: `${label} Owner`, company_name: name });
    users.push({ key, email, password: pw });
    const ownerId = owner.id;
    const { tenant_id: tenantId } = must(await db.from("users").select("tenant_id").eq("id", ownerId).single(), `${label} tenant`);
    const { slug } = must(await db.from("tenants").select("slug").eq("id", tenantId).single(), `${label} slug`);

    const leadName = `${label} Lead ${runId}`;
    const lead = must(
      await db
        .from("leads")
        .insert({ tenant_id: tenantId, name: leadName, company: `${label} Corp`, source: "referral", created_by: ownerId })
        .select("id")
        .single(),
      `${label} lead`,
    );
    return { name, slug, leadId: lead.id, leadName, tenantId, ownerId };
  }

  const alpha = await createWorkspace("Alpha", "ownerA");
  const bravo = await createWorkspace("Bravo", "ownerB");

  // A member joins Alpha through an invitation, like a real teammate.
  const memberEmail = `member-alpha-${runId}@e2e.example`;
  const invite = must(
    await db
      .from("invitations")
      .insert({ tenant_id: alpha.tenantId, email: memberEmail, role: "member", invited_by: alpha.ownerId })
      .select("token")
      .single(),
    "invite member",
  );
  const memberPassword = password();
  await createUser(memberEmail, memberPassword, { full_name: "Alpha Member", invite_token: invite.token });
  users.push({ key: "memberA", email: memberEmail, password: memberPassword });
  const { role } = must(await db.from("users").select("role, tenant_id").eq("email", memberEmail).single(), "member row");
  expect(role).toBe("member");

  mkdirSync(AUTH_DIR, { recursive: true });
  const fixtures: Fixtures = {
    runId,
    alpha: { name: alpha.name, slug: alpha.slug, leadId: alpha.leadId, leadName: alpha.leadName },
    bravo: { name: bravo.name, slug: bravo.slug, leadId: bravo.leadId, leadName: bravo.leadName },
  };
  writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));

  // Sign each user in through the real login form and keep the session.
  for (const user of users) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
    await expect(page.getByRole("heading", { name: /Welcome back/ })).toBeVisible();
    await context.storageState({ path: storageStateFor(user.key) });
    await context.close();
  }
});
