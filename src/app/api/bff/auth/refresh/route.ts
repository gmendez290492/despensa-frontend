import { NextResponse, type NextRequest } from "next/server";
import { PROBLEM_TYPES, ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import { DEFAULT_AUTHENTICATED_PATH, LOGIN_PATH, OFFLINE_PATH } from "@/lib/auth/constants";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { clearSessionCookies, getSessionTokens, refreshSession } from "@/lib/auth/session";
import {
  assertSafeMutation,
  emptyResponse,
  getCorrelationId,
  handleError,
  withCorrelation,
} from "@/lib/bff/http";

/**
 * `POST /api/bff/auth/refresh` -> rota tokens (mutex) y responde `204`.
 * Lo usa el cliente cuando una llamada BFF devuelve `401`. Requiere
 * `Content-Type: application/json` aunque no lleve body.
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
    const { refreshToken } = await getSessionTokens();
    if (!refreshToken) {
      await clearSessionCookies();
      throw new ProblemDetailError({
        type: problemTypeUri(PROBLEM_TYPES.invalidToken),
        title: "Invalid or Expired Token",
        status: 401,
        detail: "No hay sesión que refrescar.",
        correlation_id: correlationId,
      });
    }
    await refreshSession(refreshToken, correlationId);
    return emptyResponse(correlationId, 204);
  } catch (error) {
    return handleError(error, correlationId);
  }
}

/**
 * `GET /api/bff/auth/refresh?next=/ruta` -> lo usan `proxy.ts` y la home
 * cuando el access token caducó o fue rechazado. Rota tokens y redirige (303)
 * a `next` (validado contra Open Redirect).
 *
 * - `Sec-Fetch-Site: cross-site` -> 303 a `/login` sin tocar la sesión (otro
 *   sitio no puede forzar rotaciones de tokens).
 * - Refresh rechazado (4xx) -> limpia cookies y 303 a `/login?next=`.
 * - Backend caído (5xx / red) -> 303 a `/offline`, conservando la sesión.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));

  const redirect = (path: string) =>
    withCorrelation(NextResponse.redirect(new URL(path, request.nextUrl.origin), 303), correlationId);
  const toLogin = () => {
    const url = new URL(LOGIN_PATH, request.nextUrl.origin);
    if (next !== DEFAULT_AUTHENTICATED_PATH) url.searchParams.set("next", next);
    return withCorrelation(NextResponse.redirect(url, 303), correlationId);
  };

  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return toLogin();
  }

  const { refreshToken } = await getSessionTokens();
  if (!refreshToken) {
    await clearSessionCookies();
    return toLogin();
  }

  try {
    await refreshSession(refreshToken, correlationId);
    return redirect(next);
  } catch (error) {
    if (error instanceof ProblemDetailError) {
      if (error.status === 401) return toLogin();
      if (error.status >= 500) return redirect(OFFLINE_PATH);
    }
    // 429 u otros: problem+json sin destruir la sesión.
    return handleError(error, correlationId);
  }
}
