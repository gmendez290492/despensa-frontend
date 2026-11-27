"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { bffFetch } from "@/lib/api/bff-fetch";
import {
  isProblemDetailError,
  networkProblem,
  PROBLEM_TYPES,
  ProblemDetailError,
  problemTypeUri,
} from "@/lib/api/problem";
import type { OutboxMutationRecord } from "@/lib/db/offline-db";
import {
  drainOutbox,
  enqueueMutation,
  getDexieOutboxStore,
  isExpiredOutboxConflict,
  isTransientError,
  renewedOutboxChanges,
  type OutboxSender,
} from "@/lib/offline/outbox";
import type {
  ConsumeInput,
  ConsumePayload,
  CreateLocationInput,
  CreatePantryInput,
  CreateProductInput,
  JoinPantryInput,
} from "@/lib/pantry/schemas";
import { consumeSchema } from "@/lib/pantry/schemas";
import { useUiStore } from "@/stores/ui-store";
import { authKeys, fetchCurrentUser, type UserResponse } from "@/features/auth/api";
import { useCurrentUser } from "@/features/auth/hooks";
import {
  BFF_PANTRY_ROUTES,
  consumeRequest,
  createLocationRequest,
  createPantryRequest,
  createProductRequest,
  fetchBatches,
  fetchLocations,
  fetchPantries,
  fetchPantryDashboard,
  fetchUnreadNotifications,
  joinPantryRequest,
  pantryKeys,
  productKeys,
  type ConsumeResultResponse,
  type FoodBatchResponse,
  type LocationResponse,
  type PantryDashboardResponse,
  type PantryResponse,
  type ProductResponse,
} from "@/features/pantry/api";
import {
  ageBatches,
  applyOptimisticConsume,
  applyPendingConsumes,
  formatQuantity,
  localDayKey,
  type PendingConsume,
} from "@/features/pantry/fefo";

/**
 * Hooks del dominio `pantry` (Capa 2: TanStack Query v5 `offlineFirst`).
 * Zustand solo guarda `activePantryId`; las respuestas viven en la caché.
 */

const retryUnlessClientError = (failureCount: number, error: ProblemDetailError) =>
  (error.status >= 500 || error.status === 0) && failureCount < 2;

/**
 * ID del usuario de la sesión según la caché `authKeys.me()` (o `GET /me` si
 * aún no está). Para **encolar** y re-aplicar optimistas: sin red no se puede
 * verificar la cookie, así que se usa el último usuario conocido.
 *
 * @returns El ID, `null` sin sesión o `undefined` si no se pudo averiguar.
 */
async function knownUserId(queryClient: QueryClient): Promise<string | null | undefined> {
  try {
    const user = await queryClient.ensureQueryData<UserResponse | null>({
      queryKey: authKeys.me(),
      queryFn: fetchCurrentUser,
    });
    return user?.id ?? null;
  } catch {
    return undefined;
  }
}

/**
 * Usuario de la cookie **ahora** (`GET /me` sin caché) para **drenar**: la
 * sesión pudo caducar y otro miembro iniciar sesión en el mismo dispositivo.
 * Actualiza `authKeys.me()`.
 *
 * @throws {ProblemDetailError} Red o 5xx (un `401` resuelve `null`).
 */
