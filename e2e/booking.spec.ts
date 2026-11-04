import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loadFixtures } from "./support/fixtures";

// 4. Public booking as an anonymous visitor (no session): book a slot, land on
//    the private manage link, cancel, and see the slot offered again.
// Stays well inside the per-IP limits (a handful of page views, one booking,
// one cancellation).

/** The `slot` values of the time links shown for the selected day. */
async function visibleSlots(page: Page): Promise<string[]> {
  const hrefs = await page.locator('a[href*="slot="]').evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  return hrefs.map((href) => new URL(href, "http://x").searchParams.get("slot") ?? "");
}

test("an anonymous visitor books a slot, cancels it, and the slot reopens", async ({ page }) => {
  const { alpha } = loadFixtures();
  const id = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

  await page.goto(`/book/${alpha.slug}`);
  await expect(page.getByText(alpha.name)).toBeVisible();
  const firstSlot = page.locator('a[href*="slot="]').first();
  await expect(firstSlot).toBeVisible();

  const href = (await firstSlot.getAttribute("href"))!;
  const params = new URL(href, "http://x").searchParams;
  const day = params.get("date")!;
  const slot = params.get("slot")!;

  await firstSlot.click();
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await page.getByLabel("Your name").fill(`Visitor ${id}`);
  await page.getByLabel("Email").fill(`visitor-${id}@e2e.example`);
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await page.waitForURL(/\/book\/manage\/[^/?]+\?new=1$/);
  const manageUrl = new URL(page.url());
  await expect(page.getByText("You're booked!")).toBeVisible();
  await expect(page.getByText(`Visitor ${id}`)).toBeVisible();
  await expect(page.getByText("Confirmed")).toBeVisible();

  // While booked, the slot is no longer offered to anyone.
  await page.goto(`/book/${alpha.slug}?date=${encodeURIComponent(day)}`);
  await expect(page.locator('a[href*="slot="]').first()).toBeVisible();
  expect(await visibleSlots(page)).not.toContain(slot);

  // Cancel through the private manage link.
  await page.goto(manageUrl.pathname);
  await page.getByRole("button", { name: "Cancel this booking" }).click();
  await page.waitForURL(/\?cancelled=1$/);
  await expect(page.getByText("Your booking has been cancelled.")).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel this booking" })).toHaveCount(0);

  // The slot is available again.
  await page.goto(`/book/${alpha.slug}?date=${encodeURIComponent(day)}`);
  await expect(page.locator('a[href*="slot="]').first()).toBeVisible();
  expect(await visibleSlots(page)).toContain(slot);
});
