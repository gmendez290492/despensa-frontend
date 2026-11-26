/**
 * Normalización de errores HTTP bajo RFC 7807 (`application/problem+json`).
 *
 * Módulo isomórfico: se usa tanto en el BFF (Route Handlers / RSC) como en
 * los hooks cliente de TanStack Query.
 */

/** Media type de RFC 7807. */
export const PROBLEM_JSON_CONTENT_TYPE = "application/problem+json";
/** Prefijo de las URIs `type` de RFC 7807 (`<base><slug>`). */
export const PROBLEM_TYPE_BASE = "https://despensa.api/errors/";

/** `error_type` conocidos del catálogo de FastAPI y del propio BFF. */
export const PROBLEM_TYPES = {
  // FastAPI (docs/BACKEND_API_CONTEXT.md §3)
  invalidCredentials: "invalid-credentials",
  invalidToken: "invalid-token",
  emailAlreadyExists: "email-already-exists",
  rateLimitExceeded: "rate-limit-exceeded",
  invalidResetToken: "invalid-reset-token",
  pantryAccessDenied: "pantry-access-denied",
  insufficientStock: "insufficient-stock",
  // FastAPI 422 (RequestValidationError) normalizado por el BFF
  validationError: "validation-error",
  // Generados por el BFF
  invalidRequest: "invalid-request",
  forbiddenOrigin: "forbidden-origin",
  unsupportedMediaType: "unsupported-media-type",
  backendUnavailable: "backend-unavailable",
  networkError: "network-error",
  unknown: "unknown-error",
} as const;

/** Unión de los slugs de {@link PROBLEM_TYPES}. */
export type KnownProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

/** Error de validación de un campo (extensión `errors` de RFC 7807). */
export interface ProblemFieldError {
  /** Ruta del campo, p. ej. `["body", "email"]` o `["password"]`. */
  loc: (string | number)[];
  msg: string;
  type?: string;
}

/** Cuerpo RFC 7807 tal como viaja por la red (FastAPI y BFF). */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlation_id?: string;
  /** Extensión: errores por campo (validación Zod en BFF o 422 de FastAPI). */
  errors?: ProblemFieldError[];
  /**
   * Extensión: segundos hasta poder reintentar (cabecera `Retry-After` de los
   * `429`). El BFF la copia al cuerpo para que la UI no dependa de leer cabeceras.
   */
  retry_after?: number;
}

/** Construye la URI de tipo canónica a partir del slug (`invalid-token`). */
export function problemTypeUri(slug: string): string {
  return `${PROBLEM_TYPE_BASE}${slug}`;
}

/** Extrae el slug (`invalid-token`) de una URI de tipo o lo devuelve tal cual. */
export function problemSlug(type: string): string {
  const trimmed = type.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/**
 * Error tipado RFC 7807. Es lo único que lanzan `bffFetch`, `unwrap` y los
 * hooks de auth, de modo que la UI puede decidir con `error.is(slug)`.
 *
 * @example
 * ```ts
 * if (error instanceof ProblemDetailError && error.is(PROBLEM_TYPES.insufficientStock)) {
 *   markConflict(error.correlation_id);
 * }
 * ```
 *
 * @see https://www.rfc-editor.org/rfc/rfc7807
 */
export class ProblemDetailError extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string | undefined;
  readonly instance: string | undefined;
  readonly correlation_id: string | undefined;
  readonly errors: ProblemFieldError[] | undefined;
  /** Segundos hasta poder reintentar (`429` con `Retry-After`), si se conocen. */
  readonly retry_after: number | undefined;

  constructor(problem: ProblemDetail) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemDetailError";
    this.type = problem.type;
    this.title = problem.title;
    this.status = problem.status;
    this.detail = problem.detail;
    this.instance = problem.instance;
    this.correlation_id = problem.correlation_id;
    this.errors = problem.errors;
    this.retry_after = problem.retry_after;
  }

  /** Slug del tipo, p. ej. `"invalid-credentials"`. */
  get errorType(): string {
    return problemSlug(this.type);
  }

  /** `true` si el error corresponde al slug indicado. */
  is(slug: KnownProblemType | (string & {})): boolean {
    return this.errorType === slug;
  }

  toJSON(): ProblemDetail {
    const body: ProblemDetail = {
      type: this.type,
      title: this.title,
      status: this.status,
    };
    if (this.detail !== undefined) body.detail = this.detail;
    if (this.instance !== undefined) body.instance = this.instance;
    if (this.correlation_id !== undefined) body.correlation_id = this.correlation_id;
    if (this.errors !== undefined) body.errors = this.errors;
    if (this.retry_after !== undefined) body.retry_after = this.retry_after;
    return body;
  }
}

/**
 * Type guard de {@link ProblemDetailError}.
 *
 * @param value - Cualquier valor capturado en un `catch`.
 * @returns `true` si es un `ProblemDetailError`.
 */
