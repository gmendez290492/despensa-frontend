import type { components } from "@/lib/api/schema";
import { bffFetch, bffJson } from "@/lib/api/bff-fetch";
import { ProblemDetailError } from "@/lib/api/problem";
import {
  toRegisterPayload,
  type LoginInput,
  type RegisterFormValues,
  type RegisterPayload,
} from "@/lib/auth/schemas";

/** Usuario tal como lo devuelve FastAPI (tipo generado desde OpenAPI, nunca manual). */
export type UserResponse = components["schemas"]["UserResponse"];

/** Respuesta de `POST /api/bff/auth/login`. */
export interface LoginResponse {
  user: UserResponse;
}

/** Respuesta de `POST /api/bff/auth/register`. */
export interface RegisterResponse {
  user: UserResponse;
  /** `false` si la cuenta se creó pero el login automático falló. */
  authenticated: boolean;
}

/** Fábrica de query keys de TanStack Query para auth (invalidar con `authKeys.all`). */
export const authKeys = {
  all: ["auth"] as const,
  me: () => ["auth", "me"] as const,
};

/** Rutas del BFF de autenticación. El navegador nunca llama a FastAPI directamente. */
export const BFF_AUTH_ROUTES = {
  login: "/api/bff/auth/login",
  register: "/api/bff/auth/register",
  logout: "/api/bff/auth/logout",
  me: "/api/bff/auth/me",
  refresh: "/api/bff/auth/refresh",
} as const;

/**
 * `POST /api/bff/auth/login`. El BFF guarda los tokens en cookies `HttpOnly`;
 * la respuesta solo trae el usuario.
 *
 * @param input - Credenciales ya validadas con `loginSchema`.
 * @returns El usuario autenticado.
 * @throws {ProblemDetailError} `invalid-credentials`, `rate-limit-exceeded`, errores de red, etc.
 */
export function loginRequest(input: LoginInput): Promise<LoginResponse> {
  return bffJson<LoginResponse>(BFF_AUTH_ROUTES.login, { method: "POST", json: input });
}

/**
 * `POST /api/bff/auth/register`. Elimina `confirm_password` antes de enviar.
 *
 * @param input - Valores del formulario o payload ya limpio.
 * @returns Usuario creado y si el login automático tuvo éxito.
 * @throws {ProblemDetailError} `email-already-exists`, `validation-error`, etc.
 */
export function registerRequest(
  input: RegisterPayload | RegisterFormValues,
): Promise<RegisterResponse> {
  return bffJson<RegisterResponse>(BFF_AUTH_ROUTES.register, {
    method: "POST",
    json: toRegisterPayload(input),
  });
}

/**
 * `POST /api/bff/auth/logout`: el BFF revoca el refresh_token y borra las cookies.
 *
 * @throws {ProblemDetailError} Si el BFF responde con error (el estado local se limpia igualmente).
 */
export async function logoutRequest(): Promise<void> {
  // Sin body, pero con `Content-Type: application/json` explícito: el BFF lo exige.
  await bffFetch(BFF_AUTH_ROUTES.logout, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

/** Usuario actual o `null` si no hay sesión (401). */
export async function fetchCurrentUser(): Promise<UserResponse | null> {
  try {
    return await bffJson<UserResponse>(BFF_AUTH_ROUTES.me, { method: "GET", cache: "no-store" });
  } catch (error) {
    if (error instanceof ProblemDetailError && error.status === 401) return null;
    throw error;
  }
}
