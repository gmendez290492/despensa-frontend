import { z } from "zod";
import type { components } from "@/lib/api/schema";

/**
 * Esquemas Zod v4 compartidos entre React Hook Form (cliente) y la validación
 * de cuerpos en los Route Handlers del BFF. Las restricciones replican las de
 * FastAPI (`UserRegisterRequest` / `UserLoginRequest`).
 */

type UserLoginRequest = components["schemas"]["UserLoginRequest"];
type UserRegisterRequest = components["schemas"]["UserRegisterRequest"];
type PasswordForgotRequest = components["schemas"]["PasswordForgotRequest"];
type PasswordResetRequest = components["schemas"]["PasswordResetRequest"];

/** Zona horaria de respaldo si el navegador no expone una válida. */
export const DEFAULT_TIMEZONE = "UTC";
/** Días de anticipación por defecto para las alertas de caducidad. */
export const DEFAULT_ALERT_DAYS_BEFORE = 3;

/**
 * Valida un identificador IANA usando `Intl.DateTimeFormat` (sin listas propias).
 *
 * @param value - Zona candidata, p. ej. `"America/Mexico_City"`.
 * @returns `true` si el motor `Intl` la reconoce.
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria IANA del navegador/servidor actual, o `UTC` si no se puede resolver. */
export function detectTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

const emailField = z
  .string({ error: "El correo electrónico es obligatorio." })
  .trim()
  .min(1, { error: "El correo electrónico es obligatorio." })
  .max(254, { error: "El correo electrónico es demasiado largo." })
  .pipe(z.email({ error: "Introduce un correo electrónico válido." }));

/** Esquema de login (cliente y BFF). Alineado con `UserLoginRequest`. */
export const loginSchema = z.object({
  email: emailField,
  password: z
    .string({ error: "La contraseña es obligatoria." })
    .min(1, { error: "La contraseña es obligatoria." })
    .max(128, { error: "La contraseña no puede superar 128 caracteres." }),
});

const registerFields = {
  full_name: z
    .string({ error: "El nombre es obligatorio." })
    .trim()
    .min(2, { error: "El nombre debe tener al menos 2 caracteres." })
    .max(120, { error: "El nombre no puede superar 120 caracteres." }),
  email: emailField,
  password: z
    .string({ error: "La contraseña es obligatoria." })
    .min(8, { error: "La contraseña debe tener al menos 8 caracteres." })
    .max(128, { error: "La contraseña no puede superar 128 caracteres." }),
  timezone: z
    .string({ error: "La zona horaria es obligatoria." })
    .trim()
    .min(1, { error: "La zona horaria es obligatoria." })
    .max(64, { error: "La zona horaria no es válida." })
    .refine(isValidTimeZone, { error: "La zona horaria no es válida." })
    .default(DEFAULT_TIMEZONE),
  alert_days_before: z
    .number({ error: "Indica cuántos días antes quieres recibir alertas." })
    .int({ error: "Los días de alerta deben ser un número entero." })
    .min(1, { error: "Los días de alerta deben ser al menos 1." })
    .max(30, { error: "Los días de alerta no pueden superar 30." })
    .default(DEFAULT_ALERT_DAYS_BEFORE),
};

/** Payload que el BFF acepta en `POST /api/bff/auth/register` (sin confirmación). */
export const registerRequestSchema = z.object(registerFields);

/** Esquema del formulario de registro (incluye `confirm_password`). */
export const registerSchema = z
  .object({
    ...registerFields,
    confirm_password: z
      .string({ error: "Confirma tu contraseña." })
      .min(1, { error: "Confirma tu contraseña." }),
  })
  .refine((values) => values.password === values.confirm_password, {
    error: "Las contraseñas no coinciden.",
    path: ["confirm_password"],
  });

/** Esquema de "Olvidé mi contraseña" (`PasswordForgotRequest`). */
export const forgotPasswordSchema = z.object({ email: emailField });

/** Longitudes del token de restablecimiento según `PasswordResetRequest`. */
export const RESET_TOKEN_MIN_LENGTH = 20;
export const RESET_TOKEN_MAX_LENGTH = 256;

/**
 * Esquema de restablecimiento (`PasswordResetRequest`). El token llega en la
 * URL del correo; la nueva contraseña replica las reglas del registro.
 */
export const resetPasswordSchema = z.object({
  token: z
    .string({ error: "El enlace no es válido." })
    .trim()
    .min(RESET_TOKEN_MIN_LENGTH, { error: "El enlace no es válido." })
    .max(RESET_TOKEN_MAX_LENGTH, { error: "El enlace no es válido." }),
  new_password: z
    .string({ error: "La contraseña es obligatoria." })
    .min(8, { error: "La contraseña debe tener al menos 8 caracteres." })
    .max(128, { error: "La contraseña no puede superar 128 caracteres." }),
});

/** Valores crudos del formulario de login (entrada de Zod). */
export type LoginFormValues = z.input<typeof loginSchema>;
/** Credenciales normalizadas (salida de Zod) que se envían al BFF. */
export type LoginInput = z.output<typeof loginSchema>;
/** Valores del formulario "Olvidé mi contraseña". */
export type ForgotPasswordValues = z.input<typeof forgotPasswordSchema>;
/** Payload normalizado de `POST /api/bff/auth/password/forgot`. */
export type ForgotPasswordInput = z.output<typeof forgotPasswordSchema>;
/** Valores crudos del restablecimiento. */
export type ResetPasswordValues = z.input<typeof resetPasswordSchema>;
/** Payload normalizado de `POST /api/bff/auth/password/reset`. */
export type ResetPasswordInput = z.output<typeof resetPasswordSchema>;
/** Valores crudos del formulario de registro (incluye `confirm_password`). */
export type RegisterFormInput = z.input<typeof registerSchema>;
/** Valores validados del formulario de registro. */
export type RegisterFormValues = z.output<typeof registerSchema>;
/** Cuerpo crudo aceptado por `POST /api/bff/auth/register`. */
export type RegisterRequestInput = z.input<typeof registerRequestSchema>;
/** Payload normalizado que el BFF reenvía a FastAPI (`UserRegisterRequest`). */
export type RegisterPayload = z.output<typeof registerRequestSchema>;

/** Quita `confirm_password` para enviar al BFF. */
export function toRegisterPayload(
  values: RegisterFormValues | RegisterPayload,
): RegisterPayload {
  return {
    full_name: values.full_name,
    email: values.email,
    password: values.password,
    timezone: values.timezone,
    alert_days_before: values.alert_days_before,
  };
}

// Garantía en compilación: los esquemas siguen alineados con el contrato OpenAPI.
type AssertAssignable<T extends U, U> = T;
/** @internal Falla en compilación si `LoginInput` deja de encajar en `UserLoginRequest`. */
export type _LoginMatchesContract = AssertAssignable<LoginInput, UserLoginRequest>;
/** @internal Falla en compilación si `ForgotPasswordInput` deja de encajar en `PasswordForgotRequest`. */
export type _ForgotMatchesContract = AssertAssignable<ForgotPasswordInput, PasswordForgotRequest>;
/** @internal Falla en compilación si `ResetPasswordInput` deja de encajar en `PasswordResetRequest`. */
export type _ResetMatchesContract = AssertAssignable<ResetPasswordInput, PasswordResetRequest>;
/** @internal Falla en compilación si `RegisterPayload` deja de encajar en `UserRegisterRequest`. */
export type _RegisterMatchesContract = AssertAssignable<RegisterPayload, UserRegisterRequest>;
