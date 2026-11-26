/** Propagación de `X-Correlation-ID` (isomórfico: cliente, proxy y BFF). */

/** Nombre de la cabecera (en minúsculas, como la normaliza `Headers`). */
export const CORRELATION_HEADER = "x-correlation-id";

// Acepta UUIDs y tokens opacos razonables; descarta valores que permitan
// inyección en logs o cabeceras.
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Genera un correlation ID nuevo (UUID v4).
 *
 * @returns UUID de `crypto.randomUUID()` (Baseline Widely available).
 */
export function createCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Comprueba que un correlation ID entrante es seguro para reenviar en cabeceras y logs.
 *
 * @param value - Valor de la cabecera `X-Correlation-ID`.
 * @returns `true` si son 8-128 caracteres `[A-Za-z0-9._-]`.
 */
export function isValidCorrelationId(value: string | null | undefined): value is string {
  return typeof value === "string" && SAFE_CORRELATION_ID.test(value);
}

/** Reutiliza el ID entrante si es seguro; si no, genera uno nuevo. */
export function resolveCorrelationId(headers: Pick<Headers, "get">): string {
  const incoming = headers.get(CORRELATION_HEADER);
  return isValidCorrelationId(incoming) ? incoming : createCorrelationId();
}
