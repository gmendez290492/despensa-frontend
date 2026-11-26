import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { CORRELATION_HEADER, resolveCorrelationId } from "@/lib/api/correlation";
import {
  PROBLEM_JSON_CONTENT_TYPE,
  PROBLEM_TYPES,
  ProblemDetailError,
  problemTypeUri,
  type ProblemFieldError,
} from "@/lib/api/problem";

/** Utilidades HTTP compartidas por los Route Handlers `/api/bff/*`. */

/**
 * Correlation ID de la petición: reutiliza el entrante si es seguro o genera uno.
 *
 * @param request - Petición del Route Handler.
 * @returns ID a propagar a FastAPI y a la respuesta.
 */
export function getCorrelationId(request: NextRequest): string {
  return resolveCorrelationId(request.headers);
}

/**
 * Añade `X-Correlation-ID` y `Cache-Control: no-store` a una respuesta del BFF.
 *
 * @param response - Respuesta a modificar (se muta y se devuelve).
 * @param correlationId - ID de la petición.
 * @returns La misma respuesta.
 */
export function withCorrelation<T extends Response>(response: T, correlationId: string): T {
  response.headers.set(CORRELATION_HEADER, correlationId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * Respuesta JSON del BFF con correlation ID y sin caché.
 *
 * @param body - Cuerpo serializable.
 * @param correlationId - ID de la petición.
 * @param init - `status` y cabeceras extra.
 * @returns `NextResponse` JSON.
 */
export function jsonResponse(
  body: unknown,
  correlationId: string,
  init: ResponseInit = {},
): NextResponse {
  return withCorrelation(NextResponse.json(body, init), correlationId);
}

/**
 * Respuesta sin cuerpo (por defecto `204`).
 *
 * @param correlationId - ID de la petición.
 * @param status - Código HTTP.
 * @returns `NextResponse` vacía.
 */
export function emptyResponse(correlationId: string, status = 204): NextResponse {
  return withCorrelation(new NextResponse(null, { status }), correlationId);
}

/**
 * Serializa un {@link ProblemDetailError} como `application/problem+json`,
 * conservando el `correlation_id` del backend si lo trae y reenviando
 * `Retry-After` cuando el error lo conoce (`429`).
 *
 * @param error - Error a serializar.
 * @param correlationId - ID de respaldo.
 * @returns `NextResponse` con el `status` del error.
 */
export function problemResponse(error: ProblemDetailError, correlationId: string): NextResponse {
  const effectiveCorrelation = error.correlation_id ?? correlationId;
  const body = { ...error.toJSON(), correlation_id: effectiveCorrelation };
  const response = new NextResponse(JSON.stringify(body), {
    status: error.status,
    headers: { "Content-Type": PROBLEM_JSON_CONTENT_TYPE },
  });
  // El navegador recibe `Retry-After` tanto en la cabecera como en `retry_after`.
  if (error.retry_after !== undefined) {
    response.headers.set("Retry-After", String(error.retry_after));
  }
  return withCorrelation(response, effectiveCorrelation);
}

/** Convierte cualquier excepción en respuesta problem+json. */
export function handleError(error: unknown, correlationId: string): NextResponse {
  if (error instanceof ProblemDetailError) return problemResponse(error, correlationId);
  console.error("[bff] error no controlado", { correlationId, error });
  return problemResponse(
    new ProblemDetailError({
      type: problemTypeUri(PROBLEM_TYPES.unknown),
      title: "Internal Server Error",
      status: 500,
      detail: "Error interno del servidor.",
      correlation_id: correlationId,
    }),
    correlationId,
  );
}

function parseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Origen canónico de la app. Se toma de `APP_ORIGIN` (configuración de
 * servidor); si no existe, del origen de `request.nextUrl`. Nunca de
 * `X-Forwarded-Host`/`Host`, que el cliente puede falsear.
 */
export function getExpectedOrigin(request: NextRequest): string {
  return parseOrigin(process.env.APP_ORIGIN) ?? request.nextUrl.origin;
}

/** Valores de `Sec-Fetch-Site` aceptables para una petición sin `Origin`. */
const SAFE_FETCH_SITES = new Set(["same-origin", "none"]);

function forbiddenOrigin(correlationId: string): ProblemDetailError {
  return new ProblemDetailError({
    type: problemTypeUri(PROBLEM_TYPES.forbiddenOrigin),
    title: "Forbidden",
    status: 403,
    detail: "Origen de la petición no permitido.",
    correlation_id: correlationId,
  });
}

/**
 * Defensa CSRF adicional a `SameSite=Lax`:
 * - Con `Origin`: debe coincidir exactamente con `getExpectedOrigin()`.
 * - Sin `Origin`: si hay `Sec-Fetch-Site`, debe ser `same-origin` o `none`.
 *   (Clientes sin ninguna de las dos cabeceras, p. ej. curl, se aceptan: no
 *   son un vector CSRF porque un navegador siempre envía al menos una.)
 */
export function assertSameOrigin(request: NextRequest, correlationId: string): void {
  const rawOrigin = request.headers.get("origin");
  if (rawOrigin !== null) {
    if (parseOrigin(rawOrigin) !== getExpectedOrigin(request)) {
      throw forbiddenOrigin(correlationId);
    }
    return;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && !SAFE_FETCH_SITES.has(fetchSite.toLowerCase())) {
    throw forbiddenOrigin(correlationId);
  }
}

/** `415` si el `Content-Type` no es `application/json` (bloquea formularios CSRF "simples"). */
export function assertJsonContentType(request: NextRequest, correlationId: string): void {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ProblemDetailError({
      type: problemTypeUri(PROBLEM_TYPES.unsupportedMediaType),
      title: "Unsupported Media Type",
      status: 415,
      detail: "El Content-Type debe ser application/json.",
      correlation_id: correlationId,
    });
  }
}

/** Origen + Content-Type para mutaciones del BFF. */
export function assertSafeMutation(request: NextRequest, correlationId: string): void {
  assertSameOrigin(request, correlationId);
  assertJsonContentType(request, correlationId);
}

function invalidRequest(
  correlationId: string,
  detail: string,
  errors?: ProblemFieldError[],
): ProblemDetailError {
  return new ProblemDetailError({
    type: problemTypeUri(PROBLEM_TYPES.invalidRequest),
    title: "Bad Request",
    status: 400,
    detail,
    correlation_id: correlationId,
    ...(errors ? { errors } : {}),
  });
}

/** Lee el JSON del body y lo valida con Zod; lanza 400 problem+json si falla. */
export async function parseJsonBody<S extends z.ZodType>(
  request: NextRequest,
  schema: S,
  correlationId: string,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw invalidRequest(correlationId, "El cuerpo de la petición debe ser JSON válido.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const errors: ProblemFieldError[] = result.error.issues.map((issue) => ({
      loc: issue.path.filter(
        (part): part is string | number => typeof part === "string" || typeof part === "number",
      ),
      msg: issue.message,
      type: issue.code,
    }));
    throw invalidRequest(
      correlationId,
      errors[0]?.msg ?? "La petición contiene datos inválidos.",
      errors,
    );
  }
  return result.data;
}
