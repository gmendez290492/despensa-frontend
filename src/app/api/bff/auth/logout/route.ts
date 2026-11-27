import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_PATH } from "@/lib/auth/constants";
import { clearSessionCookies, revokePreviousSession } from "@/lib/auth/session";
import {
  assertSafeMutation,
  emptyResponse,
  getCorrelationId,
  handleError,
  withCorrelation,
} from "@/lib/bff/http";

/**
 * `POST /api/bff/auth/logout` -> revoca la sesión en FastAPI (refresh y access
 * de esa sesión dejan de valer al instante) y limpia cookies. Siempre `204`
 * (idempotente), aunque el backend falle: ante `429` reintenta una vez tras
 * `Retry-After` (con tope) y, si persiste, solo registra un aviso con el
 * `correlation_id`; las cookies se borran igualmente. Requiere `Content-Type:
 * application/json` aunque no lleve body (defensa CSRF).
 */
export async function POST(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  try {
    assertSafeMutation(request, correlationId);
  } catch (error) {
    return handleError(error, correlationId);
  }

  await revokePreviousSession(correlationId, undefined, { retryOnRateLimit: true });
  await clearSessionCookies();
  return emptyResponse(correlationId, 204);
}

/** `Sec-Fetch-Site` con el que se permite el logout por navegación (GET). */
const SAFE_NAVIGATION_SITES = new Set(["same-origin", "none"]);

/**
 * `GET /api/bff/auth/logout` -> respaldo por navegación completa cuando el
 * `POST` falla (p. ej. `403 forbidden-origin` por un `APP_ORIGIN` mal
 * configurado). Sin él, las cookies `HttpOnly` sobreviven, el JS no puede
 * borrarlas y `proxy.ts` devuelve al usuario a `/` (hallazgo S5).
 *
 * @remarks Defensa CSRF: solo cierra sesión si el navegador declara
 * `Sec-Fetch-Site: same-origin` (o `none`, URL tecleada). Una navegación
 * desde otro sitio va a `/login` sin tocar la sesión, así nadie puede cerrar la
 * sesión del usuario con un enlace externo. Navegadores sin `Sec-Fetch-Site`
 * (anteriores a Baseline 2023) se tratan como no confiables.
 *
 * @param request - Navegación del usuario.
 * @returns `303` a `/login`, con las cookies borradas si la petición es del mismo sitio.
 */
export async function GET(request: NextRequest) {
  const correlationId = getCorrelationId(request);
  const response = withCorrelation(
    NextResponse.redirect(new URL(LOGIN_PATH, request.nextUrl.origin), 303),
    correlationId,
  );

  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (!fetchSite || !SAFE_NAVIGATION_SITES.has(fetchSite)) return response;

  await revokePreviousSession(correlationId, undefined, { retryOnRateLimit: true });
  await clearSessionCookies();
  return response;
}
