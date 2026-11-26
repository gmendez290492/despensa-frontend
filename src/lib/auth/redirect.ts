import { AUTH_ROUTES, DEFAULT_AUTHENTICATED_PATH } from "@/lib/auth/constants";

const INTERNAL_ORIGIN = "http://internal.invalid";
// Caracteres de control / espacios que los navegadores eliminan o normalizan.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F\s\\]/;

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Prevención de Open Redirect: devuelve `next` solo si es una ruta interna
 * relativa (`/ruta?x=1#h`). Rechaza URLs absolutas, protocol-relative
 * (`//evil.com`), barras invertidas, caracteres de control, rutas `/api/*`
 * y las propias rutas de auth (para evitar bucles). En cualquier otro caso
 * devuelve `fallback`.
 */
export function safeRedirectPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_AUTHENTICATED_PATH,
): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) {
    return fallback;
  }
  if (!next.startsWith("/") || next.startsWith("//")) return fallback;
  if (UNSAFE_CHARS.test(next)) return fallback;

  let url: URL;
  try {
    url = new URL(next, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== INTERNAL_ORIGIN) return fallback;

  const pathname = url.pathname;

  // Rechaza también variantes percent-encoded (`%0d%0a`, `%5C`, `/%2F%2F`).
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return fallback;
  }
  if (UNSAFE_CHARS.test(decoded) || decoded.startsWith("//")) return fallback;

  if (pathname === "/api" || pathname.startsWith("/api/")) return fallback;
  if (isAuthRoute(pathname)) return fallback;

  return `${pathname}${url.search}${url.hash}`;
}
