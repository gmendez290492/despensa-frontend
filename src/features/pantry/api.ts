import type { components } from "@/lib/api/schema";
import { bffJson } from "@/lib/api/bff-fetch";
import type {
  ConsumePayload,
  CreateLocationInput,
  CreatePantryInput,
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

/** Rutas del BFF del dominio `pantry`. */
export const BFF_PANTRY_ROUTES = {
  pantries: "/api/bff/pantries",
  join: "/api/bff/pantries/join",
  locations: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/locations`,
  batches: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/batches`,
  consume: (pantryId: string) => `/api/bff/pantries/${encodeURIComponent(pantryId)}/consume`,
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
  unreadNotifications: () => ["notifications", "unread"] as const,
};

/** `GET /api/bff/pantries`. @throws {ProblemDetailError} */
export function fetchPantries(): Promise<PantryResponse[]> {
  return bffJson<PantryResponse[]>(BFF_PANTRY_ROUTES.pantries);
}

/** `POST /api/bff/pantries`. @throws {ProblemDetailError} */
export function createPantryRequest(input: CreatePantryInput): Promise<PantryResponse> {
  return bffJson<PantryResponse>(BFF_PANTRY_ROUTES.pantries, { method: "POST", json: input });
}

/** `POST /api/bff/pantries/join`. @throws {ProblemDetailError} `invalid-invite-code`, `already-pantry-member`. */
export function joinPantryRequest(input: JoinPantryInput): Promise<PantryResponse> {
  return bffJson<PantryResponse>(BFF_PANTRY_ROUTES.join, { method: "POST", json: input });
}

/** `GET /api/bff/pantries/{id}/locations`. @throws {ProblemDetailError} `pantry-access-denied`. */
export function fetchLocations(pantryId: string): Promise<LocationResponse[]> {
  return bffJson<LocationResponse[]>(BFF_PANTRY_ROUTES.locations(pantryId));
}

/** `POST /api/bff/pantries/{id}/locations`. @throws {ProblemDetailError} */
export function createLocationRequest(
  pantryId: string,
  input: CreateLocationInput,
): Promise<LocationResponse> {
  return bffJson<LocationResponse>(BFF_PANTRY_ROUTES.locations(pantryId), {
    method: "POST",
    json: input,
  });
}

/** `GET /api/bff/pantries/{id}/batches` (orden FEFO). @throws {ProblemDetailError} `pantry-access-denied`. */
export function fetchBatches(pantryId: string): Promise<FoodBatchResponse[]> {
  return bffJson<FoodBatchResponse[]>(BFF_PANTRY_ROUTES.batches(pantryId));
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
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

/** `GET /api/bff/notifications?unread_only=true&limit=1` (solo interesa `unread_count`). */
export function fetchUnreadNotifications(): Promise<NotificationListResponse> {
  return bffJson<NotificationListResponse>(
    `${BFF_PANTRY_ROUTES.notifications}?unread_only=true&limit=1`,
  );
}
