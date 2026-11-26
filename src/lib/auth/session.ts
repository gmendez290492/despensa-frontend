import "server-only";

import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import type { components } from "@/lib/api/schema";
import { resolveCorrelationId } from "@/lib/api/correlation";
import {
  PROBLEM_TYPES,
  ProblemDetailError,
  problemTypeUri,
} from "@/lib/api/problem";
import { createBackendClient, unwrap, type BackendClient } from "@/lib/api/server-client";
import {
  ACCESS_TOKEN_COOKIE,
  CLIENT_BINDING_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from "@/lib/auth/constants";
import { refreshTokenMaxAge } from "@/lib/auth/jwt";
import { forgetRefreshToken, refreshTokens, type TokenResponse } from "@/lib/auth/refresh";

/** Usuario de FastAPI (tipo generado desde OpenAPI). */
export type UserResponse = components["schemas"]["UserResponse"];

/**
 * `Secure` en producción. En desarrollo (http://localhost) se desactiva.
 * `AUTH_COOKIE_SECURE=true|false` permite forzarlo (p. ej. `pnpm start` en
 * local sin HTTPS).
 */
function isSecureCookie(): boolean {
  const override = process.env.AUTH_COOKIE_SECURE;
  if (override === "true") return true;
  if (override === "false") return false;
  return process.env.NODE_ENV === "production";
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

/** Correlation ID de la petición actual (lo inyecta `proxy.ts` o se genera). */
export async function getRequestCorrelationId(): Promise<string> {
  return resolveCorrelationId(await headers());
}

/**
 * Persiste el par de tokens (y el `X-Client-Binding` de la sesión) en cookies
 * `HttpOnly`. Solo en Route Handlers / Server Actions (las RSC no pueden
 * escribir cookies).
 *
 * @param tokens - Par devuelto por FastAPI.
 * @param clientBinding - Binding de la sesión. Si se omite, la cookie de binding
 *   no se toca; con `null` se borra (sesión sin binding).
 */
export async function setSessionCookies(
  tokens: TokenResponse,
  clientBinding?: string | null,
): Promise<void> {
  const store = await cookies();
  // Margen de 5 s para que la cookie caduque antes que el JWT.
  const accessMaxAge = Math.max(1, Math.floor(tokens.expires_in) - 5);
  const refreshMaxAge = refreshTokenMaxAge(tokens.refresh_token);
  store.set(ACCESS_TOKEN_COOKIE, tokens.access_token, cookieOptions(accessMaxAge));
  store.set(REFRESH_TOKEN_COOKIE, tokens.refresh_token, cookieOptions(refreshMaxAge));
  if (clientBinding === null) {
    store.set(CLIENT_BINDING_COOKIE, "", cookieOptions(0));
  } else if (clientBinding !== undefined) {
    // Misma vida que el refresh token: sin él, el binding no sirve de nada.
    store.set(CLIENT_BINDING_COOKIE, clientBinding, cookieOptions(refreshMaxAge));
  }
}

/** Borra las cookies de sesión (tokens y binding). Solo en Route Handlers / Server Actions. */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_TOKEN_COOKIE, "", cookieOptions(0));
  store.set(REFRESH_TOKEN_COOKIE, "", cookieOptions(0));
  store.set(CLIENT_BINDING_COOKIE, "", cookieOptions(0));
}

/**
 * Revoca en FastAPI (best effort, nunca lanza) el refresh_token presente en la
 * cookie y lo descarta del mutex. Se usa en logout y antes de sobrescribir una
 * sesión previa en login/registro. `except` evita revocar el par recién emitido.
 */
export async function revokePreviousSession(
  correlationId: string,
  except?: string,
): Promise<void> {
  const { refreshToken } = await getSessionTokens();
  if (!refreshToken || refreshToken === except) return;
  forgetRefreshToken(refreshToken);
  try {
    await unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/logout", {
        body: { refresh_token: refreshToken },
      }),
      correlationId,
    );
  } catch (error) {
    console.warn("[bff] no se pudo revocar el refresh_token anterior", {
      correlationId,
      status: error instanceof ProblemDetailError ? error.status : undefined,
    });
  }
}

/**
 * Lee los tokens y el binding de las cookies `HttpOnly` de la petición actual
 * (solo servidor).
 *
 * @returns `accessToken`, `refreshToken` y `clientBinding`, o `undefined` si
 *   faltan o están vacíos.
 */
export async function getSessionTokens(): Promise<{
  accessToken: string | undefined;
  refreshToken: string | undefined;
  clientBinding: string | undefined;
}> {
  const store = await cookies();
  return {
    accessToken: store.get(ACCESS_TOKEN_COOKIE)?.value || undefined,
    refreshToken: store.get(REFRESH_TOKEN_COOKIE)?.value || undefined,
    clientBinding: store.get(CLIENT_BINDING_COOKIE)?.value || undefined,
  };
}

