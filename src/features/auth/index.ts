/**
 * Barrel isomórfico de auth (seguro en Server y Client Components).
 * Los hooks de cliente se importan desde `@/features/auth/client`.
 */
export {
  authKeys,
  BFF_AUTH_ROUTES,
  type LoginResponse,
  type RegisterResponse,
  type UserResponse,
} from "@/features/auth/api";
export {
  detectTimeZone,
  loginSchema,
  registerRequestSchema,
  registerSchema,
  toRegisterPayload,
  type LoginFormValues,
  type LoginInput,
  type RegisterFormInput,
  type RegisterFormValues,
  type RegisterPayload,
} from "@/lib/auth/schemas";
export { safeRedirectPath } from "@/lib/auth/redirect";
export {
  isProblemDetailError,
  PROBLEM_TYPES,
  ProblemDetailError,
  type ProblemDetail,
  type ProblemFieldError,
} from "@/lib/api/problem";
