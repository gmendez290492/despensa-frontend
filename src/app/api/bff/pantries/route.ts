import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { handleAuthenticated } from "@/lib/bff/authenticated-route";
import { createPantrySchema } from "@/lib/pantry/schemas";

/** `GET /api/bff/pantries` → `200 PantryResponse[]` (hogares del usuario). */
export async function GET(request: NextRequest) {
  return handleAuthenticated(request, (client, { correlationId }) =>
    unwrap(client.GET("/api/v1/pantries"), correlationId),
  );
}

/** `POST /api/bff/pantries` `{ name }` → `201 PantryResponse` (el usuario queda como `owner`). */
export async function POST(request: NextRequest) {
  return handleAuthenticated(
    request,
    (client, { correlationId, body }) =>
      unwrap(client.POST("/api/v1/pantries", { body }), correlationId),
    { mutation: true, body: createPantrySchema, successStatus: 201 },
  );
}
