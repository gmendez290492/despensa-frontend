import type { NextRequest } from "next/server";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { CLIENT_BINDING_HEADER, createClientBinding } from "@/lib/auth/refresh";
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

/**
 * `POST /api/bff/auth/login` -> `200 { user }` + cookies HttpOnly (sin tokens en el body).
 * Abre la sesión con un `X-Client-Binding` nuevo, guardado en su propia cookie.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
    const credentials = await parseJsonBody(request, loginSchema, correlationId);

    // Binding nuevo por sesión: FastAPI lo exigirá en cada refresh.
    const clientBinding = createClientBinding();
    const tokens = await unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/login", {
        body: credentials,
        params: { header: { [CLIENT_BINDING_HEADER]: clientBinding } },
      }),
      correlationId,
    );
    const user = await fetchUserWithToken(tokens.access_token, correlationId);
    // Si había otra sesión en este navegador, se revoca su refresh_token (best effort).
    await revokePreviousSession(correlationId, tokens.refresh_token);
    await setSessionCookies(tokens, clientBinding);

    return jsonResponse({ user }, correlationId, { status: 200 });
  } catch (error) {
    return handleError(error, correlationId);
  }
}
