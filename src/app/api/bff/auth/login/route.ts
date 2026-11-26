import type { NextRequest } from "next/server";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { loginSchema } from "@/lib/auth/schemas";
import {
  fetchUserWithToken,
  revokePreviousSession,
  setSessionCookies,
} from "@/lib/auth/session";
import {
  assertSafeMutation,
  getCorrelationId,
  handleError,
  jsonResponse,
  parseJsonBody,
} from "@/lib/bff/http";

/** `POST /api/bff/auth/login` -> `200 { user }` + cookies HttpOnly (sin tokens en el body). */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
    const credentials = await parseJsonBody(request, loginSchema, correlationId);

    const tokens = await unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/login", {
        body: credentials,
      }),
      correlationId,
    );
    const user = await fetchUserWithToken(tokens.access_token, correlationId);
    // Si había otra sesión en este navegador, se revoca su refresh_token (best effort).
    await revokePreviousSession(correlationId, tokens.refresh_token);
    await setSessionCookies(tokens);

    return jsonResponse({ user }, correlationId, { status: 200 });
  } catch (error) {
    return handleError(error, correlationId);
  }
}
