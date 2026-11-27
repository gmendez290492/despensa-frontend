import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated } from "@/lib/bff/authenticated-route";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 10_000;

/**
 * Entero acotado a `[min, max]`; valores ausentes o no numéricos caen a
 * `fallback`.
 */
function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || !/^-?\d{1,12}$/.test(raw.trim())) return fallback;
  return Math.min(max, Math.max(min, Number(raw.trim())));
}

/**
 * Query acotada de `GET /api/v1/notifications` a partir de los parámetros del
 * navegador (allowlist: el resto se descarta).
 *
 * @param search - `searchParams` de la petición.
 * @returns `{ unread_only, limit (1-100), offset (0-10000) }`.
 */
function notificationsQuery(search: URLSearchParams) {
  return {
    unread_only: search.get("unread_only") === "true",
    limit: boundedInt(search.get("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: boundedInt(search.get("offset"), 0, 0, MAX_OFFSET),
  };
}

/**
 * `GET /api/bff/notifications?unread_only=&limit=&offset=` →
 * `200 NotificationListResponse`. Parámetros acotados por campo (`limit ≤ 100`,
 * `offset ≤ 10000`): el navegador no puede pedir páginas arbitrariamente
 * grandes; valores no numéricos caen al valor por defecto.
 */
export async function GET(request: NextRequest) {
  const query = notificationsQuery(request.nextUrl.searchParams);
  return handleAuthenticated(request, (client, { correlationId }) =>
    unwrap(client.GET("/api/v1/notifications", { params: { query } }), correlationId),
  );
}
