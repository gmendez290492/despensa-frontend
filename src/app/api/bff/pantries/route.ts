import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated, idempotencyHeaders } from "@/lib/bff/authenticated-route";
import { createPantrySchema } from "@/lib/pantry/schemas";

/** `GET /api/bff/pantries` → `200 PantryResponse[]` (hogares del usuario). */
export async function GET(request: NextRequest) {
  return handleAuthenticated(request, (client, { correlationId }) =>
    unwrap(client.GET("/api/v1/pantries"), correlationId),
  );
}

/**
 * `POST /api/bff/pantries` `{ name }` → `201 PantryResponse` (el usuario queda como `owner`).
 * Acepta `Idempotency-Key` opcional (validado, `[A-Za-z0-9_-]{8,128}`), lo
 * reenvía a FastAPI y devuelve `Idempotent-Replayed` si la respuesta es una
 * repetición.
 */
export async function POST(request: NextRequest) {
  return handleAuthenticated(
    request,
    (client, { correlationId, body, idempotencyKey }) =>
      unwrap(client.POST("/api/v1/pantries", { body, ...idempotencyHeaders(idempotencyKey) }), correlationId),
    { mutation: true, idempotent: true, body: createPantrySchema, successStatus: 201 },
  );
}
