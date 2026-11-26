"use client";

/**
 * Punto de entrada SOLO para Client Components: hooks de TanStack Query.
 * Lo isomórfico (schemas, errores, `safeRedirectPath`, tipos) vive en
 * `@/features/auth`.
 */
export {
  useCurrentUser,
  useForgotPasswordMutation,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
  useResetPasswordMutation,
} from "@/features/auth/hooks";
