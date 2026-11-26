import type { NextRequest } from "next/server";
import { ProblemDetailError } from "@/lib/api/problem";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { registerRequestSchema } from "@/lib/auth/schemas";
import { revokePreviousSession, setSessionCookies } from "@/lib/auth/session";
import {
  assertSafeMutation,
  getCorrelationId,
  handleError,
  jsonResponse,
  parseJsonBody,
} from "@/lib/bff/http";

/**
 * `POST /api/bff/auth/register` -> registra y hace login automático.
 * Respuesta `201 { user, authenticated }`. `authenticated: false` indica que la
 * cuenta se creó pero el login automático falló (p. ej. rate limit): la UI
 * debe enviar al usuario a `/login`.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
    const payload = await parseJsonBody(request, registerRequestSchema, correlationId);
    const client = createBackendClient({ correlationId });

    const user = await unwrap(
      client.POST("/api/v1/auth/register", { body: payload }),
      correlationId,
    );

    try {
      const tokens = await unwrap(
        client.POST("/api/v1/auth/login", {
          body: { email: payload.email, password: payload.password },
        }),
        correlationId,
      );
      await revokePreviousSession(correlationId, tokens.refresh_token);
      await setSessionCookies(tokens);
    } catch (loginError) {
      if (!(loginError instanceof ProblemDetailError)) throw loginError;
      console.warn("[bff] registro correcto pero login automático falló", {
        correlationId,
        type: loginError.type,
        status: loginError.status,
      });
      return jsonResponse({ user, authenticated: false }, correlationId, { status: 201 });
    }

    return jsonResponse({ user, authenticated: true }, correlationId, { status: 201 });
  } catch (error) {
    return handleError(error, correlationId);
  }
}