export function isProblemDetailError(value: unknown): value is ProblemDetailError {
  return value instanceof ProblemDetailError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valida estructuralmente un cuerpo RFC 7807. */
export function isProblemDetail(value: unknown): value is ProblemDetail {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "number"
  );
}

const DEFAULT_TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

function toFieldErrors(value: unknown): ProblemFieldError[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const errors: ProblemFieldError[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.msg !== "string") continue;
    const loc = Array.isArray(item.loc)
      ? item.loc.filter(
          (part): part is string | number =>
            typeof part === "string" || typeof part === "number",
        )
      : [];
    errors.push({
      loc,
      msg: item.msg,
      ...(typeof item.type === "string" ? { type: item.type } : {}),
    });
  }
  return errors;
}

/**
 * Convierte cualquier cuerpo de error (RFC 7807, `HTTPValidationError` 422 de
 * FastAPI, `{ detail: string }`, texto plano o vacío) en `ProblemDetailError`.
 */
export function toProblemDetailError(
  body: unknown,
  status: number,
  correlationId?: string | null,
  retryAfterHeader?: string | null,
): ProblemDetailError {
  const error = buildProblemDetailError(body, status, correlationId);
  const fromBody =
    isRecord(body) && typeof body.retry_after === "number" && Number.isFinite(body.retry_after)
      ? Math.max(0, Math.ceil(body.retry_after))
      : undefined;
  const retryAfter = parseRetryAfter(retryAfterHeader) ?? fromBody;
  if (retryAfter === undefined || error.retry_after === retryAfter) return error;
  return new ProblemDetailError({ ...error.toJSON(), retry_after: retryAfter });
}

/**
 * Interpreta la cabecera `Retry-After` (RFC 9110 §10.2.3): segundos enteros o
 * fecha HTTP.
 *
 * @param value - Valor crudo de la cabecera.
 * @param nowMs - Reloj inyectable para tests.
 * @returns Segundos (≥ 0, redondeados hacia arriba) o `undefined` si falta o es inválida.
 *
 * @example
 * ```ts
 * parseRetryAfter("120"); // 120
 * parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"); // segundos hasta esa fecha
 * ```
 */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  // Solo IMF-fixdate (RFC 9110): `Date.parse` aceptaría "-5" o "1.5" como fechas.
  if (!/GMT$/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

function buildProblemDetailError(
  body: unknown,
  status: number,
  correlationId?: string | null,
): ProblemDetailError {
  const fallbackCorrelation = correlationId ?? undefined;

  if (isProblemDetail(body)) {
    const fieldErrors = toFieldErrors(body.errors);
    return new ProblemDetailError({
      type: body.type,
      title: body.title,
      status: body.status,
      ...(typeof body.detail === "string" ? { detail: body.detail } : {}),
      ...(typeof body.instance === "string" ? { instance: body.instance } : {}),
      correlation_id:
        typeof body.correlation_id === "string"
          ? body.correlation_id
          : fallbackCorrelation,
      ...(fieldErrors ? { errors: fieldErrors } : {}),
    });
  }

  const title = DEFAULT_TITLES[status] ?? "Error";

  // FastAPI RequestValidationError: { detail: [{ loc, msg, type }] }
  if (isRecord(body) && Array.isArray(body.detail)) {
    const errors = toFieldErrors(body.detail) ?? [];
    return new ProblemDetailError({
      type: problemTypeUri(PROBLEM_TYPES.validationError),
      title: "Validation Error",
      status,
      detail: errors[0]?.msg ?? "La petición contiene datos inválidos.",
      correlation_id: fallbackCorrelation,
      errors,
    });
  }

  if (isRecord(body) && typeof body.detail === "string") {
    return new ProblemDetailError({
      type: problemTypeUri(PROBLEM_TYPES.unknown),
      title,
      status,
      detail: body.detail,
      correlation_id: fallbackCorrelation,
    });
  }

  return new ProblemDetailError({
    type: problemTypeUri(PROBLEM_TYPES.unknown),
    title,
    status,
    detail:
      typeof body === "string" && body.trim().length > 0 && body.length < 500
        ? body
        : "Ocurrió un error inesperado.",
    correlation_id: fallbackCorrelation,
  });
}

/** Lee y normaliza el cuerpo de una `Response` fallida. */
export async function parseProblemResponse(
  response: Response,
): Promise<ProblemDetailError> {
  const correlationId = response.headers.get("x-correlation-id");
  let body: unknown = undefined;
  try {
    const text = await response.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  } catch {
    body = undefined;
  }
  return toProblemDetailError(body, response.status, correlationId, response.headers.get("retry-after"));
}

/** Error de red (sin respuesta HTTP) normalizado. */
export function networkProblem(
  slug: KnownProblemType = PROBLEM_TYPES.networkError,
  correlationId?: string,
): ProblemDetailError {
  return new ProblemDetailError({
    type: problemTypeUri(slug),
    title: "Service Unavailable",
    status: 503,
    detail: "No fue posible contactar al servidor. Inténtalo de nuevo.",
    correlation_id: correlationId,
  });
}
