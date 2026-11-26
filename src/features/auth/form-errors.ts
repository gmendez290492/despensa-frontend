import { PROBLEM_TYPES, ProblemDetailError } from "@/lib/api/problem";
import { safeRedirectPath } from "@/lib/auth/redirect";

/** Banner superior de los formularios de auth. */
export interface AuthBanner {
  message: string;
  /** ID de correlación para soporte (solo en errores inesperados). */
  correlationId?: string;
}

/** Error asignable a un campo del formulario con `setError` de React Hook Form. */
export interface AuthFieldError<F extends string> {
  name: F;
  message: string;
  /** `conflict` = correo ya registrado (el formulario muestra link a /login). */
  type: "server" | "conflict";
}

/** Resultado de {@link mapAuthError}: banner general y/o errores por campo. */
export interface AuthErrorMapping<F extends string> {
  banner: AuthBanner | null;
  fieldErrors: AuthFieldError<F>[];
}

/**
 * Mensajes en español mostrados al usuario. Nunca se muestra el `detail` crudo
 * del backend salvo los mensajes de validación por campo.
 */
export const AUTH_ERROR_MESSAGES = {
  invalidCredentials: "Correo o contraseña incorrectos. Verifica tus datos e inténtalo de nuevo.",
  rateLimit: "Demasiados intentos. Espera un momento antes de volver a intentarlo.",
  emailExists: "Este correo ya está registrado.",
  unavailable:
    "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo en unos segundos.",
  invalidData: "Revisa los campos marcados e inténtalo de nuevo.",
  unexpected: "Algo salió mal. Inténtalo de nuevo; si persiste, contacta a soporte.",
} as const;

function fieldFromLoc<F extends string>(
  loc: (string | number)[],
  fields: readonly F[],
): F | null {
  // `["email"]` (BFF) o `["body", "email"]` (FastAPI 422): el último string conocido.
  for (let index = loc.length - 1; index >= 0; index -= 1) {
    const part = loc[index];
    if (typeof part === "string" && (fields as readonly string[]).includes(part)) {
      return part as F;
    }
  }
  return null;
}

/**
 * Traduce un error del BFF (RFC 7807) a banner + errores por campo para los
 * formularios de login/registro. Función pura (testeable sin React).
 */
export function mapAuthError<F extends string>(
  error: unknown,
  fields: readonly F[],
): AuthErrorMapping<F> {
  if (!(error instanceof ProblemDetailError)) {
    return { banner: { message: AUTH_ERROR_MESSAGES.unexpected }, fieldErrors: [] };
  }

  if (error.is(PROBLEM_TYPES.invalidCredentials)) {
    return { banner: { message: AUTH_ERROR_MESSAGES.invalidCredentials }, fieldErrors: [] };
  }

  if (error.is(PROBLEM_TYPES.rateLimitExceeded) || error.status === 429) {
    return { banner: { message: AUTH_ERROR_MESSAGES.rateLimit }, fieldErrors: [] };
  }

  if (error.is(PROBLEM_TYPES.emailAlreadyExists) && (fields as readonly string[]).includes("email")) {
    return {
      banner: null,
      fieldErrors: [
        { name: "email" as F, message: AUTH_ERROR_MESSAGES.emailExists, type: "conflict" },
      ],
    };
  }

  if (error.is(PROBLEM_TYPES.invalidRequest) || error.is(PROBLEM_TYPES.validationError)) {
    const fieldErrors: AuthFieldError<F>[] = [];
    let unmapped = false;
    for (const item of error.errors ?? []) {
      const name = fieldFromLoc(item.loc, fields);
      if (name && !fieldErrors.some((entry) => entry.name === name)) {
        fieldErrors.push({ name, message: item.msg, type: "server" });
      } else if (!name) {
        unmapped = true;
      }
    }
    if (fieldErrors.length > 0) {
      return {
        banner: unmapped ? { message: AUTH_ERROR_MESSAGES.invalidData } : null,
        fieldErrors,
      };
    }
    return {
      banner: { message: AUTH_ERROR_MESSAGES.invalidData, correlationId: error.correlation_id },
      fieldErrors: [],
    };
  }

  if (
    error.is(PROBLEM_TYPES.backendUnavailable) ||
    error.is(PROBLEM_TYPES.networkError) ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504
  ) {
    return { banner: { message: AUTH_ERROR_MESSAGES.unavailable }, fieldErrors: [] };
  }

  return {
    banner: { message: AUTH_ERROR_MESSAGES.unexpected, correlationId: error.correlation_id },
    fieldErrors: [],
  };
}

/** Añade `?next=` solo si es una ruta interna segura (evita open redirect). */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeRedirectPath(next, "");
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}
