import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";

/**
 * Helpers de siembra para E2E de seguridad: crean usuarios y datos de
 * despensa **a través del BFF** (igual que un navegador), nunca contra
 * FastAPI directamente, para ejercitar las mismas defensas que la UI.
 */

/** URL de FastAPI (solo para saber si está levantado). */
export const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:8000";

/** Contraseña válida para la política de FastAPI. */
export const QA_PASSWORD = "PanDeMasaMadre$24";

/** `true` si FastAPI responde; los specs se omiten si no. */
export async function backendIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_API_URL}/docs`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Cabeceras de una mutación legítima del mismo origen. */
export function sameOriginHeaders(baseURL: string): Record<string, string> {
  return { Origin: new URL(baseURL).origin, "Content-Type": "application/json" };
}

/** Email único (FastAPI rechaza `.local`; se usa un TLD real). */
export function uniqueEmail(tag: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  // El tag puede traer el nombre del proyecto Playwright ("Desktop Chrome"): solo [a-z0-9-].
  const safeTag = tag.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `qa+sec-${safeTag}-${Date.now()}-${random}@despensa-qa.com`;
}

/** POST al BFF que exige el status esperado y devuelve el JSON. */
export async function bffPost<T>(
  request: APIRequestContext,
  baseURL: string,
  path: string,
  data: unknown,
  expected = 201,
): Promise<T> {
  const response = await request.post(path, { headers: sameOriginHeaders(baseURL), data });
  expect(response.status(), `${path}: ${await response.text()}`).toBe(expected);
  return (await response.json()) as T;
}

/**
 * Registra un usuario con el contexto dado (las cookies `HttpOnly` quedan en
 * ese contexto).
 *
 * @returns El email registrado.
 */
export async function registerUser(
  request: APIRequestContext,
  baseURL: string,
  tag: string,
  fullName = "QA Seguridad",
): Promise<string> {
  const email = uniqueEmail(tag);
  await bffPost(request, baseURL, "/api/bff/auth/register", {
    full_name: fullName,
    email,
    password: QA_PASSWORD,
    timezone: "UTC",
    alert_days_before: 3,
  });
  return email;
}

/** Datos sembrados por {@link seedPantry}. */
export interface PantrySeed {
  pantryId: string;
  inviteCode: string;
  locationId: string;
  productId: string;
  productName: string;
  batchId: string;
}

/**
 * Crea hogar + ubicación + producto + lote para el usuario del contexto.
 *
 * @param options.productName - Nombre (útil para payloads XSS).
 * @param options.quantity - Cantidad inicial del lote (decimal como string).
 * @param options.daysToExpire - Días hasta la caducidad (≤ 7 → aparece en "Prioridad").
 */
export async function seedPantry(
  request: APIRequestContext,
  baseURL: string,
  options: { productName?: string; quantity?: string; daysToExpire?: number } = {},
): Promise<PantrySeed> {
  const pantry = await bffPost<{ id: string; invite_code: string }>(request, baseURL, "/api/bff/pantries", {
    name: `Casa QA ${Date.now()}`,
  });
  const location = await bffPost<{ id: string }>(
    request,
    baseURL,
    `/api/bff/pantries/${pantry.id}/locations`,
    { name: "Nevera QA" },
  );
  const categories = (await (await request.get("/api/bff/categories")).json()) as { id: string }[];
  expect(categories.length, "categorías semilla").toBeGreaterThan(0);

  const productName = options.productName ?? `Leche QA ${Date.now()}`;
  const product = await bffPost<{ id: string }>(request, baseURL, "/api/bff/products", {
    category_id: categories[0]!.id,
    name: productName,
    base_unit_code: "l",
    estimated_shelf_life_days: 7,
  });

  const days = options.daysToExpire ?? 2;
  const expiration = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const batch = await bffPost<{ id: string }>(request, baseURL, `/api/bff/pantries/${pantry.id}/batches`, {
    location_id: location.id,
    product_id: product.id,
    unit_code: "l",
    quantity: options.quantity ?? "2",
    expiration_date: expiration,
  });

  return {
    pantryId: pantry.id,
    inviteCode: pantry.invite_code,
    locationId: location.id,
    productId: product.id,
    productName,
    batchId: batch.id,
  };
}

/**
 * Contexto HTTP aislado (otro "navegador"/usuario) con su propio tarro de cookies.
 *
 * @param baseURL - Origen de la app.
 */
export function newIsolatedRequest(baseURL: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL });
}
