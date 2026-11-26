import {
  REFRESH_TOKEN_MAX_AGE_CAP_SECONDS,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
} from "@/lib/auth/constants";

/**
 * Lee el claim `exp` de un JWT SIN verificar la firma. Solo se usa para
 * calcular la vida de la cookie; la validación real la hace FastAPI.
 */
export function decodeJwtExp(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json: unknown = JSON.parse(atob(padded));
    if (typeof json === "object" && json !== null && "exp" in json) {
      const exp = (json as { exp: unknown }).exp;
      return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** `maxAge` (segundos) de la cookie del refresh token: `exp - now`, acotado. */
export function refreshTokenMaxAge(token: string, nowMs: number = Date.now()): number {
  const exp = decodeJwtExp(token);
  if (exp === null) return REFRESH_TOKEN_MAX_AGE_SECONDS;
  const remaining = Math.floor(exp - nowMs / 1000);
  if (remaining <= 0) return REFRESH_TOKEN_MAX_AGE_SECONDS;
  return Math.min(remaining, REFRESH_TOKEN_MAX_AGE_CAP_SECONDS);
}