function verifiedUser(queryClient: QueryClient): Promise<UserResponse | null> {
  return queryClient.fetchQuery<UserResponse | null>({
    queryKey: authKeys.me(),
    queryFn: fetchCurrentUser,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Hogares del usuario.
 *
 * Con un `activePantryId` persistido, la lista sale del **dashboard** de ese
 * hogar (`GET /pantries/{id}/dashboard`, que además siembra ubicaciones, lotes
 * y alertas): la primera carga del panel o del inventario es una sola
 * petición. Si el dashboard falla (salvo `401`: `403` por un ID ajeno o
 * revocado, `404` de un backend antiguo, 5xx…) o no hay hogar guardado, cae a
 * `GET /pantries`.
 *
 * @returns `UseQueryResult<PantryResponse[], ProblemDetailError>`.
 */
export function usePantries() {
  const queryClient = useQueryClient();
  return useQuery<PantryResponse[], ProblemDetailError>({
    queryKey: pantryKeys.list(),
    queryFn: () => loadPantries(queryClient),
    staleTime: 5 * 60 * 1000,
    retry: retryUnlessClientError,
  });
}

/** Resultado de {@link useActivePantry}. */
export interface ActivePantryState {
  pantry: PantryResponse | null;
  pantries: PantryResponse[];
  isLoading: boolean;
  error: ProblemDetailError | null;
  setActivePantryId: (pantryId: string) => void;
  refetch: () => void;
}

/**
 * Hogar activo: el `activePantryId` persistido en Zustand si sigue entre los
 * hogares del usuario; si no (otro usuario en el dispositivo, membresía
 * revocada), el primero. Nunca se usa un ID que el backend no haya devuelto.
 *
 * @returns {@link ActivePantryState}.
 */
export function useActivePantry(): ActivePantryState {
  const query = usePantries();
  const storedId = useUiStore((state) => state.activePantryId);
  const setActivePantryId = useUiStore((state) => state.setActivePantryId);
  const pantries = useMemo(() => query.data ?? [], [query.data]);

  const pantry = useMemo(
    () => pantries.find((candidate) => candidate.id === storedId) ?? pantries[0] ?? null,
    [pantries, storedId],
  );

  useEffect(() => {
    if (!query.data) return;
    const nextId = pantry?.id ?? null;
    if (nextId !== storedId) setActivePantryId(nextId);
  }, [pantry, query.data, setActivePantryId, storedId]);

  return {
    pantry,
    pantries,
    isLoading: query.isPending,
    error: query.error,
    setActivePantryId,
    refetch: () => void query.refetch(),
  };
}

/**
 * Ubicaciones del hogar. Si hay un dashboard de ese hogar en vuelo, espera su
 * respuesta en lugar de pedir `GET /locations` (ver {@link usePantryDashboard}).
 *
 * @param pantryId - Hogar activo (`null` desactiva la query).
 * @returns `UseQueryResult<LocationResponse[], ProblemDetailError>`.
 */
export function useLocations(pantryId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<LocationResponse[], ProblemDetailError>({
    queryKey: pantryKeys.locations(pantryId ?? "none"),
    queryFn: async () =>
      (await fromInFlightDashboard(queryClient, pantryId!, (dashboard) => dashboard.locations, isPantryScopedFinal)) ??
      fetchLocations(pantryId!),
    enabled: pantryId !== null,
    staleTime: 5 * 60 * 1000,
    retry: retryUnlessClientError,
  });
}

/**
 * Consumos aún no confirmados (`pending` y `syncing`) del usuario en un
 * hogar, en orden FIFO. Las filas `syncing` cuentan: durante el drenado un
 * refetch no debe "devolver" el stock. Nunca lanza: sin IndexedDB (modo
 * privado estricto) devuelve `[]`.
 *
 * @remarks Una fila puede estar ya aplicada en FastAPI y seguir en la outbox
 * (respuesta perdida tras un 5xx/timeout, o `syncing` cuyo 2xx aún no se ha
 * procesado). Ese consumo se descuenta dos veces **solo en la vista**: en
 * cuanto el drenado la confirma (el reintento con la misma `Idempotency-Key`
 * no la repite en FastAPI) se borra y se invalidan los lotes. Se prefiere esa
 * subestimación transitoria a mostrar stock que el usuario ya consumió.
 */
async function readPendingConsumes(pantryId: string, userId: string): Promise<PendingConsume[]> {
  try {
    const { offlineDb } = await import("@/lib/db/offline-db");
    const rows = await offlineDb.outboxQueue.where("pantryId").equals(pantryId).sortBy("id");
    return rows.flatMap((row) => {
      if (row.userId !== userId || row.kind !== "consume") return [];
      if (row.status !== "pending" && row.status !== "syncing") return [];
      const parsed = consumeSchema.safeParse(row.payload);
      return parsed.success ? [{ productId: parsed.data.product_id, quantity: parsed.data.quantity }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * Re-aplica los consumos aún encolados sobre la respuesta del servidor (ver
 * `applyPendingConsumes`): un refetch no debe deshacer el optimista offline.
 */
async function rebaseOnPendingConsumes(
  queryClient: QueryClient,
  pantryId: string,
  batches: FoodBatchResponse[],
): Promise<FoodBatchResponse[]> {
  const userId = await knownUserId(queryClient);
  if (!userId) return batches;
  const pending = await readPendingConsumes(pantryId, userId);
  return pending.length === 0 ? batches : applyPendingConsumes(batches, pending);
}

/**
 * Lotes FEFO del hogar. `staleTime` corto: el semáforo cambia con los días y
 * otros miembros del hogar consumen. La respuesta ya trae descontados los
 * consumos del usuario que siguen pendientes en la outbox.
 *
 * `select` envejece la caché con {@link ageBatches}: si los datos son de un
 * día anterior (días sin red, pestaña abierta desde ayer) `dias_para_vencer`
 * y `semaforo` se recalculan con la fecha local del dispositivo.
 *
 * Si hay un dashboard de ese hogar en vuelo, espera su respuesta en lugar de
 * pedir `GET /batches` (ver {@link usePantryDashboard}).
 *
 * @param pantryId - Hogar activo (`null` desactiva la query).
 * @returns `UseQueryResult<FoodBatchResponse[], ProblemDetailError>`.
 */
export function useBatches(pantryId: string | null) {
  const queryClient = useQueryClient();
  // Cambia a medianoche: el siguiente render vuelve a envejecer la caché.
  const today = localDayKey();
  const select = useCallback(
    (data: FoodBatchResponse[]) => {
      const fetchedAt = queryClient.getQueryState(pantryKeys.batches(pantryId ?? "none"))?.dataUpdatedAt;
      return fetchedAt ? ageBatches(data, fetchedAt, today) : data;
    },
    [queryClient, pantryId, today],
  );
  return useQuery<FoodBatchResponse[], ProblemDetailError>({
    queryKey: pantryKeys.batches(pantryId ?? "none"),
    queryFn: async () =>
      // El dashboard ya devuelve los lotes rebasados con la outbox.
      (await fromInFlightDashboard(queryClient, pantryId!, (dashboard) => dashboard.batches, isPantryScopedFinal)) ??
      rebaseOnPendingConsumes(queryClient, pantryId!, await fetchBatches(pantryId!)),
    enabled: pantryId !== null,
    staleTime: 30 * 1000,
    retry: retryUnlessClientError,
    select,
  });
}

/**
 * Número de alertas sin leer (campana de la cabecera). Si hay algún dashboard
 * en vuelo usa su `unread_notifications` (es del usuario, no del hogar); si
 * ese dashboard falla, pide `GET /notifications` por su cuenta.
 *
 * @returns `UseQueryResult<number, ProblemDetailError>`.
 */
export function useUnreadNotificationsCount() {
  const queryClient = useQueryClient();
  return useQuery<number, ProblemDetailError>({
    queryKey: pantryKeys.unreadNotifications(),
    queryFn: async () =>
      (await fromInFlightDashboard(queryClient, undefined, (dashboard) => dashboard.unread_notifications, isUnauthorized)) ??
      (await fetchUnreadNotifications()).unread_count,
    staleTime: 60 * 1000,
    retry: retryUnlessClientError,
  });
}

/*
 * ── Dashboard agregado (`GET /pantries/{id}/dashboard`) ──────────────────────
 *
 * Una petición trae lo que el panel pedía en 4 (hogares, ubicaciones, lotes y
 * alertas). No hay una caché paralela para la UI: la respuesta **siembra** las
 * claves sueltas (`pantryKeys.list/locations/batches/unreadNotifications`) y
 * los componentes, el *rebase* de la outbox, `ageBatches`, los optimistas y
 * las invalidaciones siguen usando esas claves.
 *
 * - Refetch: tras mutaciones se invalidan las claves sueltas (quirúrgico, una
 *   petición pequeña); foco y reconexión también los gestionan ellas. El
 *   dashboard solo se repite al montar el panel con datos de más de
 *   DASHBOARD_STALE_TIME_MS, al cambiar de hogar o al invalidar el hogar.
 * - Deduplicación: las queries sueltas que arrancan mientras hay un dashboard
 *   en vuelo esperan su respuesta en lugar de pedir su endpoint.
 * - Fallback: un `404` (backend sin el endpoint) desactiva el dashboard durante
 *   DASHBOARD_UNSUPPORTED_TTL_MS; mientras, todo usa las 4 llamadas.
 */

/** `staleTime` del dashboard: el de los lotes, el dato más volátil del panel. */
export const DASHBOARD_STALE_TIME_MS = 30 * 1000;

/**
 * Tras un `404` del dashboard (backend sin el endpoint), tiempo durante el que
 * se usan directamente las llamadas sueltas antes de volver a probarlo.
 */
export const DASHBOARD_UNSUPPORTED_TTL_MS = 15 * 60 * 1000;

const dashboardUnsupportedAt = new WeakMap<QueryClient, number>();
const dashboardsInFlight = new WeakMap<QueryClient, Map<string, Promise<PantryDashboardResponse | null>>>();

function isDashboardUnsupported(queryClient: QueryClient): boolean {
  const at = dashboardUnsupportedAt.get(queryClient);
  return at !== undefined && Date.now() - at < DASHBOARD_UNSUPPORTED_TTL_MS;
}

const isUnauthorized = (error: unknown) => isProblemDetailError(error) && error.status === 401;

/** `401`/`403` del dashboard valen para las rutas sueltas del mismo hogar: no se repiten. */
const isPantryScopedFinal = (error: unknown) =>
  isProblemDetailError(error) && (error.status === 401 || error.status === 403);

/**
 * Si hay un dashboard en vuelo (del hogar dado o, sin `pantryId`, de
 * cualquiera), espera su respuesta y extrae una parte.
 *
 * @returns La parte, o `undefined` si no hay dashboard en vuelo, respondió
 *   `404` o falló con un error que no se propaga (la query pide su endpoint).
 */
async function fromInFlightDashboard<T>(
  queryClient: QueryClient,
  pantryId: string | undefined,
  pick: (dashboard: PantryDashboardResponse) => T,
  propagate: (error: unknown) => boolean,
): Promise<T | undefined> {
  const inFlight = dashboardsInFlight.get(queryClient);
  const pending = pantryId === undefined ? inFlight?.values().next().value : inFlight?.get(pantryId);
  if (!pending) return undefined;
  try {
    const dashboard = await pending;
    return dashboard ? pick(dashboard) : undefined;
  } catch (error) {
    if (propagate(error)) throw error;
    return undefined;
  }
}

interface SeedSnapshot {
  dataUpdatedAt: number;
  isInvalidated: boolean;
}

function seedSnapshot(queryClient: QueryClient, queryKey: readonly unknown[]): SeedSnapshot {
  const state = queryClient.getQueryState(queryKey);
  return { dataUpdatedAt: state?.dataUpdatedAt ?? 0, isInvalidated: state?.isInvalidated ?? false };
}

/**
 * `true` si nadie tocó la clave mientras el dashboard estaba en vuelo: ni
 * datos nuevos, ni una invalidación, ni un fetch propio en curso (que
 * entregará su propio resultado). Si la tocaron, sembrar podría pisar algo
 * más reciente y se omite.
 */
function untouchedSince(queryClient: QueryClient, queryKey: readonly unknown[], before: SeedSnapshot): boolean {
  const state = queryClient.getQueryState(queryKey);
  if (!state) return true;
  if (state.fetchStatus === "fetching") return false;
  return state.dataUpdatedAt === before.dataUpdatedAt && (before.isInvalidated || !state.isInvalidated);
}

/**
 * `true` si hay un consumo de ese hogar en vuelo o enviado desde `since`: su
 * optimista (o la invalidación de su `onSettled`) es más reciente que el
 * dashboard y no debe pisarse.
 */
function hasConsumeActivity(queryClient: QueryClient, pantryId: string, since: number): boolean {
  return queryClient
    .getMutationCache()
    .findAll({ mutationKey: CONSUME_MUTATION_KEY })
    .some((mutation) => {
      const variables = mutation.state.variables as Partial<ConsumeVariables> | undefined;
      if (variables?.pantryId !== pantryId) return false;
      return mutation.state.status === "pending" || mutation.state.submittedAt >= since;
    });
}

/**
 * `queryFn` del dashboard: pide el agregado, re-aplica los consumos de la
 * outbox a los lotes y siembra las claves sueltas que nadie tocó mientras
 * estaba en vuelo (los lotes, además, solo sin consumos de ese hogar en vuelo
 * ni enviados entretanto). Todas con `updatedAt` = llegada de la respuesta,
 * para que `ageBatches` envejezca desde ahí. Los lotes se siembran antes que
 * la lista: al aparecer el hogar sus datos ya están.
 *
 * @returns La respuesta (lotes ya rebasados) o `null` si el backend no tiene
 *   el endpoint (`404`).
 */
async function loadPantryDashboard(
  queryClient: QueryClient,
  pantryId: string,
): Promise<PantryDashboardResponse | null> {
  if (isDashboardUnsupported(queryClient)) return null;
  const keys = {
    batches: pantryKeys.batches(pantryId),
    locations: pantryKeys.locations(pantryId),
    unread: pantryKeys.unreadNotifications(),
    list: pantryKeys.list(),
  };
  const startedAt = Date.now();
  const before = {
    batches: seedSnapshot(queryClient, keys.batches),
    locations: seedSnapshot(queryClient, keys.locations),
    unread: seedSnapshot(queryClient, keys.unread),
    list: seedSnapshot(queryClient, keys.list),
  };
  const consumeBusyAtStart = hasConsumeActivity(queryClient, pantryId, Number.POSITIVE_INFINITY);

  const run = async (): Promise<PantryDashboardResponse | null> => {
    let response: PantryDashboardResponse;
    try {
      response = await fetchPantryDashboard(pantryId);
    } catch (error) {
      if (isProblemDetailError(error) && error.status === 404) {
        dashboardUnsupportedAt.set(queryClient, Date.now());
        return null;
      }
      throw error;
    }
    const batches = await rebaseOnPendingConsumes(queryClient, pantryId, response.batches);
    const updatedAt = Date.now();
    if (
      !consumeBusyAtStart &&
      !hasConsumeActivity(queryClient, pantryId, startedAt) &&
      untouchedSince(queryClient, keys.batches, before.batches)
    ) {
      queryClient.setQueryData<FoodBatchResponse[]>(keys.batches, batches, { updatedAt });
    }
    if (untouchedSince(queryClient, keys.locations, before.locations)) {
      queryClient.setQueryData<LocationResponse[]>(keys.locations, response.locations, { updatedAt });
    }
    if (untouchedSince(queryClient, keys.unread, before.unread)) {
      queryClient.setQueryData<number>(keys.unread, response.unread_notifications, { updatedAt });
    }
    if (untouchedSince(queryClient, keys.list, before.list)) {
      queryClient.setQueryData<PantryResponse[]>(keys.list, response.pantries, { updatedAt });
    }
    return { ...response, batches };
  };

  let inFlight = dashboardsInFlight.get(queryClient);
  if (!inFlight) {
    inFlight = new Map();
    dashboardsInFlight.set(queryClient, inFlight);
  }
  const promise = run();
  inFlight.set(pantryId, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(pantryId) === promise) inFlight.delete(pantryId);
  }
}

function pantryDashboardQueryOptions(queryClient: QueryClient, pantryId: string) {
  return {
    queryKey: pantryKeys.dashboard(pantryId),
    queryFn: () => loadPantryDashboard(queryClient, pantryId),
    // `null` (404): no se vuelve a pedir hasta que caduque el fallback.
    staleTime: (query: { state: { data: PantryDashboardResponse | null | undefined } }) =>
      query.state.data === null ? DASHBOARD_UNSUPPORTED_TTL_MS : DASHBOARD_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: retryUnlessClientError,
  };
}

/**
 * Lista de hogares: vía el dashboard del hogar guardado si lo hay (ver
 * {@link usePantries}); si no, `GET /pantries`.
 */
async function loadPantries(queryClient: QueryClient): Promise<PantryResponse[]> {
  const storedId = useUiStore.getState().activePantryId;
  if (storedId && !isDashboardUnsupported(queryClient)) {
    try {
      // `staleTime: 0`: si la lista hay que pedirla, el dashboard también
      // (o se reutiliza el que ya está en vuelo). Sin reintentos propios: los
      // hace la query de la lista.
      const dashboard = await queryClient.fetchQuery<PantryDashboardResponse | null, ProblemDetailError>({
        ...pantryDashboardQueryOptions(queryClient, storedId),
        staleTime: 0,
        retry: false,
      });
      if (dashboard) return dashboard.pantries;
    } catch (error) {
      if (isUnauthorized(error)) throw error;
    }
  }
  return fetchPantries();
}

/**
 * Carga agregada del panel (`GET /api/bff/pantries/{id}/dashboard`): hogares,
 * ubicaciones, lotes FEFO y alertas sin leer en **una** petición.
 *
 * No leas los datos de aquí: la respuesta siembra las claves de
 * {@link usePantries}, {@link useLocations}, {@link useBatches} y
 * {@link useUnreadNotificationsCount}, que siguen siendo la fuente de la UI.
 * Llámalo en el componente **antes** que esas queries: así, al montar o al
 * cambiar de hogar, arranca primero y ellas esperan su respuesta en lugar de
 * pedir sus endpoints.
 *
 * - No siembra los lotes si hay un consumo de ese hogar en vuelo (o enviado
 *   mientras el dashboard viajaba), ni ninguna clave que se haya actualizado,
 *   invalidado o esté pidiéndose por su cuenta entretanto.
 * - `data === null`: el backend no tiene el endpoint (`404`); durante
 *   {@link DASHBOARD_UNSUPPORTED_TTL_MS} las queries sueltas piden lo suyo.
 * - Un `403 pantry-access-denied` llega igual a `useBatches` y `useLocations`
 *   (sin repetir la petición), así que la UI se comporta como con un `403` en
 *   los lotes.
 * - `staleTime` {@link DASHBOARD_STALE_TIME_MS}, sin refetch por foco ni
 *   reconexión (lo hacen las queries sueltas).
 *
 * @param pantryId - Hogar activo (`null` desactiva la query).
 * @returns `UseQueryResult<PantryDashboardResponse | null, ProblemDetailError>`.
 *
 * @example
 * ```tsx
 * usePantryDashboard(pantry.id);
 * const batchesQuery = useBatches(pantry.id); // sembrada por el dashboard
 * ```
 */
export function usePantryDashboard(pantryId: string | null) {
  const queryClient = useQueryClient();
  return useQuery<PantryDashboardResponse | null, ProblemDetailError>({
    ...pantryDashboardQueryOptions(queryClient, pantryId ?? "none"),
    enabled: pantryId !== null,
  });
}

function useOnPantryCreated() {
  const queryClient = useQueryClient();
  const setActivePantryId = useUiStore((state) => state.setActivePantryId);
  return (pantry: PantryResponse) => {
    queryClient.setQueryData<PantryResponse[]>(pantryKeys.list(), (previous = []) =>
      previous.some((item) => item.id === pantry.id) ? previous : [...previous, pantry],
    );
    setActivePantryId(pantry.id);
    void queryClient.invalidateQueries({ queryKey: pantryKeys.list() });
  };
}

/**
 * Variables de las mutaciones online idempotentes (crear hogar, unirse, crear
 * ubicación, crear producto). La clave viaja como variable porque en TanStack
 * v5 `mutationFn` no ve el contexto de `onMutate`.
 */
export interface IdempotentVariables<TInput> {
  /** Cuerpo ya validado con Zod. */
  input: TInput;
  /**
   * `Idempotency-Key` de la intención del usuario: obténla con
   * `useActionMutationId().idFor(...)` para que el doble toque y el reintento
   * tras 5xx/timeout reutilicen la misma clave.
   */
  idempotencyKey: string;
}

/** Variables de {@link useCreateLocationMutation}. */
export interface CreateLocationVariables extends IdempotentVariables<CreateLocationInput> {
  /** Hogar donde se crea la ubicación. */
  pantryId: string;
}

/**
 * `true` si FastAPI aún procesa otra petición con la misma `Idempotency-Key`
 * (`409 idempotency-request-in-progress`, p. ej. doble toque o reintento
 * mientras la primera sigue en curso). Nunca se reintenta solo: la UI pide al
 * usuario que espere y vuelva a intentarlo (con la misma clave, que
 * `useActionMutationId` conserva por ser un error transitorio).
 *
 * @param error - Error de la mutación.
 * @returns `true` si es ese conflicto.
 */
export function isIdempotencyInProgressError(error: unknown): boolean {
  return isProblemDetailError(error) && error.is(PROBLEM_TYPES.idempotencyRequestInProgress);
}

/**
 * Crear hogar (solo con red: no tiene sentido encolarlo). Envía
 * `Idempotency-Key`; sin reintentos automáticos (`retry: false`).
 *
 * @returns `UseMutationResult<PantryResponse, ProblemDetailError, IdempotentVariables<CreatePantryInput>>`.
 *
 * @example
 * ```tsx
 * const create = useCreatePantryMutation();
 * const mutationId = useActionMutationId();
 * create.mutate(
 *   { input: values, idempotencyKey: mutationId.idFor(["create-pantry", values]) },
 *   { onSuccess: () => mutationId.release(), onError: (error) => mutationId.release(error) },
 * );
 * ```
 */
export function useCreatePantryMutation() {
  const onCreated = useOnPantryCreated();
  return useMutation<PantryResponse, ProblemDetailError, IdempotentVariables<CreatePantryInput>>({
    mutationFn: ({ input, idempotencyKey }) => createPantryRequest(input, idempotencyKey),
    networkMode: "online",
    retry: false,
    onSuccess: onCreated,
  });
}

/**
 * Unirse a un hogar con código de invitación (solo con red). Envía
 * `Idempotency-Key`; sin reintentos automáticos.
 *
 * @returns `UseMutationResult<PantryResponse, ProblemDetailError, IdempotentVariables<JoinPantryInput>>`.
 */
export function useJoinPantryMutation() {
  const onCreated = useOnPantryCreated();
  return useMutation<PantryResponse, ProblemDetailError, IdempotentVariables<JoinPantryInput>>({
    mutationFn: ({ input, idempotencyKey }) => joinPantryRequest(input, idempotencyKey),
    networkMode: "online",
    retry: false,
    onSuccess: onCreated,
  });
}

/**
 * Crear una ubicación en un hogar (solo con red). Envía `Idempotency-Key`;
 * al terminar añade la ubicación a `pantryKeys.locations(pantryId)` e
 * invalida solo esa clave.
 *
 * @returns `UseMutationResult<LocationResponse, ProblemDetailError, CreateLocationVariables>`.
 */
export function useCreateLocationMutation() {
  const queryClient = useQueryClient();
  return useMutation<LocationResponse, ProblemDetailError, CreateLocationVariables>({
    mutationFn: ({ pantryId, input, idempotencyKey }) => createLocationRequest(pantryId, input, idempotencyKey),
    networkMode: "online",
    retry: false,
    onSuccess: (location, { pantryId }) => {
      queryClient.setQueryData<LocationResponse[]>(pantryKeys.locations(pantryId), (previous) =>
        previous && !previous.some((item) => item.id === location.id) ? [...previous, location] : previous,
      );
      void queryClient.invalidateQueries({ queryKey: pantryKeys.locations(pantryId) });
    },
  });
}

/**
 * Crear un producto en el catálogo (solo con red). Envía `Idempotency-Key`;
 * al terminar invalida las búsquedas de productos (`productKeys.all`).
 *
 * @returns `UseMutationResult<ProductResponse, ProblemDetailError, IdempotentVariables<CreateProductInput>>`.
 */
export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation<ProductResponse, ProblemDetailError, IdempotentVariables<CreateProductInput>>({
    mutationFn: ({ input, idempotencyKey }) => createProductRequest(input, idempotencyKey),
    networkMode: "online",
    retry: false,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: productKeys.all }),
  });
}

/** Variables de {@link useConsumeMutation}. */
export interface ConsumeVariables {
  pantryId: string;
  input: ConsumeInput;
  /** Texto para la outbox y los avisos ("Leche"). */
  productName: string;
  unitCode: string;
  /**
   * ID de la acción del usuario (`crypto.randomUUID()`), viaja como
   * `Idempotency-Key`. Genéralo una vez por acción, no por reintento.
   */
  clientMutationId: string;
}

/** Resultado de {@link useConsumeMutation}. */
export type ConsumeOutcome =
  | { queued: false; result: ConsumeResultResponse }
  | { queued: true; clientMutationId: string };

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** `mutationKey` de {@link useConsumeMutation} (para `isMutating`). */
export const CONSUME_MUTATION_KEY = [...pantryKeys.all, "consume"] as const;

/**
 * Hogares cuyo refetch se pospuso porque había otros consumos en vuelo: el
 * último en terminar lo hace (patrón de TanStack para mutaciones concurrentes).
 */
const deferredBatchRefresh = new Set<string>();

function withoutNotes(payload: ConsumePayload): ConsumePayload {
  const { notes: _notes, ...rest } = payload;
  void _notes;
  return rest;
}

/**
 * `true` si, tras enviar el consumo, el error deja el resultado en duda (o es
 * reintentable) y debe pasar a la outbox con la misma `Idempotency-Key`:
 * mismo criterio que {@link isTransientError} (red, `backend-unavailable`,
 * 5xx, 408, 429, `409 idempotency-request-in-progress`) salvo `401`, que no
 * se encola: sin sesión el usuario debe volver a entrar y la acción se revierte.
 *
 * @param error - Error de `consumeRequest`.
 * @returns `true` si se encola.
 */
export function shouldEnqueueAfterSend(error: unknown): boolean {
  return isProblemDetailError(error) && error.status !== 401 && isTransientError(error);
}

/**
 * Consumo FEFO optimista con soporte sin red (receta `offline-outbox-mutation`):
 *
 * 1. `onMutate`: aplica el descuento FEFO en la caché (`applyOptimisticConsume`)
 *    y guarda un *snapshot* para revertir.
 * 2. Sin red: encola en Dexie (sin `notes`) con el `clientMutationId` como
 *    `Idempotency-Key` y el `userId` del usuario conocido, y deja el optimista.
 *    Los refetch posteriores lo re-aplican mientras siga en la outbox.
 * 3. Error tras enviar que deja el resultado en duda (red, 5xx,
 *    `backend-unavailable`, 408/429, clave en curso; ver
 *    {@link shouldEnqueueAfterSend}): FastAPI pudo confirmarlo, así que se
 *    encola con la misma clave (y el mismo cuerpo) en lugar de revertir; un
 *    reintento manual con otra clave podría descontar dos veces.
 * 4. Error de negocio (`insufficient-stock`…) o `401`: revierte e invalida.
 *
 * Con varios consumos en vuelo, el *snapshot* solo se restaura si es el único
 * (restaurarlo borraría los optimistas de los demás) y el refetch lo hace el
 * último en terminar.
 *
 * `networkMode: "always"`: la propia mutación decide si envía o encola (con
 * `offlineFirst` TanStack la pausaría y no llegaría a la outbox).
 *
 * @returns `UseMutationResult<ConsumeOutcome, ProblemDetailError | Error, ConsumeVariables>`.
 *
 * @example
 * ```tsx
 * const consume = useConsumeMutation();
 * consume.mutate({
 *   pantryId, productName, unitCode,
 *   input: { product_id, quantity: "1" },
 *   clientMutationId: crypto.randomUUID(),
 * });
 * ```
 */
export function useConsumeMutation() {
  const queryClient = useQueryClient();
  const isOnlyConsumeInFlight = () =>
    queryClient.isMutating({ mutationKey: CONSUME_MUTATION_KEY }) <= 1;

  return useMutation<
    ConsumeOutcome,
    ProblemDetailError | Error,
    ConsumeVariables,
    { previous: FoodBatchResponse[] | undefined; updatedAt: number | undefined }
  >({
    mutationKey: CONSUME_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    onMutate: async ({ pantryId, input }) => {
      const key = pantryKeys.batches(pantryId);
      // Un refetch en vuelo traería el stock previo y pisaría el optimista.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<FoodBatchResponse[]>(key);
      // Se conserva `dataUpdatedAt`: el optimista no "rejuvenece" la caché
      // (si no, `ageBatches` dejaría de envejecer datos de días anteriores).
      const updatedAt = queryClient.getQueryState(key)?.dataUpdatedAt;
      if (previous) {
        const payload = consumeSchema.parse(input);
        // Lanza OptimisticInsufficientStockError antes de tocar la red.
        queryClient.setQueryData(key, applyOptimisticConsume(previous, payload.product_id, payload.quantity), {
          updatedAt,
        });
      }
      return { previous, updatedAt };
    },
    mutationFn: async ({ pantryId, input, productName, unitCode, clientMutationId }) => {
      const payload = consumeSchema.parse(input);
      const enqueue = async (body: ConsumePayload, cause?: unknown): Promise<ConsumeOutcome> => {
        const userId = await knownUserId(queryClient);
        // Sin usuario conocido no se encola: la fila no podría atribuirse.
        if (!userId) throw cause ?? networkProblem();
        const store = await getDexieOutboxStore();
        await enqueueMutation(store, {
          clientMutationId,
          userId,
          endpoint: BFF_PANTRY_ROUTES.consume(pantryId),
          payload: body,
          pantryId,
          kind: "consume",
          label: `${productName} · ${formatQuantity(payload.quantity, unitCode)}`,
        });
        return { queued: true, clientMutationId };
      };

      // Nunca enviado: no se persiste `notes` (texto libre) en IndexedDB.
      if (isOffline()) return enqueue(withoutNotes(payload));
      try {
        return { queued: false, result: await consumeRequest(pantryId, payload, clientMutationId) };
      } catch (error) {
        if (shouldEnqueueAfterSend(error)) {
          // La petición salió: el reintento debe llevar el MISMO cuerpo que la
          // clave (si no, `422 idempotency-key-reused`), `notes` incluido.
          return enqueue(payload, error);
        }
        throw error;
      }
    },
    onError: (_error, { pantryId }, context) => {
      if (context?.previous && isOnlyConsumeInFlight()) {
        queryClient.setQueryData(pantryKeys.batches(pantryId), context.previous, {
          updatedAt: context.updatedAt,
        });
      }
    },
    onSettled: (outcome, error, { pantryId }) => {
      // Encolado sin error: se conserva el optimista hasta sincronizar.
      const needsRefresh =
        error !== null || outcome?.queued === false || deferredBatchRefresh.has(pantryId);
      if (!needsRefresh) return;
      if (isOnlyConsumeInFlight()) {
        deferredBatchRefresh.delete(pantryId);
        void queryClient.invalidateQueries({ queryKey: pantryKeys.batches(pantryId) });
      } else {
        deferredBatchRefresh.add(pantryId);
      }
    },
  });
}

/** Resultado de {@link useActionMutationId}. */
export interface ActionMutationId {
  /**
   * `clientMutationId` para el cuerpo dado: el mismo mientras no cambie el
   * cuerpo ni se libere; uno nuevo (`crypto.randomUUID()`) si cambia.
   */
  idFor: (body: unknown) => string;
  /**
   * Libera el ID tras un desenlace definitivo: éxito (sin `error`) o error
   * no transitorio según `isTransientError` (FastAPI podría repetir esa
   * respuesta para la misma clave). Ante errores con resultado en duda (p. ej.
   * un 2xx cuyo JSON no se pudo leer) se conserva para que el reintento no
   * duplique el efecto.
   */
  release: (error?: unknown) => void;
}

/**
 * `Idempotency-Key` estable por **acción del usuario** en un formulario: el
 * doble toque o el reintento manual del mismo cuerpo (consumo, crear hogar,
 * unirse, crear ubicación o producto) reutiliza la clave (FastAPI lo
 * deduplica), y se regenera al cambiar el cuerpo (si no, `422
 * idempotency-key-reused`), tras el éxito o tras un error definitivo. Incluye
 * en `body` todo lo que define la petición (ruta incluida, p. ej. `pantryId`).
 *
 * @returns {@link ActionMutationId}.
 *
 * @example
 * ```tsx
 * const mutationId = useActionMutationId();
 * consume.mutate(
 *   { ...vars, clientMutationId: mutationId.idFor([pantryId, input]) },
 *   { onSuccess: () => mutationId.release(), onError: (error) => mutationId.release(error) },
 * );
 * ```
 */
export function useActionMutationId(): ActionMutationId {
  const current = useRef<{ fingerprint: string; id: string } | null>(null);
  return useMemo(
    () => ({
      idFor: (body) => {
        const fingerprint = JSON.stringify(body);
        if (current.current?.fingerprint !== fingerprint) {
          current.current = { fingerprint, id: crypto.randomUUID() };
        }
        return current.current.id;
      },
      release: (error) => {
        // Errores locales previos al envío (optimista, validación) también se
        // conservan: esa clave nunca llegó a FastAPI y es inocuo reutilizarla.
        if (error === undefined || !isTransientError(error)) current.current = null;
      },
    }),
    [],
  );
}

/** Tiempo máximo por envío de la outbox; al vencer cuenta como error de red (transitorio). */
export const OUTBOX_SEND_TIMEOUT_MS = 30_000;

const ALLOWED_OUTBOX_METHODS = new Set(["POST", "PATCH", "DELETE"]);
const ENDPOINT_BASE = "http://outbox.invalid";

function invalidOutboxRecord(detail: string): ProblemDetailError {
  // 4xx no transitorio: la fila pasa a `conflict` en lugar de bloquear la cola.
  return new ProblemDetailError({
    type: problemTypeUri(PROBLEM_TYPES.invalidRequest),
    title: "Bad Request",
    status: 400,
    detail,
  });
}

/**
 * Normaliza y valida el destino de una fila de la outbox: solo rutas
 * relativas del BFF (`/api/bff/...`), nunca `/api/bff/auth/*`, otro origen,
 * barras invertidas, segmentos vacíos (`//`, que `next start` redirige con un
 * 308 y saltaría el filtro) ni `..` que escape del prefijo tras normalizar.
 * Es un filtro genérico; {@link sendOutboxRecord} además exige la ruta exacta
 * de cada `kind` ({@link OUTBOX_ENDPOINT_RULES}).
 *
 * @param endpoint - `endpoint` guardado en IndexedDB.
 * @returns Ruta normalizada (con query) o `null` si no está permitida.
 */
export function normalizeOutboxEndpoint(endpoint: string): string | null {
  if (typeof endpoint !== "string" || !endpoint.startsWith("/") || endpoint.startsWith("//")) return null;
  if (endpoint.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(endpoint, ENDPOINT_BASE);
  } catch {
    return null;
  }
  if (url.origin !== ENDPOINT_BASE) return null;
  if (url.pathname.includes("//")) return null;
  if (!url.pathname.startsWith("/api/bff/") || url.pathname.startsWith("/api/bff/auth/")) return null;
  return `${url.pathname}${url.search}`;
}

const UUID_SEGMENT = "[0-9a-fA-F-]{36}";

/**
 * Destinos permitidos por `kind` de fila: método y ruta **exacta** (sin
 * query). Un `kind` desconocido se rechaza.
 */
export const OUTBOX_ENDPOINT_RULES: Readonly<Record<string, { method: OutboxMutationRecord["method"]; pattern: RegExp }>> = {
  consume: { method: "POST", pattern: new RegExp(`^/api/bff/pantries/${UUID_SEGMENT}/consume$`) },
  "create-batch": { method: "POST", pattern: new RegExp(`^/api/bff/pantries/${UUID_SEGMENT}/batches$`) },
};

/**
 * `true` si la fila apunta al destino exacto de su `kind` (ruta canónica: la
 * normalización no debe alterar nada).
 *
 * @param record - Fila leída de IndexedDB.
 * @returns `true` si puede enviarse.
 */
export function isAllowedOutboxTarget(record: Pick<OutboxMutationRecord, "kind" | "method" | "endpoint">): boolean {
  const rule =
    record.kind && Object.prototype.hasOwnProperty.call(OUTBOX_ENDPOINT_RULES, record.kind)
      ? OUTBOX_ENDPOINT_RULES[record.kind]
      : undefined;
  if (!rule) return false;
  const path = normalizeOutboxEndpoint(record.endpoint);
  return path === record.endpoint && record.method === rule.method && rule.pattern.test(path);
}

/**
 * Envía una fila de la outbox al BFF con su `Idempotency-Key`. Rechaza (como
 * error 400 no transitorio → `conflict`) cualquier destino que no sea el de
 * su `kind` o método no permitido: IndexedDB no es una fuente de confianza.
 *
 * `redirect: "manual"`: nunca sigue una redirección (un 3xx podría llevar a
 * otra ruta del BFF). Se usa `"manual"` y no `"error"` porque `"error"` hace
 * que `fetch` rechace igual que sin red → error transitorio → la fila
 * bloquearía la cola reintentando para siempre; con `"manual"` la respuesta
 * (`opaqueredirect`, status 0, o el 3xx) se convierte en conflicto 400.
 *
 * @param record - Fila a enviar.
 * @returns La `Response` 2xx.
 * @throws {ProblemDetailError} Error del BFF/FastAPI, de red o de validación local.
 */
export const sendOutboxRecord: OutboxSender = async (record) => {
  if (!ALLOWED_OUTBOX_METHODS.has(record.method)) {
    throw invalidOutboxRecord(`Método de outbox no permitido: ${record.method}`);
  }
  if (!isAllowedOutboxTarget(record)) {
    throw invalidOutboxRecord(`Endpoint de outbox no permitido: ${record.endpoint}`);
  }
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(OUTBOX_SEND_TIMEOUT_MS)
      : undefined;
  try {
    return await bffFetch(record.endpoint, {
      method: record.method,
      json: record.payload,
      headers: { "Idempotency-Key": record.clientMutationId },
      redirect: "manual",
      signal,
    });
  } catch (error) {
    if (isProblemDetailError(error) && (error.status === 0 || (error.status >= 300 && error.status < 400))) {
      throw invalidOutboxRecord(`Redirección rechazada en la outbox: ${record.endpoint}`);
    }
    throw error;
  }
};

/** Reintentos tras un drenado detenido por error transitorio (5 s, 10 s… máx. 60 s). */
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 60_000;

/**
 * Drena la outbox al montar, al volver la conexión y al volver la pestaña a
 * primer plano:
 *
 * 1. Verifica el usuario de la cookie **ahora** (`GET /api/bff/auth/me`, sin
 *    caché). Sin sesión (`401`) se **pausa**: ni se envía ni se programan
 *    reintentos; se reanuda en el siguiente montaje/`online`/foco (p. ej.
 *    tras volver a iniciar sesión).
 * 2. Borra las filas de otros usuarios (privacidad; ver `@/lib/offline/outbox`).
 * 3. Envía solo las filas de ese usuario. Si un envío responde `401`, pausa
 *    igual que en (1) e invalida `authKeys.me()` para que la UI reaccione.
 *
 * Ante un error transitorio (también al verificar la sesión) reintenta con
 * *backoff* exponencial (5 s, 10 s… máx. 60 s; respeta `Retry-After`) mientras
 * haya red. Muestra `syncing` en el estado de conexión e invalida los lotes de
 * los hogares afectados al terminar. Móntalo una sola vez en el *layout*
 * autenticado.
 *
 * @returns `syncNow` para forzar un drenado manual.
 */
export function useOutboxSync(): { syncNow: () => Promise<void> } {
  const queryClient = useQueryClient();
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttempt = useRef(0);
  const syncRef = useRef<() => Promise<void>>(async () => undefined);

  const syncNow = useCallback(async () => {
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (isOffline()) return;

    const scheduleRetry = (retryAfterSeconds?: number) => {
      if (isOffline()) return;
      const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt.current);
      const retryAfterMs = (retryAfterSeconds ?? 0) * 1000;
      retryAttempt.current += 1;
      retryTimer.current = setTimeout(
        () => void syncRef.current(),
        Math.min(RETRY_MAX_MS, Math.max(backoff, retryAfterMs)),
      );
    };

    let store;
    try {
      store = await getDexieOutboxStore();
      if ((await store.count()) === 0) {
        retryAttempt.current = 0;
        return;
      }
    } catch {
      return; // IndexedDB no disponible (modo privado estricto): nada que drenar.
    }

    let user: UserResponse | null;
    try {
      user = await verifiedUser(queryClient);
    } catch (error) {
      scheduleRetry(isProblemDetailError(error) ? error.retry_after : undefined);
      return;
    }
    if (!user) return; // Sin sesión: pausa (no se reintenta en bucle).
    const userId = user.id;

    try {
      await store.purgeForeign(userId);
      const mine = (rows: OutboxMutationRecord[]) => rows.some((row) => row.userId === userId);
      if (!mine(await store.listPending()) && !mine(await store.listSyncing())) {
        retryAttempt.current = 0;
        return;
      }
    } catch {
      return;
    }

    useUiStore.getState().setConnectionStatus("syncing");
    try {
      const result = await drainOutbox({ store, send: sendOutboxRecord, userId });
      for (const pantryId of result.touchedPantryIds) {
        void queryClient.invalidateQueries({ queryKey: pantryKeys.batches(pantryId) });
      }
      if (result.unauthorized) {
        void queryClient.invalidateQueries({ queryKey: authKeys.me() });
      } else if (result.stoppedEarly) {
        scheduleRetry(result.retryAfterSeconds);
      } else if (result.ran) {
        retryAttempt.current = 0;
      }
    } catch (error) {
      console.error("[outbox] Fallo al drenar la cola", error);
    } finally {
      useUiStore.getState().setConnectionStatus(isOffline() ? "offline" : "online");
    }
  }, [queryClient]);

  useEffect(() => {
    syncRef.current = syncNow;
  }, [syncNow]);

  useEffect(() => {
    void syncNow();
    const onOnline = () => {
      retryAttempt.current = 0;
      void syncNow();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [syncNow]);

  return { syncNow };
}

/**
 * Filas visibles de la outbox (pendientes y conflictos) **del usuario actual**
 * (`useCurrentUser`), en vivo desde IndexedDB. Sin usuario conocido devuelve
 * `[]`: nunca se muestran filas de otra persona.
 *
 * @returns Filas en orden FIFO.
 */
export function useOutboxRecords(): OutboxMutationRecord[] {
  const userId = useCurrentUser().data?.id ?? null;
  return (
    useLiveQuery(async () => {
      if (!userId) return [];
      const { offlineDb } = await import("@/lib/db/offline-db");
      return offlineDb.outboxQueue.where("userId").equals(userId).sortBy("id");
    }, [userId]) ?? []
  );
}

/**
 * Número de mutaciones aún no sincronizadas (`pending` + `syncing`), p. ej.
 * para avisar antes de cerrar sesión ("Tienes N cambios sin sincronizar").
 * Nunca lanza: sin IndexedDB devuelve `0`.
 *
 * @param userId - Si se indica, solo cuenta las filas de ese usuario.
 * @returns Número de filas.
 *
 * @example
 * ```ts
 * const pending = await countPendingOutbox(user.id);
 * ```
 */
export async function countPendingOutbox(userId?: string): Promise<number> {
  try {
    const { offlineDb } = await import("@/lib/db/offline-db");
    return await offlineDb.outboxQueue
      .where("status")
      .anyOf("pending", "syncing")
      .filter((row) => userId === undefined || row.userId === userId)
      .count();
  } catch {
    return 0;
  }
}

/**
 * Descarta un conflicto de la outbox (el usuario acepta la verdad del servidor).
 *
 * @param id - `id` de la fila.
 * @returns Promesa que se resuelve al borrar la fila.
 */
export async function discardOutboxRecord(id: number): Promise<void> {
  const { offlineDb } = await import("@/lib/db/offline-db");
  await offlineDb.outboxQueue.delete(id);
}

/**
 * Reenvía, por decisión explícita del usuario, un cambio que caducó en la
 * outbox (conflicto `outbox-entry-expired`, ver `OUTBOX_MAX_REPLAY_AGE_MS`).
 *
 * Es una **operación nueva consciente**, no un reintento: la clave original
 * pudo caducar en FastAPI (168 h) y el servidor ya no garantiza deduplicarla,
 * así que se genera una `Idempotency-Key` nueva (`clientMutationId`), con
 * `createdAt` actual y estado `pending`. Si el envío original llegó a aplicarse
 * y solo se perdió la respuesta, el efecto puede repetirse: por eso solo se
 * hace cuando el usuario lo confirma. Se conservan el `id` (posición FIFO), el
 * destino y el cuerpo. Las filas en otro estado o con otro conflicto no se
 * tocan.
 *
 * Tras llamarla, fuerza un drenado (`useOutboxSyncNow()`).
 *
 * @param id - `id` de la fila en conflicto.
 * @param now - Reloj inyectable (tests).
 * @returns `true` si se renovó; `false` si la fila ya no existe o no es un
 *   conflicto por caducidad.
 *
 * @example
 * ```ts
 * if (await retryExpiredOutboxRecord(record.id!)) await syncNow();
 * ```
 */
export async function retryExpiredOutboxRecord(id: number, now: () => Date = () => new Date()): Promise<boolean> {
  const { offlineDb } = await import("@/lib/db/offline-db");
  const table = offlineDb.outboxQueue;
  return offlineDb.transaction("rw", table, async () => {
    const row = await table.get(id);
    if (!row || !isExpiredOutboxConflict(row)) return false;
    await table.update(id, renewedOutboxChanges(crypto.randomUUID(), now()));
    return true;
  });
}
