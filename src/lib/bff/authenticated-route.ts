import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PROBLEM_TYPES, ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import type { BackendClient } from "@/lib/api/server-client";
import { authenticatedRequest } from "@/lib/auth/session";
import {
  assertSafeMutation,
  emptyResponse,
  getCorrelationId,
  handleError,
  jsonResponse,
  parseJsonBody,
} from "@/lib/bff/http";

/**
 * Plumbing común de los Route Handlers autenticados del BFF (`/api/bff/*`
 * salvo auth): correlation ID, defensa CSRF en mutaciones, Bearer desde
 * cookie `HttpOnly` con rotación (mutex) ante `401` y serialización RFC 7807.
 *
 * Cada ruta declara explícitamente el endpoint de FastAPI al que llama
 * (allowlist): el BFF nunca reenvía rutas arbitrarias del navegador.
 */

/** Contexto que recibe el callback de {@link handleAuthenticated}. */
export interface AuthenticatedRouteContext<B = undefined, P extends string = never> {
  /** ID de la petición, ya propagado a FastAPI como `X-Correlation-ID`. */
  correlationId: string;
  /** Segmentos de `options.uuidParams` ya validados como UUID (minúsculas). */
  params: Record<P, string>;
  /** Cuerpo validado con `options.body` (o `undefined` si no se pidió). */
  body: B;
  /**
   * `Idempotency-Key` validado (solo con `options.idempotent`). Pásalo a FastAPI
   * con {@link idempotencyHeaders}.
   */
  idempotencyKey: string | undefined;
}

/** Opciones de {@link handleAuthenticated}. */
export interface HandleAuthenticatedOptions<
  S extends z.ZodType | undefined = undefined,
  P extends string = never,
> {
  /**
   * `true` en POST/PATCH/DELETE: exige mismo origen y `Content-Type:
   * application/json` antes de tocar FastAPI.
   */
  mutation?: boolean;
  /**
   * Segmentos dinámicos de la ruta que deben ser UUID (`{ pantryId }`). Se
   * validan **antes** de leer cookies o rotar tokens: un `pantryId` inválido
   * (`not-a-uuid`, `..%2F..%2Fusers`) responde `400` sin tocar FastAPI.
   */
  uuidParams?: Record<P, string | undefined>;
  /**
   * Esquema Zod del cuerpo JSON. Se lee y valida **una sola vez**, antes de la
   * llamada autenticada: si hay que rotar tokens y reintentar, el cuerpo ya
   * está parseado (un `Request` solo se puede leer una vez).
   */
  body?: S;
  /** Lee y valida la cabecera `Idempotency-Key` (ver {@link readIdempotencyKey}). */
  idempotent?: boolean;
  /** Código HTTP de éxito (por defecto `200`; `204` responde sin cuerpo). */
  successStatus?: number;
}

type BodyOf<S> = S extends z.ZodType ? z.output<S> : undefined;

/**
 * Ejecuta una llamada autenticada servidor→FastAPI y la convierte en respuesta
 * del BFF.
 *
 * @param request - Petición del Route Handler.
 * @param call - Recibe el cliente tipado (con Bearer) y el contexto (correlation
 *   ID y cuerpo validado); devuelve el cuerpo de la respuesta. Puede ejecutarse
 *   dos veces si FastAPI responde `401` y se rota la sesión.
 * @param options - {@link HandleAuthenticatedOptions}.
 * @returns JSON con el resultado o `application/problem+json` con el error.
 *
 * @example
 * ```ts
 * export async function GET(request: NextRequest, ctx: RouteContext<"/api/bff/pantries/[pantryId]/batches">) {
 *   const { pantryId } = await ctx.params;
 *   return handleAuthenticated(
 *     request,
 *     (client, { correlationId, params }) =>
 *       unwrap(
 *         client.GET("/api/v1/pantries/{pantry_id}/batches", {
 *           params: { path: { pantry_id: params.pantryId } },
 *         }),
 *         correlationId,
 *       ),
 *     { uuidParams: { pantryId } },
 *   );
 * }
 * ```
 */
export async function handleAuthenticated<
  T,
  S extends z.ZodType | undefined = undefined,
  P extends string = never,
