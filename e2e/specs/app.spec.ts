import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "GearTractor!2026";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button[type=submit]")]);
}

test("rejects bad credentials with a friendly message", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "dj@geartractor.app");
  await page.fill("#password", "wrong-password");
  await page.click("button[type=submit]");
  await expect(page.getByText("Unable to sign in")).toBeVisible();
});

test("dashboard shows the three primary actions and live data", async ({ page }) => {
  await login(page, "dj@geartractor.app");
  await expect(page.getByRole("heading", { name: "DJ Fernandez" })).toBeVisible();
  await expect(page.getByText(/active sessions?/).first()).toBeVisible();
  for (const name of [/Check Out Gear/i, /Reserve Gear/i, /Check In Gear/i]) {
    await expect(page.getByRole("link", { name }).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Active Sessions" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("full checkout and check-in", async ({ page }) => {
  await login(page, "dj@geartractor.app");
  await page.goto("/checkouts/new");
  await page.fill("#event", `E2E Session ${Date.now()}`);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("radio", { name: /DJ Fernandez/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("radio", { name: /Main Warehouse/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByPlaceholder("Search by ID, name or tech spec").fill("Harness 4");
  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await expect(page.getByText(/added/).first()).toBeVisible();
  await page.getByRole("button", { name: /Review/ }).first().click();
  await page.getByRole("button", { name: /Confirm Checkout/ }).click();
  await expect(page.getByRole("heading", { name: "Checkout completed" })).toBeVisible();
  await page.getByRole("link", { name: /View session/ }).click();
  await page.getByRole("link", { name: /Check In/ }).first().click();
  await page.getByRole("button", { name: /Check in/ }).last().click();
  await expect(page.getByRole("heading", { name: "Equipment returned" })).toBeVisible();
});

test("blocked equipment explains why", async ({ page }) => {
  await login(page, "dj@geartractor.app");
  await page.goto("/checkouts/new");
  await page.fill("#event", "Blocked check");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("radio", { name: /Main Warehouse/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByPlaceholder("Search by ID, name or tech spec").fill("Helmet 5");
  await expect(page.getByText(/cannot be checked out because its annual inspection is overdue/)).toBeVisible();
});

test("trainers cannot reach admin pages", async ({ page }) => {
  await login(page, "sam@geartractor.app");
  await page.goto("/users");
  await expect(page).toHaveURL(/dashboard\?denied=1/);
});

test("tenants are isolated", async ({ page }) => {
  await login(page, "admin@tegnol.agency");
  await page.goto("/inventory?q=Chainsaw");
  await expect(page.locator("main p", { hasText: "No matching inventory" })).toBeVisible();
});
