import "server-only";

import type { components } from "@/lib/api/schema";
import { createBackendClient, unwrap } from "@/lib/api/server-client";
import { createHash } from "node:crypto";
import { createRefreshMutex, DEFAULT_REFRESH_GRACE_MS } from "@/lib/auth/refresh-mutex";

/** Par de tokens de FastAPI (tipo generado desde OpenAPI). */
export type TokenResponse = components["schemas"]["TokenResponse"];

/** Clave del mutex: SHA-256 del token (no se retienen tokens en claro como clave). */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Singleton del proceso (sobrevive a HMR en dev vía globalThis).
const globalForRefresh = globalThis as typeof globalThis & {
  __despensaRefreshMutexV2?: ReturnType<typeof createRefreshMutex<TokenResponse>>;
};

const refreshMutex = (globalForRefresh.__despensaRefreshMutexV2 ??=
  createRefreshMutex<TokenResponse>({
    graceMs: DEFAULT_REFRESH_GRACE_MS,
    hashKey: hashRefreshToken,
  }));

/**
 * Rota el par de tokens contra `POST /api/v1/auth/refresh` serializando las
 * llamadas concurrentes con el mismo refresh_token (una sola petición real).
 * Lanza `ProblemDetailError` si FastAPI rechaza el token.
 */
export function refreshTokens(
  refreshToken: string,
  correlationId: string,
): Promise<TokenResponse> {
  return refreshMutex.run(refreshToken, () =>
    unwrap(
      createBackendClient({ correlationId }).POST("/api/v1/auth/refresh", {
        body: { refresh_token: refreshToken },
      }),
      correlationId,
    ),
  );
}

/** Descarta resultados cacheados del token (p. ej. tras logout). */
export function forgetRefreshToken(refreshToken: string): void {
  refreshMutex.forget(refreshToken);
}
