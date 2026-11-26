import type { NextRequest } from "next/server";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { FORGOT_PASSWORD_GENERIC_MESSAGE } from "@/lib/auth/constants";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import {
  assertSafeMutation,
  getCorrelationId,
  handleError,
  jsonResponse,
  parseJsonBody,
} from "@/lib/bff/http";

/**
 * `POST /api/bff/auth/password/forgot` -> `202 { detail }`.
 *
 * FastAPI responde siempre `202` con el mismo mensaje, exista o no la cuenta,
 * para no permitir la enumeración de usuarios. El BFF reenvía ese mensaje
 * genérico tal cual. `429 rate-limit-exceeded` llega con `Retry-After`.
 *
 * @param request - Cuerpo `{ email }`.
 * @returns `202` con el mensaje genérico, o problem+json.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
    const body = await parseJsonBody(request, forgotPasswordSchema, correlationId);
    const result = await unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/password/forgot", { body }),
      correlationId,
    );
    const detail =
      typeof result?.detail === "string" && result.detail.length > 0
        ? result.detail
        : FORGOT_PASSWORD_GENERIC_MESSAGE;
    return jsonResponse({ detail }, correlationId, { status: 202 });
  } catch (error) {
    return handleError(error, correlationId);
  }
}
