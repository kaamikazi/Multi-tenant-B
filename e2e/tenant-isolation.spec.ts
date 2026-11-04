import { expect, test } from "@playwright/test";
import { loadFixtures, storageStateFor } from "./support/fixtures";

// 2. Tenant isolation through the real UI: workspace A's owner never sees
//    workspace B's leads, not in the list and not by opening B's lead URL.
test.describe("tenant isolation", () => {
  test.use({ storageState: storageStateFor("ownerA") });

  test("workspace A's leads list shows A's lead and not B's", async ({ page }) => {
    const { alpha, bravo } = loadFixtures();
    await page.goto("/leads?view=all");
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
    await expect(page.getByRole("link", { name: alpha.leadName })).toBeVisible();
    await expect(page.getByText(bravo.leadName)).toHaveCount(0);
  });

  test("opening workspace B's lead URL directly shows not found", async ({ page }) => {
    const { alpha, bravo } = loadFixtures();

    // Control: A's own lead opens normally.
    await page.goto(`/leads/${alpha.leadId}`);
    await expect(page.getByRole("heading", { name: alpha.leadName })).toBeVisible();

    // B's lead id is real, but RLS hides it from A: the page 404s.
    const response = await page.goto(`/leads/${bravo.leadId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("This page could not be found.")).toBeVisible();
    await expect(page.getByText(bravo.leadName)).toHaveCount(0);
    await expect(page.getByText("Bravo Corp")).toHaveCount(0);
  });
});

test.describe("tenant isolation (reverse direction)", () => {
  test.use({ storageState: storageStateFor("ownerB") });

  test("workspace B cannot see workspace A's lead either", async ({ page }) => {
    const { alpha, bravo } = loadFixtures();
    await page.goto("/leads?view=all");
    await expect(page.getByRole("link", { name: bravo.leadName })).toBeVisible();
    await expect(page.getByText(alpha.leadName)).toHaveCount(0);

    const response = await page.goto(`/leads/${alpha.leadId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText(alpha.leadName)).toHaveCount(0);
  });
});
