import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BACKEND_API_URL, backendIsUp, registerUser, seedPantry, type PantrySeed } from "./support/seed";

/*
 * Consumo FEFO sin red (patrón Client Outbox) contra el backend real.
 *
 * No necesita Service Worker: la página ya está cargada cuando se corta la red
 * (`context.setOffline` hace fallar `fetch` y pone `navigator.onLine=false`).
 * Recargar una ruta protegida sin red muestra `/offline` (decisión de
 * seguridad del SW), así que el escenario nunca recarga estando offline.
 *
 *   BACKEND_API_URL=http://localhost:8000 pnpm test:e2e tests/e2e/offline-consume.spec.ts
 *
 * FastAPI debe arrancar con los límites de rate limit altos (ver
 * docs/FRONTEND_CONTEXT.md §2 "Issue #4").
 *
 * Selectores que la UI debe exponer (por rol/texto, sin data-testid):
 * - Botón "Consumir <producto>" en la tarjeta del lote (nombre accesible
 *   "Consumir Leche…").
 * - `<dialog>` con encabezado "Registrar consumo", `<select>` con etiqueta
 *   "Producto", campo "Cantidad (<unidad>)" y botón "Registrar consumo".
 * - Región `role="status"` con "N cambio(s) pendiente(s) de sincronizar." y la
 *   pill "Sin conexión" / estado de conexión.
 * - Sección "Cambios con conflicto" con el `detail` del servidor y el botón
 *   "Descartar <label>".
 * - El texto de cantidad del lote (`formatQuantity`, p. ej. "1,5 l").
 */

/** Ruta del panel de inventario (ajústala si la UI lo monta en otra ruta). */
const PANTRY_PATH = process.env.PANTRY_E2E_PATH ?? "/";

/**
 * Registra un usuario y siembra hogar + ubicación + producto + lote (2 l, vence
 * en 5 días) mediante el BFF con los helpers compartidos. `page.request`
 * comparte cookies con el navegador, así la página queda autenticada.
 *
 * El email y el nombre del producto llevan el proyecto de Playwright y un
 * sufijo aleatorio: los proyectos corren en paralelo contra el mismo FastAPI
 * y un email repetido daría `409`.
 */
async function seed(request: APIRequestContext, baseURL: string, tag: string): Promise<PantrySeed> {
  const unique = `${tag}-${test.info().project.name}-${Math.random().toString(36).slice(2, 8)}`;
  await registerUser(request, baseURL, `consume-${unique}`, "QA Consumo");
  return seedPantry(request, baseURL, {
    productName: `Leche QA ${unique}`,
    quantity: "2",
    daysToExpire: 5,
  });
}

async function consumeFromUi(page: Page, productName: string, quantity: string) {
  await page.getByRole("button", { name: new RegExp(`Consumir ${productName}`) }).first().click();
  const dialog = page.getByRole("dialog", { name: "Registrar consumo" });
  await expect(dialog).toBeVisible();
  // La opción muestra "<producto> — <disponible>": se elige por su valor.
  const value = await dialog.locator("option", { hasText: productName }).first().getAttribute("value");
  await dialog.getByLabel("Producto").selectOption(value ?? "");
  await dialog.getByLabel(/Cantidad/).fill(quantity);
  await dialog.getByRole("button", { name: "Registrar consumo" }).click();
  await expect(dialog).toBeHidden();
}

test.describe("consumo FEFO offline", () => {
  test.beforeAll(async () => {
    test.skip(!(await backendIsUp()), `Backend no disponible en ${BACKEND_API_URL}`);
  });

  test("consumir sin red queda pendiente y se sincroniza al reconectar", async ({ page, context, baseURL }) => {
    const data = await seed(page.request, baseURL ?? "http://localhost:3000", "sync");
    await page.goto(PANTRY_PATH);
    await expect(page.getByText(data.productName).first()).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByText("Sin conexión").first()).toBeVisible();

    await consumeFromUi(page, data.productName, "0,5");

    // Optimista inmediato + aviso de pendiente.
    await expect(page.getByRole("status").filter({ hasText: /1 cambio pendiente de sincronizar/ })).toBeVisible();
    await expect(page.getByText(/1,5 l/).first()).toBeVisible();

    await context.setOffline(false);

    // Se drena la outbox: desaparece el aviso y el servidor confirma 1,5 l.
    await expect(page.getByText(/cambios? pendientes? de sincronizar/)).toHaveCount(0, { timeout: 15_000 });
    const batches = (await (await page.request.get(`/api/bff/pantries/${data.pantryId}/batches`)).json()) as {
      product_id: string;
      current_quantity: string;
    }[];
    const mine = batches.filter((batch) => batch.product_id === data.productId);
    expect(mine.map((batch) => Number(batch.current_quantity))).toEqual([1.5]);

    // Tras recargar con red, la verdad del servidor coincide con el optimista.
    await page.reload();
    await expect(page.getByText(/1,5 l/).first()).toBeVisible();
  });

  test("si otro miembro agotó el stock, al reconectar queda en conflicto insufficient-stock", async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    const data = await seed(page.request, baseURL ?? "http://localhost:3000", "conflict");
    await page.goto(PANTRY_PATH);
    await expect(page.getByText(data.productName).first()).toBeVisible();

    await context.setOffline(true);
    await consumeFromUi(page, data.productName, "1,5");
    await expect(page.getByRole("status").filter({ hasText: /1 cambio pendiente/ })).toBeVisible();

    // "Otro miembro" consume todo mientras este dispositivo está sin red
    // (`page.request` no está sujeto a `setOffline`).
    const other = await page.request.post(`/api/bff/pantries/${data.pantryId}/consume`, {
      headers: { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      data: { product_id: data.productId, quantity: "2" },
    });
    expect(other.ok(), await other.text()).toBe(true);

    await context.setOffline(false);

    const conflicts = page.getByRole("region", { name: "Cambios con conflicto" });
    await expect(conflicts).toBeVisible({ timeout: 15_000 });
    await expect(conflicts.getByText(/Stock insuficiente/i)).toBeVisible();
    await expect(page.getByText(/cambios? pendientes? de sincronizar/)).toHaveCount(0);

    // Nada se pierde en silencio: el conflicto sobrevive a una recarga…
    await page.reload();
    await expect(page.getByRole("region", { name: "Cambios con conflicto" })).toBeVisible();

    // …hasta que el usuario lo descarta explícitamente.
    await page.getByRole("button", { name: new RegExp(`Descartar ${data.productName}`) }).click();
    await expect(page.getByRole("region", { name: "Cambios con conflicto" })).toHaveCount(0);
  });
});
