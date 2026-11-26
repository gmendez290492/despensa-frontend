import "server-only";

import createClient from "openapi-fetch";
import type { paths } from "@/lib/api/schema";
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

/**
 * Cliente `openapi-fetch` servidor→FastAPI (`server-only`), sin caché.
 *
 * @param options.correlationId - Se envía como `X-Correlation-ID`.
 * @param options.accessToken - Si se indica, se envía como `Authorization: Bearer`.
 * @returns Cliente tipado con `paths`.
 */
export function createBackendClient({ correlationId, accessToken }: BackendClientOptions) {
  const headers: Record<string, string> = {
    Accept: "application/json, application/problem+json",
    [CORRELATION_HEADER]: correlationId,
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  return createClient<paths>({
    baseUrl: getBackendBaseUrl(),
    headers,
    cache: "no-store",
  });
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
    );
  }
  return data as Exclude<R["data"], undefined>;
}
