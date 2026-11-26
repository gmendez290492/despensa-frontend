import "server-only";

import { headers as requestHeaders } from "next/headers";
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@/lib/api/schema";
import { resolveClientIp } from "@/lib/api/client-ip";
import { CORRELATION_HEADER } from "@/lib/api/correlation";
import {
  networkProblem,
  PROBLEM_TYPES,
  ProblemDetailError,
  toProblemDetailError,
} from "@/lib/api/problem";

/**
 * URL base de FastAPI para el cliente servidor→FastAPI. `BACKEND_API_URL` es
 * una variable privada del servidor (nunca `NEXT_PUBLIC_*`).
 *
 * @returns La URL sin barras finales (por defecto `http://localhost:8000`).
 */
export function getBackendBaseUrl(): string {
  return (process.env.BACKEND_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");
}

/** Opciones de {@link createBackendClient}. */
export interface BackendClientOptions {
  correlationId: string;
  accessToken?: string;
}

/** Cabecera con la IP real del navegador que FastAPI usa para su rate limit. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

/**
 * IP del navegador de la petición en curso (ver `client-ip.ts`), o `null` si
 * no hay petición (fuera del ámbito de `headers()`) o no es fiable.
 *
 * @returns La IP a reenviar o `null`.
 */
export async function getRequestClientIp(): Promise<string | null> {
  try {
    return resolveClientIp(await requestHeaders());
  } catch {
    return null;
  }
}

/**
 * Middleware de `openapi-fetch` que reenvía la IP del navegador a FastAPI en
 * `X-Forwarded-For`. Sustituye cualquier valor previo: nunca se reenvía a
 * ciegas la cabecera que mandó el navegador.
 *
 * @remarks FastAPI solo confía en la cabecera si el emisor (el BFF) está en su
 * `FORWARDED_ALLOW_IPS`. Si el BFF se despliega fuera de la VPC, hay que
 * añadir su rango allí.
 */
const forwardClientIp: Middleware = {
  async onRequest({ request }) {
    request.headers.delete(FORWARDED_FOR_HEADER);
    const ip = await getRequestClientIp();
    if (ip) request.headers.set(FORWARDED_FOR_HEADER, ip);
    return request;
  },
};

/**
 * Cliente `openapi-fetch` servidor→FastAPI (`server-only`), sin caché.
 *
 * @param options.correlationId - Se envía como `X-Correlation-ID`.
 * @param options.accessToken - Si se indica, se envía como `Authorization: Bearer`.
 * @returns Cliente tipado con `paths`; cada petición lleva `X-Forwarded-For` con
 *   la IP del navegador cuando es fiable.
 */
export function createBackendClient({ correlationId, accessToken }: BackendClientOptions) {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
    [CORRELATION_HEADER]: correlationId,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const client = createClient<paths>({
    baseUrl: getBackendBaseUrl(),
    headers,
    cache: "no-store",
  });
  client.use(forwardClientIp);
  return client;
}

/** Tipo del cliente devuelto por {@link createBackendClient}. */
export type BackendClient = ReturnType<typeof createBackendClient>;

interface OpenApiFetchResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

/**
 * Ejecuta una llamada `openapi-fetch` y devuelve `data` o lanza
 * `ProblemDetailError` (RFC 7807) con el `correlation_id` del backend.
 */
export async function unwrap<R extends OpenApiFetchResult>(
  call: Promise<R>,
  correlationId: string,
): Promise<Exclude<R["data"], undefined>> {
  let result: R;
  try {
    result = await call;
  } catch (cause) {
    if (cause instanceof ProblemDetailError) throw cause;
    throw networkProblem(PROBLEM_TYPES.backendUnavailable, correlationId);
  }

  const { data, error, response } = result;
  if (!response.ok || error !== undefined) {
    throw toProblemDetailError(
      error,
      response.status,
      response.headers.get(CORRELATION_HEADER) ?? correlationId,
      response.headers.get("retry-after"),
    );
  }
  return data as Exclude<R["data"], undefined>;
}
