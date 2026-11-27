import { expect, test } from "@playwright/test";

/**
 * Flujo completo registro -> home -> logout -> login contra el backend real
 * (FastAPI). Se omite si `BACKEND_API_URL` no responde.
 */
const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";

async function backendIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_API_URL}/docs`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

test.describe("auth", () => {
  test.beforeAll(async () => {
    test.skip(!(await backendIsUp()), `Backend no disponible en ${BACKEND_API_URL}`);
  });

  test("registro -> home -> logout -> login", async ({ page }, testInfo) => {
    // FastAPI rechaza dominios `.local`: usar un dominio con TLD real.
    const email = `qa+${Date.now()}-${testInfo.project.name.replace(/\W+/g, "")}@despensa-qa.com`;
    const password = "PanDeMasaMadre$24";

    await page.goto("/registro");
    await expect(page.getByRole("heading", { name: /Abre tu cuaderno de despensa/i })).toBeVisible();
    await expect(page.getByText("(detectada automáticamente)")).toBeVisible();

    await page.getByLabel("Nombre completo").filter({ visible: true }).fill("Ana QA");
    await page.getByLabel("Correo electrónico").filter({ visible: true }).fill(email);
    await page.getByLabel("Contraseña", { exact: true }).filter({ visible: true }).fill(password);
    await page.getByLabel("Confirmar contraseña").filter({ visible: true }).fill(password);
    await page.getByRole("button", { name: /crear cuenta/i }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Hola, Ana", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /cerrar sesión/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Credenciales incorrectas -> banner terracota.
    await page.getByLabel("Correo electrónico").filter({ visible: true }).fill(email);
    await page.getByLabel("Contraseña", { exact: true }).filter({ visible: true }).fill("incorrecta-123");
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Correo o contraseña incorrectos/ })).toBeVisible();

    await page.getByLabel("Contraseña", { exact: true }).filter({ visible: true }).fill(password);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Hola, Ana", { exact: true })).toBeVisible();
  });

  test("registro con correo existente muestra error inline", async ({ page }, testInfo) => {
    const email = `qa+dup${Date.now()}-${testInfo.project.name.replace(/\W+/g, "")}@despensa-qa.com`;
    const password = "PanDeMasaMadre$24";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.context().clearCookies();
      await page.goto("/registro");
      await page.getByLabel("Nombre completo").filter({ visible: true }).fill("Ana QA");
      await page.getByLabel("Correo electrónico").filter({ visible: true }).fill(email);
      await page.getByLabel("Contraseña", { exact: true }).filter({ visible: true }).fill(password);
      await page.getByLabel("Confirmar contraseña").filter({ visible: true }).fill(password);
      await page.getByRole("button", { name: /crear cuenta/i }).click();
      if (attempt === 0) await expect(page).toHaveURL(/\/$/);
    }

    await expect(page.getByText(/Este correo ya está registrado/)).toBeVisible();
    await expect(page.getByRole("link", { name: /quieres iniciar sesión/i })).toBeVisible();
  });
});
