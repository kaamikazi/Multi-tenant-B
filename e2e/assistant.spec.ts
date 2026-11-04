import { expect, test } from "@playwright/test";
import { storageStateFor } from "./support/fixtures";

// 6. With no GEMINI_API_KEY on the server (as in CI), the assistant page
//    still renders, explains why it's unavailable and accepts no input; the
//    chat API refuses with 503 rather than failing obscurely.
test.use({ storageState: storageStateFor("ownerA") });

test("the assistant page renders and explains it isn't configured", async ({ page }) => {
  test.skip(Boolean(process.env.GEMINI_API_KEY), "GEMINI_API_KEY is set for this run");

  await page.goto("/assistant");
  await expect(page.getByRole("heading", { name: "Assistant", exact: true })).toBeVisible();
  await expect(page.getByText("Demo: the assistant needs a GEMINI_API_KEY on the server.")).toBeVisible();
  await expect(page.getByLabel("Message")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();

  const response = await page.request.post("/api/chat", { data: { message: "Who are my hottest leads?" } });
  expect(response.status()).toBe(503);
  expect((await response.json()).error).toBe("The assistant isn't configured.");
});
