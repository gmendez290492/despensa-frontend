import "server-only";

import type { components } from "@/lib/api/schema";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { createHash, randomBytes } from "node:crypto";
import { createRefreshMutex, DEFAULT_REFRESH_GRACE_MS } from "@/lib/auth/refresh-mutex";

/** Par de tokens de FastAPI (tipo generado desde OpenAPI). */
export type TokenResponse = components["schemas"]["TokenResponse"];

/** Clave del mutex: SHA-256 del token (no se retienen tokens en claro como clave). */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cabecera de FastAPI que liga la sesión al BFF (ver `CLIENT_BINDING_COOKIE`). */
export const CLIENT_BINDING_HEADER = "X-Client-Binding";

/**
 * Genera un `X-Client-Binding` nuevo: 32 bytes aleatorios en base64url
 * (43 caracteres; FastAPI admite hasta 256).
 *
 * @returns Valor opaco por sesión.
 */
export function createClientBinding(): string {
  return randomBytes(32).toString("base64url");
}

type TokenMutex = ReturnType<typeof createRefreshMutex<TokenResponse>>;

// Singletons del proceso (sobreviven a HMR en dev vía globalThis).
const globalForRefresh = globalThis as typeof globalThis & {
  __despensaRefreshMutexV2?: TokenMutex;
  __despensaBoundRefreshMutex?: TokenMutex;
};

/**
 * Sesiones sin binding (creadas antes de activarlo): FastAPI revoca la familia
 * ante el reuso, así que el BFF mantiene su ventana de gracia de 5 s.
 */
const legacyRefreshMutex = (globalForRefresh.__despensaRefreshMutexV2 ??=
  createRefreshMutex<TokenResponse>({
    graceMs: DEFAULT_REFRESH_GRACE_MS,
    hashKey: hashRefreshToken,
  }));

/**
 * Sesiones con binding: FastAPI devuelve el mismo par sucesor si se presenta
 * el refresh anterior dentro de 10 s, así que el BFF ya no necesita ventana de
 * gracia (`graceMs: 0`). Se conserva la deduplicación de llamadas en vuelo.
 */
const boundRefreshMutex = (globalForRefresh.__despensaBoundRefreshMutex ??=
  createRefreshMutex<TokenResponse>({ graceMs: 0, hashKey: hashRefreshToken }));

/**
 * Rota el par de tokens contra `POST /api/v1/auth/refresh` serializando las
 * llamadas concurrentes con el mismo refresh_token (una sola petición real).
 *
 * @param refreshToken - Refresh token de la cookie.
 * @param correlationId - ID de la petición.
 * @param clientBinding - `X-Client-Binding` de la sesión, si la sesión lo tiene.
 *   Con binding no hay ventana de gracia en el BFF (la gestiona FastAPI).
 * @returns El par rotado.
 * @throws {ProblemDetailError} Si FastAPI rechaza el token o el binding (`401`).
 */
export function refreshTokens(
  refreshToken: string,
  correlationId: string,
  clientBinding?: string,
): Promise<TokenResponse> {
  const mutex = clientBinding ? boundRefreshMutex : legacyRefreshMutex;
  return mutex.run(refreshToken, () =>
    unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/refresh", {
        body: { refresh_token: refreshToken },
        ...(clientBinding ? { params: { header: { [CLIENT_BINDING_HEADER]: clientBinding } } } : {}),
      }),
      correlationId,
    ),
  );
}

/** Descarta resultados cacheados del token en ambos mutex (p. ej. tras logout). */
export function forgetRefreshToken(refreshToken: string): void {
  legacyRefreshMutex.forget(refreshToken);
  boundRefreshMutex.forget(refreshToken);
}
