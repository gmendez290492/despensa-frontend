"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ProblemDetailError } from "@/lib/api/problem";
import type {
  ForgotPasswordInput,
  LoginInput,
  RegisterFormValues,
  RegisterPayload,
  ResetPasswordInput,
} from "@/lib/auth/schemas";
import { clearUserOfflineData } from "@/lib/offline/clear-user-data";
import { useUiStore } from "@/stores/ui-store";
import {
  authKeys,
  fetchCurrentUser,
  forgotPasswordRequest,
  loginRequest,
  logoutRequest,
  registerRequest,
  resetPasswordRequest,
  type MessageResponse,
  type RegisterResponse,
  type UserResponse,
} from "@/features/auth/api";

/**
 * Hooks de autenticación (TanStack Query v5). `networkMode: "online"`: no
 * tiene sentido encolar login/registro sin conexión.
 */

/**
 * Usuario actual vía `GET /api/bff/auth/me`; `null` si no hay sesión.
 * Solo reintenta una vez ante 5xx (un 401 no se reintenta).
 *
 * @param options.enabled - Desactiva la query (p. ej. en pantallas públicas).
 * @returns `UseQueryResult<UserResponse | null, ProblemDetailError>`.
 *
 * @example
 * ```tsx
 * const { data: user } = useCurrentUser();
 * ```
 */
export function useCurrentUser(options: { enabled?: boolean } = {}) {
  return useQuery<UserResponse | null, ProblemDetailError>({
    queryKey: authKeys.me(),
    queryFn: fetchCurrentUser,
    networkMode: "online",
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, error) => error.status >= 500 && failureCount < 1,
    enabled: options.enabled ?? true,
  });
}

/**
 * Mutación de login. Al tener éxito siembra `authKeys.me()` con el usuario para
 * evitar un `GET /me` extra tras navegar.
 *
 * @returns `UseMutationResult<UserResponse, ProblemDetailError, LoginInput>`.
 *
 * @example
 * ```tsx
 * const login = useLoginMutation();
 * login.mutate(values, { onSuccess: () => router.replace("/") });
 * ```
 */
export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation<UserResponse, ProblemDetailError, LoginInput>({
    mutationKey: [...authKeys.all, "login"],
    mutationFn: async (input) => (await loginRequest(input)).user,
    networkMode: "online",
    onSuccess: (user) => {
      queryClient.setQueryData(authKeys.me(), user);
    },
  });
}

/**
 * Mutación de registro. Solo siembra la caché del usuario si el BFF confirmó
 * el login automático (`authenticated: true`).
 *
 * @returns `UseMutationResult<RegisterResponse, ProblemDetailError, RegisterPayload | RegisterFormValues>`.
 */
export function useRegisterMutation() {
  const queryClient = useQueryClient();
  return useMutation<RegisterResponse, ProblemDetailError, RegisterPayload | RegisterFormValues>({
    mutationKey: [...authKeys.all, "register"],
    mutationFn: registerRequest,
    networkMode: "online",
    onSuccess: ({ user, authenticated }) => {
      if (authenticated) queryClient.setQueryData(authKeys.me(), user);
    },
  });
}

/**
 * Mutación de logout. En `onSettled` (también si falla la red) limpia el
 * estado ligado al usuario: Zustand, caché de TanStack Query, IndexedDB y
 * cachés runtime del Service Worker.
 *
 * @returns `UseMutationResult<void, ProblemDetailError, void>`.
 */
export function useLogoutMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, ProblemDetailError, void>({
    mutationKey: [...authKeys.all, "logout"],
    mutationFn: logoutRequest,
    networkMode: "online",
    onSettled: () => clearLocalUserState(queryClient),
  });
}

/**
 * Borra el estado local ligado al usuario: Zustand, caché de TanStack Query,
 * IndexedDB (Dexie) y cachés runtime del SW. Nunca lanza. Se espera antes de
 * que los callbacks de `mutate()` naveguen.
 *
 * @param queryClient - Cliente de TanStack Query a vaciar.
 */
async function clearLocalUserState(queryClient: QueryClient): Promise<void> {
  const ui = useUiStore.getState();
  ui.setActivePantryId(null);
  ui.clearContinuousScanQueue();
  queryClient.clear();
  await clearUserOfflineData();
}

/**
 * Mutación "Olvidé mi contraseña". Sin reintentos automáticos: un `429` se
 * muestra con su `Retry-After`.
 *
 * @returns `UseMutationResult<MessageResponse, ProblemDetailError, ForgotPasswordInput>`.
 */
export function useForgotPasswordMutation() {
  return useMutation<MessageResponse, ProblemDetailError, ForgotPasswordInput>({
    mutationKey: [...authKeys.all, "password", "forgot"],
    mutationFn: forgotPasswordRequest,
    networkMode: "online",
    retry: false,
  });
}

/**
 * Mutación de restablecimiento de contraseña. Al tener éxito FastAPI revoca
 * todas las sesiones del usuario, así que también se limpia el estado local
 * (igual que en logout) antes de navegar a `/login`.
 *
 * @returns `UseMutationResult<void, ProblemDetailError, ResetPasswordInput>`.
 */
export function useResetPasswordMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, ProblemDetailError, ResetPasswordInput>({
    mutationKey: [...authKeys.all, "password", "reset"],
    mutationFn: resetPasswordRequest,
    networkMode: "online",
    retry: false,
    onSuccess: () => clearLocalUserState(queryClient),
  });
}
