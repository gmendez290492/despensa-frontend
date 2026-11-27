import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated } from "@/lib/bff/authenticated-route";

/**
 * `GET /api/bff/pantries/{pantryId}/dashboard` → `200 PantryDashboardResponse`
 * (`pantries`, `locations`, `batches` FEFO con semáforo y `unread_notifications`
 * del usuario) en una sola llamada a FastAPI.
 *
 * `pantryId` se valida como UUID antes de autenticar (`400 invalid-request`
 * sin tocar FastAPI); la pertenencia la valida FastAPI: `403
 * pantry-access-denied` también si el hogar no existe. Sin query params ni
 * `Idempotency-Key`. `Cache-Control: no-store` y `X-Correlation-ID` los añade
 * `handleAuthenticated`. Un `404` (backend sin el endpoint) pasa tal cual: el
 * cliente cae a las llamadas sueltas.
 *
 * @param request - Petición del navegador (cookies `HttpOnly` con los tokens).
 * @param ctx - Segmento dinámico `pantryId`.
 * @returns JSON del dashboard o `application/problem+json`.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/dashboard">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params }) =>
      unwrap(
        client.GET("/api/v1/pantries/{pantry_id}/dashboard", {
          params: { path: { pantry_id: params.pantryId } },
        }),
        correlationId,
      ),
    { uuidParams: { pantryId } },
  );
}
