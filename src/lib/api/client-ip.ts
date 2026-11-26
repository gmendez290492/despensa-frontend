import { isIP } from "node:net";

/**
 * Resolución de la IP real del navegador para reenviarla a FastAPI en
 * `X-Forwarded-For` (el rate limit del backend es por IP).
 *
 * Next 16 no expone la IP del socket en Route Handlers: solo rellena
 * `x-forwarded-for` con `socket.remoteAddress` **si la cabecera no viene**
 * (`??=`). Por eso la lista que llega puede empezar con valores inventados por
 * el cliente y solo son fiables las entradas que añadieron proxies propios.
 *
 * Regla: con `N` saltos de confianza delante de Next (`TRUSTED_PROXY_HOPS`),
 * la IP del cliente es la entrada `len - N` de la lista (contando desde 1).
 *
 * - `N = 1` (por defecto): sirve tanto en local (Next pone la IP del socket y
 *   la lista tiene 1 elemento) como detrás de un único proxy/ALB que añade la IP
 *   de quien se conectó a él (los valores que mande el navegador quedan a la
 *   izquierda y se ignoran).
 * - `N = 0`: no se reenvía nada (FastAPI verá la IP del BFF).
 *
 * Limitación: sin proxy delante, un navegador que envía su propio
 * `X-Forwarded-For` directamente a Next puede elegir su IP. En producción Next
 * debe ir detrás de un proxy de confianza.
 *
 * @see https://developer.mozilla.org/docs/Web/HTTP/Headers/X-Forwarded-For#selecting_an_ip_address
 */

/** Saltos de proxy de confianza por defecto (ver bloque de módulo). */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;

/**
 * Lee `TRUSTED_PROXY_HOPS` (entero ≥ 0).
 *
 * @param value - Valor crudo de la variable de entorno.
 * @returns Número de saltos; {@link DEFAULT_TRUSTED_PROXY_HOPS} si falta o es inválido.
 */
export function parseTrustedProxyHops(value: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TRUSTED_PROXY_HOPS;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * Normaliza una entrada de `X-Forwarded-For` y la valida como IPv4/IPv6.
 * Acepta `[::1]:443` y `1.2.3.4:5678`; rechaza nombres de host, `unknown` y
 * cualquier valor con caracteres extraños.
 *
 * @param raw - Entrada individual de la lista.
 * @returns La IP normalizada o `null`.
 */
export function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (value.length === 0 || value.length > 64) return null;
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  return isIP(value) === 0 ? null : value;
}

/**
 * Elige la IP del cliente a partir de `X-Forwarded-For`.
 *
 * @param headers - Cabeceras de la petición entrante (solo se usa `get`).
 * @param hops - Saltos de confianza; por defecto `TRUSTED_PROXY_HOPS`.
 * @returns La IP validada o `null` si no hay una fiable (no se reenvía nada).
 *
 * @example
 * ```ts
 * // ALB delante de Next (hops = 1): el navegador intentó falsear "6.6.6.6".
 * resolveClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), 1); // "203.0.113.7"
 * ```
 */
export function resolveClientIp(
  headers: Pick<Headers, "get">,
  hops: number = parseTrustedProxyHops(),
): string | null {
  if (hops <= 0) return null;
  const header = headers.get("x-forwarded-for");
  if (!header) return null;
  const entries = header.split(",");
  const index = entries.length - hops;
  if (index < 0) return null;
  return normalizeIp(entries[index]!);
}