>(
  request: NextRequest,
  call: (
    client: BackendClient,
    context: AuthenticatedRouteContext<BodyOf<S>, P>,
  ) => Promise<T>,
  options: HandleAuthenticatedOptions<S, P> = {},
): Promise<NextResponse> {
  const correlationId = getCorrelationId(request);
  try {
    // Orden: validaciones baratas primero; nada toca cookies ni FastAPI hasta
    // que la petición es sintácticamente válida.
    if (options.mutation) assertSafeMutation(request, correlationId);
    const params = {} as Record<P, string>;
    if (options.uuidParams) {
      for (const [name, value] of Object.entries(options.uuidParams) as [P, string | undefined][]) {
        params[name] = parseUuidParam(value, name, correlationId);
      }
    }
    const idempotencyKey = options.idempotent
      ? readIdempotencyKey(request, correlationId)
      : undefined;
    const body = (
      options.body ? await parseJsonBody(request, options.body, correlationId) : undefined
    ) as BodyOf<S>;
    const context: AuthenticatedRouteContext<BodyOf<S>, P> = {
      correlationId,
      params,
      body,
      idempotencyKey,
    };
    const data = await authenticatedRequest((client) => call(client, context), {
      correlationId,
      allowRefresh: true,
    });
    const status = options.successStatus ?? 200;
    if (status === 204) return emptyResponse(correlationId);
    return jsonResponse(data, correlationId, { status });
  } catch (error) {
    return handleError(error, correlationId);
  }
}

function badRequest(correlationId: string, detail: string, loc: string[]): ProblemDetailError {
  return new ProblemDetailError({
    type: problemTypeUri(PROBLEM_TYPES.invalidRequest),
    title: "Bad Request",
    status: 400,
    detail,
    correlation_id: correlationId,
    errors: [{ loc, msg: detail, type: "invalid" }],
  });
}

// `z.guid()` y no `z.uuid()`: FastAPI acepta cualquier UUID con formato 8-4-4-4-12
// (no exige versión/variante RFC 9562).
const uuidSchema = z.guid();

/**
 * Valida un segmento dinámico de la URL como UUID antes de interpolarlo en la
 * ruta de FastAPI. Bloquea *path traversal* (`..%2F`), inyección de
 * segmentos y peticiones basura que solo cargarían al backend.
 *
 * @param value - Valor crudo del segmento (`params.pantryId`).
 * @param name - Nombre del parámetro (para el error por campo).
 * @param correlationId - ID de la petición.
 * @returns El UUID normalizado en minúsculas.
 * @throws {ProblemDetailError} `400 invalid-request` si no es un UUID.
 */
export function parseUuidParam(value: string | undefined, name: string, correlationId: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw badRequest(correlationId, `El parámetro "${name}" debe ser un UUID.`, ["path", name]);
  }
  return result.data.toLowerCase();
}

/** Cabecera de idempotencia aceptada por el BFF en mutaciones reintentables. */
export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Lee y valida `Idempotency-Key` (opcional). Solo admite `[A-Za-z0-9_-]{8,128}`
 * para que nunca se reenvíe a FastAPI una cabecera con saltos de línea o
 * tamaños abusivos.
 *
 * @param request - Petición del Route Handler.
 * @param correlationId - ID de la petición.
 * @returns La clave o `undefined` si no viene.
 * @throws {ProblemDetailError} `400 invalid-request` si el formato es inválido.
 */
export function readIdempotencyKey(request: NextRequest, correlationId: string): string | undefined {
  const raw = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(raw)) {
    throw badRequest(
      correlationId,
      "Idempotency-Key debe tener entre 8 y 128 caracteres [A-Za-z0-9_-].",
      ["header", "Idempotency-Key"],
    );
  }
  return raw;
}

/**
 * Opciones `headers` de `openapi-fetch` con `Idempotency-Key` si existe.
 *
 * @param key - Clave validada (o `undefined`).
 * @returns `{ headers }` para hacer *spread* en la llamada, o `{}`.
 */
export function idempotencyHeaders(key: string | undefined): { headers?: Record<string, string> } {
  return key ? { headers: { "Idempotency-Key": key } } : {};
}
