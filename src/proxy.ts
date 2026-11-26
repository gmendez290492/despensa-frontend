import { NextResponse, type NextRequest } from "next/server";
import { CORRELATION_HEADER, resolveCorrelationId } from "@/lib/api/correlation";
import {
  ACCESS_TOKEN_COOKIE,
  AUTH_ROUTES,
  BFF_REFRESH_REDIRECT_PATH,
  DEFAULT_AUTHENTICATED_PATH,
  LOGIN_PATH,
  PUBLIC_ROUTES,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/auth/constants";
import { safeRedirectPath } from "@/lib/auth/redirect";

/**
 * Protección optimista de rutas (Next 16: `proxy.ts` reemplaza a
 * `middleware.ts`). Solo inspecciona la presencia de cookies; la validación
 * real del token la hace FastAPI vía el BFF / RSC.
 *
 * - `/login`, `/registro`: públicas; con cookie de access -> redirige a
 *   `next` o `/`. Con solo refresh_token se muestra el formulario: así se
 *   evita el bucle /login -> / -> refresh -> /login cuando el refresh GET
 *   rechaza una navegación `Sec-Fetch-Site: cross-site`.
 * - `PUBLIC_ROUTES`: públicas sin redirección.
 * - Resto: sin cookies -> `/login?next=<ruta>`; solo refresh_token (access
 *   caducado) -> `/api/bff/auth/refresh?next=<ruta>` (rota con mutex y vuelve).
 */
function matchesRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Proxy de Next 16 (ver bloque superior): redirige según la presencia de cookies
 * y propaga `X-Correlation-ID` en petición y respuesta.
 *
 * @param request - Petición entrante.
 * @returns Redirección a login/refresh/`next`, o `NextResponse.next()`.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const correlationId = resolveCorrelationId(request.headers);

  const hasAccess = Boolean(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
  const hasRefresh = Boolean(request.cookies.get(REFRESH_TOKEN_COOKIE)?.value);

  const redirectTo = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.headers.set(CORRELATION_HEADER, correlationId);
    return response;
  };

  if (matchesRoute(pathname, AUTH_ROUTES)) {
    if (hasAccess) {
      const next = safeRedirectPath(request.nextUrl.searchParams.get("next"));
      return redirectTo(new URL(next, request.url));
    }
  } else if (!matchesRoute(pathname, PUBLIC_ROUTES)) {
    const requested = safeRedirectPath(`${pathname}${search}`);

    if (!hasAccess && !hasRefresh) {
      const loginUrl = new URL(LOGIN_PATH, request.url);
      if (requested !== DEFAULT_AUTHENTICATED_PATH) loginUrl.searchParams.set("next", requested);
      return redirectTo(loginUrl);
    }

    if (!hasAccess && hasRefresh) {
      const refreshUrl = new URL(BFF_REFRESH_REDIRECT_PATH, request.url);
      refreshUrl.searchParams.set("next", requested);
      return redirectTo(refreshUrl);
    }
  }

  // Propaga el correlation ID hacia RSC / Route Handlers y de vuelta al navegador.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CORRELATION_HEADER, correlationId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CORRELATION_HEADER, correlationId);
  return response;
}

/** Matcher del proxy: excluye BFF, assets de Next, Service Worker y archivos estáticos. */
export const config = {
  matcher: [
    /*
     * Excluye: /api (BFF), /_next (static, image, data), service worker,
     * manifest, iconos y assets estáticos con una extensión de la lista
     * explícita (una ruta como `/despensa/leche.1l` sí pasa por el proxy).
     */
    "/((?!api/|api$|_next/|sw\\.js|swe-worker-|manifest\\.webmanifest|favicon\\.ico|icons/|robots\\.txt|sitemap\\.xml|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.webp$|.*\\.avif$|.*\\.ico$|.*\\.css$|.*\\.js$|.*\\.map$|.*\\.txt$|.*\\.xml$|.*\\.json$|.*\\.webmanifest$|.*\\.woff$|.*\\.woff2$).*)",
  ],
};
