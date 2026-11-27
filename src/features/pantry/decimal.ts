/**
 * Aritmética decimal exacta para cantidades de lotes. FastAPI serializa
 * `Numeric(10, 3)` como `string`; operar con `Number` directamente acumularía
 * errores binarios (`0.1 + 0.2`). Aquí se escalan a milésimas enteras: el
 * máximo (9 999 999.999 → 9 999 999 999) cabe holgado en
 * `Number.MAX_SAFE_INTEGER`.
 */

const SCALE = 1000;

/**
 * Convierte una cantidad decimal a milésimas enteras.
 *
 * @param value - `"1.5"`, `"250"`, `"0.125"` o un `number`.
 * @returns Milésimas (`"1.5"` → `1500`); `0` si no es un número válido.
 */
export function toMilli(value: string | number): number {
  const text = String(value).trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) return 0;
  const negative = text.startsWith("-");
  const [int = "0", frac = ""] = text.replace("-", "").split(".");
  const milli = Number(int) * SCALE + Number(frac.padEnd(3, "0").slice(0, 3));
  return negative ? -milli : milli;
}

/**
 * Convierte milésimas enteras a la cadena decimal canónica de FastAPI.
 *
 * @param milli - Milésimas (`1500`).
 * @returns `"1.5"` (sin ceros de relleno).
 */
export function fromMilli(milli: number): string {
  const negative = milli < 0;
  const abs = Math.abs(Math.round(milli));
  const int = Math.floor(abs / SCALE);
  const frac = String(abs % SCALE).padStart(3, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/**
 * Suma cantidades decimales sin error de coma flotante.
 *
 * @param values - Cantidades como `string`.
 * @returns La suma como `string` decimal.
 *
 * @example
 * ```ts
 * sumDecimals(["0.1", "0.2"]); // "0.3"
 * ```
 */
export function sumDecimals(values: readonly string[]): string {
  return fromMilli(values.reduce((acc, value) => acc + toMilli(value), 0));
}

/**
 * Compara dos cantidades decimales.
 *
 * @returns Negativo si `a < b`, `0` si son iguales, positivo si `a > b`.
 */
export function compareDecimals(a: string, b: string): number {
  return toMilli(a) - toMilli(b);
}
