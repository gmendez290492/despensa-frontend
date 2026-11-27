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
 * @remarks La deduplicación por `(user_id, Idempotency-Key)` está en la rama
 * `feature/pantry-idempotency-issue-11` de FastAPI: hasta que se fusione
 * despensa-backend#11, si la respuesta se pierde y la outbox reintenta, el
 * stock se descuenta dos veces (ver `docs/FRONTEND_CONTEXT.md`, hallazgos
 * abiertos).
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
