import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

// 1. A visitor signs up through the real form: the database provisions a new
//    workspace and makes them its owner, and they land on the dashboard.
test("sign up creates a new workspace and lands on the dashboard as Owner", async ({ page }) => {
  const id = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const workspace = `E2E Signup ${id}`;

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await page.getByLabel("Full name").fill("Erin Signup");
  await page.getByLabel("Workspace name").fill(workspace);
  await page.getByLabel("Work email").fill(`signup-${id}@e2e.example`);
  await page.getByLabel("Password").fill(`E2e-${randomBytes(12).toString("base64url")}`);
  await page.getByRole("button", { name: "Create workspace" }).click();

  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome back, Erin" })).toBeVisible();
  await expect(page.getByText(`You're working in ${workspace}.`)).toBeVisible();

  // The sidebar shows the new workspace with the Owner role on the Free plan.
  const sidebar = page.locator("aside");
  await expect(sidebar.getByText(workspace, { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Owner", { exact: true })).toBeVisible();
  await expect(sidebar.getByText("Free plan")).toBeVisible();

  // A brand-new workspace has exactly one member: its owner.
  await page.locator("aside nav").getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
  await expect(page.getByText(`1 person in ${workspace}.`)).toBeVisible();
  // Owners can invite.
  await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
});
