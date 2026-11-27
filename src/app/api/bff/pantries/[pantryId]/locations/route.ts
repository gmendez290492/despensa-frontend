import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated } from "@/lib/bff/authenticated-route";
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

/** `POST /api/bff/pantries/{pantryId}/locations` `{ name, description? }` → `201 LocationResponse`. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/bff/pantries/[pantryId]/locations">,
) {
  const { pantryId } = await ctx.params;
  return handleAuthenticated(
    request,
    (client, { correlationId, params, body }) =>
      unwrap(
        client.POST("/api/v1/pantries/{pantry_id}/locations", {
          params: { path: { pantry_id: params.pantryId } },
          body,
        }),
        correlationId,
      ),
    { mutation: true, uuidParams: { pantryId }, body: createLocationSchema, successStatus: 201 },
  );
}
