import type { NextRequest } from "next/server";
import { clearSessionCookies, revokePreviousSession } from "@/lib/auth/session";
import { assertSafeMutation, emptyResponse, getCorrelationId, handleError } from "@/lib/bff/http";

/**
 * `POST /api/bff/auth/logout` -> revoca el refresh_token en FastAPI y limpia
 * cookies. Siempre `204` (idempotente), aunque el backend falle. Requiere
 * `Content-Type: application/json` aunque no lleve body (defensa CSRF).
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
  } catch (error) {
    return handleError(error, correlationId);
  }

  await revokePreviousSession(correlationId);
  await clearSessionCookies();
  return emptyResponse(correlationId, 204);
}
