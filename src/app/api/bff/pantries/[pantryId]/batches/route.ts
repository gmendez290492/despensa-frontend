import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated, idempotencyHeaders } from "@/lib/bff/authenticated-route";
import { createBatchSchema } from "@/lib/pantry/schemas";

/**
 * `GET /api/bff/pantries/{pantryId}/batches` → `200 FoodBatchResponse[]`
 * ordenados por FEFO, con `semaforo` y `dias_para_vencer` calculados por FastAPI.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/batches">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params }) =>
      unwrap(
        client.GET("/api/v1/pantries/{pantry_id}/batches", {
          params: { path: { pantry_id: params.pantryId } },
        }),
        correlationId,
      ),
    { uuidParams: { pantryId } },
  );
}

/**
 * `POST /api/bff/pantries/{pantryId}/batches` → `201 FoodBatchResponse`.
 * Acepta `Idempotency-Key` (validado) y lo reenvía a FastAPI.
 *
 * @remarks La deduplicación por `(user_id, Idempotency-Key)` está en la rama
 * `feature/pantry-idempotency-issue-11` de FastAPI: hasta que se fusione
 * despensa-backend#11, un reintento tras una respuesta perdida puede crear un
 * lote duplicado (ver `docs/FRONTEND_CONTEXT.md`, hallazgos abiertos).
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/batches">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params, body, idempotencyKey }) =>
      unwrap(
        client.POST("/api/v1/pantries/{pantry_id}/batches", {
          params: { path: { pantry_id: params.pantryId } },
          body,
          ...idempotencyHeaders(idempotencyKey),
        }),
        correlationId,
      ),
    {
      mutation: true,
      idempotent: true,
      uuidParams: { pantryId },
      body: createBatchSchema,
      successStatus: 201,
    },
  );
}
