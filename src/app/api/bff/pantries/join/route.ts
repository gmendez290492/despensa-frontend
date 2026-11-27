import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated } from "@/lib/bff/authenticated-route";
import { joinPantrySchema } from "@/lib/pantry/schemas";

/**
 * `POST /api/bff/pantries/join` `{ invite_code }` → `200 PantryResponse`.
 * Errores: `404 invalid-invite-code`, `409 already-pantry-member`.
 */
export async function POST(request: NextRequest) {
  return handleAuthenticated(
    request,
    (client, { correlationId, body }) =>
      unwrap(client.POST("/api/v1/pantries/join", { body }), correlationId),
    { mutation: true, body: joinPantrySchema },
  );
}
