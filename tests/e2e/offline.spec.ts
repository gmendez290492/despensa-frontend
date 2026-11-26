import { expect, test } from "@playwright/test";

/*
 * Requiere build de producción (el SW solo se registra con NODE_ENV=production):
 *   pnpm build && pnpm start   # en otra terminal
 *   PWA_E2E=1 pnpm test:e2e tests/e2e/offline.spec.ts
 * Con `pnpm dev` (webServer por defecto) no hay Service Worker y se omite.
 */
test.skip(!process.env.PWA_E2E, "Requiere `pnpm build && pnpm start` y PWA_E2E=1");

async function waitForServiceWorker(page: import("@playwright/test").Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Tras `clientsClaim` el SW controla la página en la siguiente navegación.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test("sin red, /login abre desde caché con la pill 'Sin conexión' y submit deshabilitado", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.goto("/login?next=%2F");

  await expect(
    page.getByRole("heading", { name: /Bienvenido de vuelta a tu despensa/i }),
  ).toBeVisible();
  await expect(page.getByText("Sin conexión")).toBeVisible();
  await expect(page.getByRole("button", { name: /iniciar sesión/i })).toBeDisabled();
});

test("al reconectar, el submit de /login se rehabilita y el login funciona", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // Usuario de prueba creado por el BFF en un contexto HTTP aislado (sus
  // cookies no llegan al navegador, así /login no redirige a /).
  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  const email = `qa+offline${Date.now()}@despensa-qa.com`;
  const password = "PanDeMasaMadre$24";
  const registered = await request.post("/api/bff/auth/register", {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: { full_name: "QA Offline", email, password, timezone: "UTC", alert_days_before: 3 },
  });
  expect(registered.status()).toBe(201);

  await page.goto("/login");
  await waitForServiceWorker(page);

  await page.getByLabel("Correo electrónico").filter({ visible: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).filter({ visible: true }).fill(password);
  const submit = page.getByRole("button", { name: /iniciar sesión/i });

  await context.setOffline(true);
  await expect(page.getByText("Sin conexión")).toBeVisible();
  await expect(submit).toBeDisabled();

  await context.setOffline(false);
  await expect(page.getByText("Sin conexión")).toHaveCount(0);
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Hola, QA Offline" })).toBeVisible();
});

test("sin red, una ruta protegida muestra el fallback /offline y nunca HTML cacheado", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Sin conexión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByText(/Hola,/)).toHaveCount(0);
});
