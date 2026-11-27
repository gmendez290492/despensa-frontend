import type { components } from "@/lib/api/schema";
import { bffJson } from "@/lib/api/bff-fetch";
import type {
  ConsumePayload,
  CreateLocationInput,
  CreatePantryInput,
  CreateProductInput,
  JoinPantryInput,
} from "@/lib/pantry/schemas";

/**
 * Cliente del navegador para el dominio `pantry`. Todo pasa por el BFF
 * (`/api/bff/*`); los tipos salen de `schema.d.ts` (nunca interfaces manuales).
 */

/** Hogar (despensa) del usuario. */
export type PantryResponse = components["schemas"]["PantryResponse"];
/** Ubicación física dentro de un hogar (nevera, alacena…). */
export type LocationResponse = components["schemas"]["LocationResponse"];
/** Lote con semáforo FEFO calculado por FastAPI. */
export type FoodBatchResponse = components["schemas"]["FoodBatchResponse"];
/** Valor del semáforo FEFO. */
export type Semaforo = FoodBatchResponse["semaforo"];
/** Resultado de `POST /consume`. */
export type ConsumeResultResponse = components["schemas"]["ConsumeResultResponse"];
/** Listado paginado de notificaciones. */
export type NotificationListResponse = components["schemas"]["NotificationListResponse"];
/** Producto del catálogo global. */
export type ProductResponse = components["schemas"]["ProductResponse"];
/**
 * Respuesta agregada del panel (`GET /pantries/{id}/dashboard`): hogares,
 * ubicaciones, lotes FEFO y `unread_notifications`, idénticos a sus endpoints
 * sueltos.
 */
export type PantryDashboardResponse = components["schemas"]["PantryDashboardResponse"];

/** Cabecera de idempotencia que el BFF valida y reenvía a FastAPI. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

function idempotencyHeaders(idempotencyKey: string): Record<string, string> {
  return { [IDEMPOTENCY_HEADER]: idempotencyKey };
}

/** Rutas del BFF del dominio `pantry`. */
export const BFF_PANTRY_ROUTES = {
  pantries: "/api/bff/pantries",
  join: "/api/bff/pantries/join",
  locations: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/locations`,
  batches: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/batches`,
  dashboard: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/dashboard`,
  consume: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/consume`,
  products: "/api/bff/products",
  notifications: "/api/bff/notifications",
} as const;

/**
 * Query keys jerárquicas de TanStack Query: `["pantries", pantryId, recurso]`.
 * `pantryKeys.detail(id)` invalida todo lo de un hogar; `pantryKeys.all`, el
 * dominio entero. La lista vive en `["pantries", "list"]` (nunca choca con un
 * UUID) para que invalidarla no arrastre lotes ni ubicaciones.
 */
export const pantryKeys = {
  all: ["pantries"] as const,
  list: () => ["pantries", "list"] as const,
  detail: (pantryId: string) => ["pantries", pantryId] as const,
  locations: (pantryId: string) => ["pantries", pantryId, "locations"] as const,
  batches: (pantryId: string) => ["pantries", pantryId, "batches"] as const,
  /**
   * Carga agregada del panel. Solo arranca el panel y **siembra** las claves
   * sueltas (`list`, `locations`, `batches`, `unreadNotifications`); la UI lee
   * siempre de esas. Cuelga de `detail(id)`: invalidar el hogar la incluye.
   */
  dashboard: (pantryId: string) => ["pantries", pantryId, "dashboard"] as const,
  unreadNotifications: () => ["notifications", "unread"] as const,
};

/** Query keys del catálogo global de productos (no cuelga de un hogar). */
export const productKeys = {
  all: ["products"] as const,
};

/**
 * `GET /api/bff/pantries`.
 *
 * @returns Hogares del usuario.
 * @throws {ProblemDetailError} Red, `401`, 5xx.
 */
export function fetchPantries(): Promise<PantryResponse[]> {
  return bffJson<PantryResponse[]>(BFF_PANTRY_ROUTES.pantries);
}

/**
 * `POST /api/bff/pantries` con `Idempotency-Key`.
 *
 * @param input - Nombre del hogar (ya validado con `createPantrySchema`).
 * @param idempotencyKey - Clave de la intención del usuario (estable entre reintentos del mismo cuerpo).
 * @returns El hogar creado (FastAPI crea además la ubicación inicial).
 * @throws {ProblemDetailError} `idempotency-request-in-progress`, red, 5xx…
 */
export function createPantryRequest(input: CreatePantryInput, idempotencyKey: string): Promise<PantryResponse> {
  return bffJson<PantryResponse>(BFF_PANTRY_ROUTES.pantries, {
    method: "POST",
    json: input,
    headers: idempotencyHeaders(idempotencyKey),
  });
}

