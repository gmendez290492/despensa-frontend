import type { NextRequest } from "next/server";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { forgetRefreshToken } from "@/lib/auth/refresh";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { clearSessionCookies, getSessionTokens } from "@/lib/auth/session";
import {
  assertSafeMutation,
  emptyResponse,
  getCorrelationId,
  handleError,
  parseJsonBody,
} from "@/lib/bff/http";

/**
 * `POST /api/bff/auth/password/reset` -> `204`.
 *
 * Restablece la contraseña con el token del correo. FastAPI revoca **todas**
 * las sesiones del usuario, así que el BFF borra también las cookies de este
 * navegador (si las hay) para que `proxy.ts` no intente usar tokens muertos.
 *
 * Errores: `400 invalid-reset-token` (enlace inválido, expirado o usado),
 * `422` de validación y `429` con `Retry-After`.
 *
 * @param request - Cuerpo `{ token, new_password }`.
 * @returns `204` o problem+json.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
    const body = await parseJsonBody(request, resetPasswordSchema, correlationId);
    await unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/password/reset", { body }),
      correlationId,
    );

    const { refreshToken } = await getSessionTokens();
    if (refreshToken) forgetRefreshToken(refreshToken);
    await clearSessionCookies();
    return emptyResponse(correlationId, 204);
  } catch (error) {
    return handleError(error, correlationId);
  }
}
