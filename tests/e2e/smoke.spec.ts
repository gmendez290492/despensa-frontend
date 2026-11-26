import { expect, test } from "@playwright/test";

test("sin sesión, / redirige a /login y expone el manifest PWA", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: /Bienvenido de vuelta a tu despensa/i }),
  ).toBeVisible();

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
});
