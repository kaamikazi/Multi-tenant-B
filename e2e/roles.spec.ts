import { expect, test } from "@playwright/test";
import { storageStateFor } from "./support/fixtures";

// 3. Roles: what a member can and cannot reach, with the owner as a control so
//    the "absent" checks can't pass just because the page failed to render.
test.describe("member role", () => {
  test.use({ storageState: storageStateFor("memberA") });

  test("has no Billing nav item, and /settings/billing redirects with a notice", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.locator("aside nav");
    await expect(nav.getByRole("link", { name: "Team" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Billing" })).toHaveCount(0);
    await expect(page.locator("aside").getByText("Member", { exact: true })).toBeVisible();

    await page.goto("/settings/billing");
    await expect(page).toHaveURL(/\/dashboard\?denied=1$/);
    await expect(page.getByText("Your role doesn't have access to that page.")).toBeVisible();
  });

  test("Team page lists members but has no invite form", async ({ page }) => {
    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
    await expect(page.getByText("Alpha Owner")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invite a teammate" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pending invitations" })).toHaveCount(0);
  });
});

test.describe("owner role (control)", () => {
  test.use({ storageState: storageStateFor("ownerA") });

  test("sees Billing and the invite form", async ({ page }) => {
    await page.goto("/dashboard");
    await page.locator("aside nav").getByRole("link", { name: "Billing" }).click();
    await expect(page).toHaveURL(/\/settings\/billing$/);
    await expect(page.getByRole("heading", { name: "Billing", exact: true })).toBeVisible();
    // No Stripe keys in CI: billing runs as a read-only demo.
    await expect(page.getByText(/Stripe keys aren't configured|Stripe runs in test mode/)).toBeVisible();

    await page.goto("/settings/team");
    await expect(page.getByRole("heading", { name: "Invite a teammate" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send invite" })).toBeVisible();
  });
});
