import { CORRELATION_HEADER, createCorrelationId } from "@/lib/api/correlation";
import { networkProblem, parseProblemResponse, type ProblemDetailError } from "@/lib/api/problem";
import { delay, rateLimitRetryDelayMs } from "@/lib/api/rate-limit";

/**
 * `fetch` del navegador hacia `/api/bff/*`. Las cookies HttpOnly viajan solas
 * (`credentials: "same-origin"`); el JS nunca ve los tokens.
 *
 * - Genera/propaga `X-Correlation-ID`.
 * - Ante `401` (salvo en rutas de auth) llama una vez a
 *   `POST /api/bff/auth/refresh` -compartiendo una única promesa en vuelo
 *   entre peticiones concurrentes- y reintenta.
 * - Si el refresh responde `429` (rate limit de FastAPI, 30/min por IP), espera
 *   `Retry-After` (hasta {@link RATE_LIMIT_RETRY_CAP_SECONDS} s) y lo reintenta
 *   una vez dentro de la misma promesa compartida. Si persiste, lanza el `429`
 *   (con `retry_after`), no el `401`: la sesión sigue viva.
 * - Solo un `401`/`403` real del refresh termina como sesión caducada (se lanza
 *   el `401` original).
 * - Lanza `ProblemDetailError` en cualquier respuesta no-2xx.
 */

const REFRESH_ENDPOINT = "/api/bff/auth/refresh";
const NO_REFRESH_PREFIX = "/api/bff/auth/";

/** Tope (s) de espera ante `429` del refresh; reexportado para tests y UI. */
export { RATE_LIMIT_RETRY_CAP_SECONDS } from "@/lib/api/rate-limit";

/** Resultado de un intento de refresh (ver {@link refreshSessionOnce}). */
export interface RefreshOutcome {
  ok: boolean;
  /** Código HTTP del refresh (`0` si hubo error de red). */
  status: number;
  /** Segundos de `Retry-After` si el refresh respondió `429`. */
  retryAfter: number | undefined;
  /** Error normalizado si `ok` es `false`. */
  problem: ProblemDetailError | undefined;
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

async function attemptRefresh(): Promise<RefreshOutcome> {
  const correlationId = createCorrelationId();
  let response: Response;
  try {
    response = await fetch(REFRESH_ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      // El BFF exige JSON en todas las mutaciones (defensa CSRF), aunque no haya body.
      headers: {
        [CORRELATION_HEADER]: correlationId,
        "Content-Type": "application/json",
      },
    });
  } catch {
    return { ok: false, status: 0, retryAfter: undefined, problem: networkProblem(undefined, correlationId) };
  }
  if (response.ok) return { ok: true, status: response.status, retryAfter: undefined, problem: undefined };
  const problem = await parseProblemResponse(response);
  return { ok: false, status: response.status, retryAfter: problem.retry_after, problem };
}

async function refreshWithRateLimitRetry(): Promise<RefreshOutcome> {
  const first = await attemptRefresh();
  if (first.status !== 429) return first;
  const waitMs = rateLimitRetryDelayMs(first.retryAfter);
  // Espera mayor que el tope: no bloquear, propagar el 429.
  if (waitMs === null) return first;
  await delay(waitMs);
  return attemptRefresh();
}

/**
 * Refresca la sesión compartiendo una única promesa en vuelo (mutex cliente):
 * peticiones concurrentes con `401` -y el posible reintento tras un `429`-
 * esperan el mismo resultado sin disparar refreshes adicionales.
 *
 * @returns {@link RefreshOutcome}; nunca rechaza.
 */
function refreshSessionOnce(): Promise<RefreshOutcome> {
  refreshInFlight ??= refreshWithRateLimitRetry().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** `true` si el refresh fue rechazado por credenciales (sesión realmente caducada). */
function isSessionRejected(outcome: RefreshOutcome): boolean {
  return outcome.status === 401 || outcome.status === 403;
}

/** Opciones de {@link bffFetch}: `RequestInit` + atajo `json` para cuerpos JSON. */
export interface BffRequestInit extends Omit<RequestInit, "body"> {
  /** Se serializa como JSON si se indica. */
  json?: unknown;
  body?: BodyInit | null;
}

/**
 * `fetch` hacia el BFF con correlation ID, cabeceras JSON y un reintento tras
 * refrescar la sesión ante `401` (ver bloque de módulo).
 *
 * @param path - Ruta relativa `/api/bff/...`.
 * @param init - {@link BffRequestInit}.
 * @returns La `Response` 2xx.
 * @throws {ProblemDetailError} En respuestas no-2xx o error de red (`network-error`).
 *   Si el refresh falla por `429`/5xx/red se lanza ese error en vez del `401`.
 */
export async function bffFetch(path: string, init: BffRequestInit = {}): Promise<Response> {
  const { json, headers: initHeaders, ...rest } = init;
  const correlationId = createCorrelationId();

  const send = () => {
    const headers = new Headers(initHeaders);
    headers.set(CORRELATION_HEADER, correlationId);
    headers.set("Accept", "application/json, application/problem+json");
    let body = rest.body;
    if (json !== undefined) {
      body = JSON.stringify(json);
    }
    // Mutaciones: siempre `application/json` (el BFF responde 415 si no),
    // también en logout/refresh sin body.
    const method = (rest.method ?? "GET").toUpperCase();
    if (json !== undefined || (method !== "GET" && method !== "HEAD" && !headers.has("Content-Type"))) {
      headers.set("Content-Type", "application/json");
    }
    return fetch(path, { ...rest, body, headers, credentials: "same-origin" });
  };

  const sendOrThrow = async () => {
    try {
      return await send();
    } catch {
      throw networkProblem(undefined, correlationId);
    }
  };

  let response = await sendOrThrow();
  if (response.status === 401 && !path.startsWith(NO_REFRESH_PREFIX)) {
    const outcome = await refreshSessionOnce();
    if (outcome.ok) {
      response = await sendOrThrow();
    } else if (!isSessionRejected(outcome) && outcome.problem) {
      // 429 persistente, 5xx o red: la sesión puede seguir siendo válida.
      throw outcome.problem;
    }
    // 401/403 del refresh: cae al `throw` del 401 original (sesión caducada).
  }

  if (!response.ok) throw await parseProblemResponse(response);
  return response;
}

/**
 * `bffFetch` + parseo JSON tipado (usa tipos de `@/lib/api/schema`).
 *
 * @param path - Ruta relativa `/api/bff/...`.
 * @param init - {@link BffRequestInit}.
 * @returns El cuerpo JSON tipado como `T`.
 * @throws {ProblemDetailError} Igual que {@link bffFetch}.
 */
export async function bffJson<T>(path: string, init?: BffRequestInit): Promise<T> {
  const response = await bffFetch(path, init);
  return (await response.json()) as T;
}
