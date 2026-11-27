/**
 * Política común ante `429 rate-limit-exceeded` en `POST /api/v1/auth/refresh`
 * y `/logout` (FastAPI: 30/min por IP y ruta, con `Retry-After`).
 *
 * Módulo isomórfico: lo usan `bffFetch` (navegador) y `revokePreviousSession`
 * (BFF). Solo se reintenta una vez y solo si la espera cabe en el tope: no
 * tiene sentido bloquear la UI o un Route Handler durante un minuto.
 */

/** Espera máxima (s) que se acepta para reintentar refresh/logout tras un `429`. */
export const RATE_LIMIT_RETRY_CAP_SECONDS = 5;

/** Espera (s) si el `429` no trae `Retry-After` (ni `retry_after` en el cuerpo). */
export const RATE_LIMIT_DEFAULT_RETRY_SECONDS = 1;

/**
 * Calcula cuánto esperar antes del único reintento tras un `429`.
 *
 * @param retryAfterSeconds - `Retry-After` ya interpretado (`ProblemDetailError.retry_after`).
 * @param capSeconds - Tope (por defecto {@link RATE_LIMIT_RETRY_CAP_SECONDS}).
 * @returns Milisegundos a esperar, o `null` si la espera excede el tope (no reintentar).
 *
 * @example
 * ```ts
 * rateLimitRetryDelayMs(2); // 2000
 * rateLimitRetryDelayMs(60); // null -> propagar el 429 sin esperar
 * rateLimitRetryDelayMs(undefined); // 1000
 * ```
 */
export function rateLimitRetryDelayMs(
  retryAfterSeconds: number | undefined,
  capSeconds: number = RATE_LIMIT_RETRY_CAP_SECONDS,
): number | null {
  const seconds = retryAfterSeconds ?? RATE_LIMIT_DEFAULT_RETRY_SECONDS;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > capSeconds) return null;
  return seconds * 1000;
}

/**
 * Promesa que se resuelve tras `ms` milisegundos (compatible con fake timers).
 *
 * @param ms - Milisegundos.
 * @returns Promesa vacía.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
