import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated, idempotencyHeaders } from "@/lib/bff/authenticated-route";
import { consumeSchema } from "@/lib/pantry/schemas";

/**
 * `POST /api/bff/pantries/{pantryId}/consume` `{ product_id, quantity, notes? }`
 * → `200 ConsumeResultResponse` (descuento FEFO en FastAPI).
 *
 * Reenvía `Idempotency-Key` (lo genera la outbox: es el `clientMutationId`).
 * Errores de negocio (pasan tal cual como problem+json): `400
 * insufficient-stock`, `403 pantry-access-denied`, `404 product-not-found`.
 *
 * @remarks FastAPI deduplica por `(user_id, Idempotency-Key)` durante 168 h
 * (despensa-backend#14): un reintento con la misma clave devuelve el
 * resultado original sin volver a descontar. El BFF devuelve
 * `Idempotent-Replayed` al navegador cuando FastAPI la envía.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/consume">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params, body, idempotencyKey }) =>
      unwrap(
        client.POST("/api/v1/pantries/{pantry_id}/consume", {
          params: { path: { pantry_id: params.pantryId } },
          body,
          ...idempotencyHeaders(idempotencyKey),
        }),
        correlationId,
      ),
    { mutation: true, idempotent: true, uuidParams: { pantryId }, body: consumeSchema },
  );
}
