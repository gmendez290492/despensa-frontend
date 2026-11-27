import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated, idempotencyHeaders } from "@/lib/bff/authenticated-route";
import { createLocationSchema } from "@/lib/pantry/schemas";

/**
 * `GET /api/bff/pantries/{pantryId}/locations` → `200 LocationResponse[]`.
 * `pantryId` se valida como UUID antes de autenticar; la pertenencia (IDOR) la
 * valida FastAPI: `403 pantry-access-denied`.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/locations">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params }) =>
      unwrap(
        client.GET("/api/v1/pantries/{pantry_id}/locations", {
          params: { path: { pantry_id: params.pantryId } },
        }),
        correlationId,
      ),
    { uuidParams: { pantryId } },
  );
}

/**
 * `POST /api/bff/pantries/{pantryId}/locations` `{ name, description? }` → `201 LocationResponse`.
 * Acepta `Idempotency-Key` opcional (validado, `[A-Za-z0-9_-]{8,128}`), lo
 * reenvía a FastAPI y devuelve `Idempotent-Replayed` si la respuesta es una
 * repetición.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/locations">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params, body, idempotencyKey }) =>
      unwrap(
        client.POST("/api/v1/pantries/{pantry_id}/locations", {
          params: { path: { pantry_id: params.pantryId } },
          body,
          ...idempotencyHeaders(idempotencyKey),
        }),
        correlationId,
      ),
    { mutation: true, idempotent: true, uuidParams: { pantryId }, body: createLocationSchema, successStatus: 201 },
  );
}
