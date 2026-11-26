import { expect, test } from "@playwright/test";

test("renderiza la pantalla base de Despensa y expone el manifest PWA", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /Control inteligente de tu despensa/i,
    }),
  ).toBeVisible();

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
});
