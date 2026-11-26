import type { NextRequest } from "next/server";
import { unwrap } from "@/lib/api/server-client";
import { authenticatedRequest } from "@/lib/auth/session";
import { getCorrelationId, handleError, jsonResponse } from "@/lib/bff/http";

/**
 * `GET /api/bff/auth/me` -> `200 UserResponse` o `401` problem+json.
 * Rota tokens (mutex) si el access token expiró y reintenta una vez.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    const user = await authenticatedRequest(
      (client) => unwrap(client.GET("/api/v1/users/me"), correlationId),
      { correlationId, allowRefresh: true },
    );
    return jsonResponse(user, correlationId);
  } catch (error) {
    return handleError(error, correlationId);
  }
}
