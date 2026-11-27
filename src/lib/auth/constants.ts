/** Constantes de sesión compartidas por `proxy.ts`, el BFF y los hooks cliente. */

/** Cookie `HttpOnly` del access token (nunca legible desde JS). */
export const ACCESS_TOKEN_COOKIE = "despensa_access_token";
/** Cookie `HttpOnly` del refresh token (nunca legible desde JS). */
export const REFRESH_TOKEN_COOKIE = "despensa_refresh_token";
/**
 * Cookie `HttpOnly` con el `X-Client-Binding` de la sesión: valor opaco que el
 * BFF genera en el login y FastAPI exige en cada refresh. Se guarda separado
 * del refresh token para que robar este último no baste para rotar la sesión.
 */
export const CLIENT_BINDING_COOKIE = "despensa_client_binding";

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

/** Página "Olvidé mi contraseña". */
export const FORGOT_PASSWORD_PATH = "/recuperar-contrasena";
/**
 * Página a la que enlaza el correo de FastAPI
 * (`${FRONTEND_BASE_URL}/reset-password?token=…`). El nombre lo fija el backend.
 */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Rutas públicas de autenticación (con cookie de access redirigen a `/`). */
export const AUTH_ROUTES = ["/login", "/registro", FORGOT_PASSWORD_PATH] as const;

/**
 * Rutas públicas que no requieren sesión ni redirigen. `/reset-password` va
 * aquí (no en `AUTH_ROUTES`): el enlace del correo debe funcionar aunque el
 * navegador tenga una sesión abierta.
 */
export const PUBLIC_ROUTES = ["/offline", "/~offline", RESET_PASSWORD_PATH] as const;

/** Mensaje de respaldo si FastAPI no devuelve `detail` (no revela si la cuenta existe). */
export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  "Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña.";

/** Destino de las rutas protegidas sin sesión. */
export const LOGIN_PATH = "/login";
/** Destino tras login cuando no hay `?next=` válido. */
export const DEFAULT_AUTHENTICATED_PATH = "/";
/** Fallback offline (también destino del refresh GET si el backend está caído). */
export const OFFLINE_PATH = "/offline";
/** Query param de {@link OFFLINE_PATH} que indica por qué se llegó allí. */
export const OFFLINE_REASON_PARAM = "motivo";
/**
 * Valor de {@link OFFLINE_REASON_PARAM} cuando el refresh GET recibió un `429`
 * (`/offline?motivo=limite`): hay red, pero FastAPI pide esperar.
 */
export const OFFLINE_REASON_RATE_LIMIT = "limite";

/** Route Handler que rota tokens y redirige de vuelta (`?next=`). */
export const BFF_REFRESH_REDIRECT_PATH = "/api/bff/auth/refresh";