function unauthenticated(correlationId: string, detail = "Sesión no iniciada o expirada."): ProblemDetailError {
  return new ProblemDetailError({
    type: problemTypeUri(PROBLEM_TYPES.invalidToken),
    title: "Invalid or Expired Token",
    status: 401,
    detail,
    correlation_id: correlationId,
  });
}

/**
 * El backend rechazó el refresh_token (401 invalid-token, 422 por formato,
 * etc.). Se excluyen 429 (rate limit) y 5xx/red: la sesión puede seguir siendo
 * válida y no debe destruirse.
 */
function isAuthRejection(error: unknown): error is ProblemDetailError {
  return (
    error instanceof ProblemDetailError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

/**
 * Rota tokens con mutex y persiste el nuevo par en cookies. Si FastAPI
 * rechaza el refresh, limpia la sesión y relanza 401.
 */
export async function refreshSession(
  refreshToken: string,
  correlationId: string,
): Promise<TokenResponse> {
  // El binding viaja en su propia cookie; la sesión sigue ligada al mismo valor.
  const { clientBinding } = await getSessionTokens();
  try {
    const tokens = await refreshTokens(refreshToken, correlationId, clientBinding);
    await setSessionCookies(tokens, clientBinding);
    return tokens;
  } catch (error) {
    if (isAuthRejection(error)) {
      forgetRefreshToken(refreshToken);
      await clearSessionCookies();
      throw error.status === 401 ? error : unauthenticated(correlationId, error.detail);
    }
    throw error;
  }
}

/** Opciones de {@link authenticatedRequest}. */
export interface AuthenticatedRequestOptions {
  correlationId: string;
  /**
   * `true` en Route Handlers / Server Actions: ante `401 invalid-token` rota
   * tokens (mutex) y reintenta una vez. Debe ser `false` en Server Components,
   * que no pueden escribir cookies (rotar sin persistir perdería la sesión).
   */
  allowRefresh: boolean;
}

/**
 * Ejecuta una llamada autenticada servidor→FastAPI con Bearer desde cookie.
 * Lanza `ProblemDetailError`.
 */
export async function authenticatedRequest<T>(
  call: (client: BackendClient) => Promise<T>,
  { correlationId, allowRefresh }: AuthenticatedRequestOptions,
): Promise<T> {
  const tokens = await getSessionTokens();
  const { refreshToken } = tokens;
  let { accessToken } = tokens;

  if (!accessToken) {
    if (!allowRefresh || !refreshToken) throw unauthenticated(correlationId);
    accessToken = (await refreshSession(refreshToken, correlationId)).access_token;
    return call(createBackendClient({ correlationId, accessToken }));
  }

  try {
    return await call(createBackendClient({ correlationId, accessToken }));
  } catch (error) {
    const canRetry =
      allowRefresh &&
      refreshToken !== undefined &&
      error instanceof ProblemDetailError &&
      error.status === 401 &&
      error.is(PROBLEM_TYPES.invalidToken);
    if (!canRetry) throw error;

    const tokens = await refreshSession(refreshToken, correlationId);
    return call(createBackendClient({ correlationId, accessToken: tokens.access_token }));
  }
}

/** `GET /api/v1/users/me` con un access token explícito. */
export function fetchUserWithToken(
  accessToken: string,
  correlationId: string,
): Promise<UserResponse> {
  return unwrap(
    createBackendClient({ correlationId, accessToken }).GET("/api/v1/users/me"),
    correlationId,
  );
}

/**
 * Usuario autenticado o `null`. Por defecto no refresca (seguro en RSC). En
 * Route Handlers pasa `{ allowRefresh: true }`.
 *
 * Con `cacheComponents`, llamar desde un componente envuelto en `<Suspense>`.
 */
export async function getCurrentUser(
  options: { allowRefresh?: boolean } = {},
): Promise<UserResponse | null> {
  // Datos por petición: excluye del prerender a cualquier RSC que lo invoque (cacheComponents).
  await connection();
  const correlationId = await getRequestCorrelationId();
  try {
    return await authenticatedRequest(
      (client) => unwrap(client.GET("/api/v1/users/me"), correlationId),
      { correlationId, allowRefresh: options.allowRefresh ?? false },
    );
  } catch (error) {
    if (error instanceof ProblemDetailError && error.status === 401) return null;
    throw error;
  }
}

/** Estado de sesión devuelto por {@link getSession}. */
export type Session =
  | { status: "authenticated"; user: UserResponse }
  /** Access token caducado pero hay refresh_token: el cliente/proxy debe refrescar. */
  | { status: "expired"; user: null }
  | { status: "anonymous"; user: null };

/** Estado de sesión para Server Components (no escribe cookies). */
export async function getSession(): Promise<Session> {
  await connection();
  const { refreshToken } = await getSessionTokens();
  const user = await getCurrentUser({ allowRefresh: false });
  if (user) return { status: "authenticated", user };
  return refreshToken ? { status: "expired", user: null } : { status: "anonymous", user: null };
}
