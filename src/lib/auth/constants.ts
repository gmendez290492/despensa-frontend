/** Constantes de sesión compartidas por `proxy.ts`, el BFF y los hooks cliente. */

/** Cookie `HttpOnly` del access token (nunca legible desde JS). */
export const ACCESS_TOKEN_COOKIE = "despensa_access_token";
/** Cookie `HttpOnly` del refresh token (nunca legible desde JS). */
export const REFRESH_TOKEN_COOKIE = "despensa_refresh_token";

/**
 * FastAPI no expone el TTL del refresh token en `TokenResponse`. El BFF lee el
 * claim `exp` del JWT (sin verificarlo; solo para la vida de la cookie) y usa
 * este valor como respaldo: 7 días, el TTL observado en el backend local.
 * Si el backend lo invalida antes, el refresh falla con `invalid-token` y el
 * BFF limpia las cookies.
 */
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Tope de seguridad para la cookie del refresh token (30 días). */
export const REFRESH_TOKEN_MAX_AGE_CAP_SECONDS = 30 * 24 * 60 * 60;

/** Rutas públicas de autenticación (con cookie de access redirigen a `/`). */
export const AUTH_ROUTES = ["/login", "/registro"] as const;

/** Rutas públicas que no requieren sesión ni redirigen. */
export const PUBLIC_ROUTES = ["/offline", "/~offline"] as const;

/** Destino de las rutas protegidas sin sesión. */
export const LOGIN_PATH = "/login";
/** Destino tras login cuando no hay `?next=` válido. */
export const DEFAULT_AUTHENTICATED_PATH = "/";
/** Fallback offline (también destino del refresh GET si el backend está caído). */
export const OFFLINE_PATH = "/offline";

/** Route Handler que rota tokens y redirige de vuelta (`?next=`). */
export const BFF_REFRESH_REDIRECT_PATH = "/api/bff/auth/refresh";
