import { CORRELATION_HEADER, createCorrelationId } from "@/lib/api/correlation";
import { networkProblem, parseProblemResponse } from "@/lib/api/problem";

/**
 * `fetch` del navegador hacia `/api/bff/*`. Las cookies HttpOnly viajan solas
 * (`credentials: "same-origin"`); el JS nunca ve los tokens.
 *
 * - Genera/propaga `X-Correlation-ID`.
 * - Ante `401` (salvo en rutas de auth) llama una vez a
 *   `POST /api/bff/auth/refresh` -compartiendo una única promesa en vuelo
 *   entre peticiones concurrentes- y reintenta.
 * - Lanza `ProblemDetailError` en cualquier respuesta no-2xx.
 */

const REFRESH_ENDPOINT = "/api/bff/auth/refresh";
const NO_REFRESH_PREFIX = "/api/bff/auth/";

let refreshInFlight: Promise<boolean> | null = null;

function refreshSessionOnce(): Promise<boolean> {
  refreshInFlight ??= fetch(REFRESH_ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    // El BFF exige JSON en todas las mutaciones (defensa CSRF), aunque no haya body.
    headers: {
      [CORRELATION_HEADER]: createCorrelationId(),
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
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

  let response: Response;
  try {
    response = await send();
    if (response.status === 401 && !path.startsWith(NO_REFRESH_PREFIX)) {
      if (await refreshSessionOnce()) response = await send();
    }
  } catch {
    throw networkProblem(undefined, correlationId);
  }

  if (!response.ok) throw await parseProblemResponse(response);
  return response;
}

/** `bffFetch` + parseo JSON tipado (usa tipos de `@/lib/api/schema`). */
export async function bffJson<T>(path: string, init?: BffRequestInit): Promise<T> {
  const response = await bffFetch(path, init);
  return (await response.json()) as T;
}