/**
 * `POST /api/bff/pantries/join` con `Idempotency-Key`.
 *
 * @param input - Código de invitación (ya validado con `joinPantrySchema`).
 * @param idempotencyKey - Clave de la intención del usuario (estable entre reintentos del mismo cuerpo).
 * @returns El hogar al que se unió el usuario.
 * @throws {ProblemDetailError} `invalid-invite-code`, `already-pantry-member`, `idempotency-request-in-progress`…
 */
export function joinPantryRequest(input: JoinPantryInput, idempotencyKey: string): Promise<PantryResponse> {
  return bffJson<PantryResponse>(BFF_PANTRY_ROUTES.join, {
    method: "POST",
    json: input,
    headers: idempotencyHeaders(idempotencyKey),
  });
}

/**
 * `GET /api/bff/pantries/{id}/locations`.
 *
 * @param pantryId - Hogar.
 * @returns Ubicaciones del hogar.
 * @throws {ProblemDetailError} `pantry-access-denied`, red, 5xx.
 */
export function fetchLocations(pantryId: string): Promise<LocationResponse[]> {
  return bffJson<LocationResponse[]>(BFF_PANTRY_ROUTES.locations(pantryId));
}

/**
 * `POST /api/bff/pantries/{id}/locations` con `Idempotency-Key`.
 *
 * @param pantryId - Hogar.
 * @param input - Nombre y descripción (ya validados con `createLocationSchema`).
 * @param idempotencyKey - Clave de la intención del usuario (estable entre reintentos del mismo cuerpo).
 * @returns La ubicación creada.
 * @throws {ProblemDetailError} `pantry-access-denied`, `idempotency-request-in-progress`…
 */
export function createLocationRequest(
  pantryId: string,
  input: CreateLocationInput,
  idempotencyKey: string,
): Promise<LocationResponse> {
  return bffJson<LocationResponse>(BFF_PANTRY_ROUTES.locations(pantryId), {
    method: "POST",
    json: input,
    headers: idempotencyHeaders(idempotencyKey),
  });
}

/**
 * `POST /api/bff/products` con `Idempotency-Key`.
 *
 * @param input - Producto (ya validado con `createProductSchema`).
 * @param idempotencyKey - Clave de la intención del usuario (estable entre reintentos del mismo cuerpo).
 * @returns El producto creado.
 * @throws {ProblemDetailError} `unit-not-found`, `idempotency-request-in-progress`, red, 5xx…
 */
export function createProductRequest(input: CreateProductInput, idempotencyKey: string): Promise<ProductResponse> {
  return bffJson<ProductResponse>(BFF_PANTRY_ROUTES.products, {
    method: "POST",
    json: input,
    headers: idempotencyHeaders(idempotencyKey),
  });
}

/**
 * `GET /api/bff/pantries/{id}/batches` (orden FEFO).
 *
 * @param pantryId - Hogar.
 * @returns Lotes con semáforo, en orden FEFO.
 * @throws {ProblemDetailError} `pantry-access-denied`, red, 5xx.
 */
export function fetchBatches(pantryId: string): Promise<FoodBatchResponse[]> {
  return bffJson<FoodBatchResponse[]>(BFF_PANTRY_ROUTES.batches(pantryId));
}

/**
 * `GET /api/bff/pantries/{id}/dashboard`: hogares, ubicaciones, lotes FEFO y
 * número de alertas sin leer en una sola petición.
 *
 * @param pantryId - Hogar.
 * @returns {@link PantryDashboardResponse}.
 * @throws {ProblemDetailError} `403 pantry-access-denied` (no miembro o el
 *   hogar no existe), `404` si el backend aún no tiene el endpoint, red, 5xx.
 */
export function fetchPantryDashboard(pantryId: string): Promise<PantryDashboardResponse> {
  return bffJson<PantryDashboardResponse>(BFF_PANTRY_ROUTES.dashboard(pantryId));
}

/**
 * `POST /api/bff/pantries/{id}/consume` con `Idempotency-Key`.
 *
 * @param pantryId - Hogar.
 * @param payload - Producto y cantidad (ya normalizada a `string`).
 * @param idempotencyKey - `clientMutationId` de la operación (estable entre reintentos).
 * @returns Detalle FEFO de los lotes afectados.
 * @throws {ProblemDetailError} `insufficient-stock`, `pantry-access-denied`, `network-error`…
 */
export function consumeRequest(
  pantryId: string,
  payload: ConsumePayload,
  idempotencyKey: string,
): Promise<ConsumeResultResponse> {
  return bffJson<ConsumeResultResponse>(BFF_PANTRY_ROUTES.consume(pantryId), {
    method: "POST",
    json: payload,
    headers: idempotencyHeaders(idempotencyKey),
  });
}

/**
 * `GET /api/bff/notifications?unread_only=true&limit=1` (solo interesa `unread_count`).
 *
 * @returns Listado con `unread_count`.
 * @throws {ProblemDetailError} Red, `401`, 5xx.
 */
export function fetchUnreadNotifications(): Promise<NotificationListResponse> {
  return bffJson<NotificationListResponse>(
    `${BFF_PANTRY_ROUTES.notifications}?unread_only=true&limit=1`,
  );
}
