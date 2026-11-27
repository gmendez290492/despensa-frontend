import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated, idempotencyHeaders } from "@/lib/bff/authenticated-route";
import { joinPantrySchema } from "@/lib/pantry/schemas";

/**
 * `POST /api/bff/pantries/join` `{ invite_code }` → `200 PantryResponse`.
 * Errores: `404 invalid-invite-code`, `409 already-pantry-member`.
 * Acepta `Idempotency-Key` opcional (validado, `[A-Za-z0-9_-]{8,128}`), lo
 * reenvía a FastAPI y devuelve `Idempotent-Replayed` si la respuesta es una
 * repetición.
 */
export async function POST(request: NextRequest) {
  return handleAuthenticated(
    request,
    (client, { correlationId, body, idempotencyKey }) =>
      unwrap(client.POST("/api/v1/pantries/join", { body, ...idempotencyHeaders(idempotencyKey) }), correlationId),
    { mutation: true, idempotent: true, body: joinPantrySchema },
  );
}
