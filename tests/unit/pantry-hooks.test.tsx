import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys, type UserResponse } from "@/features/auth/api";
import { pantryKeys, type FoodBatchResponse, type PantryResponse } from "@/features/pantry/api";
import {
  CONSUME_MUTATION_KEY,
  countPendingOutbox,
  shouldEnqueueAfterSend,
  useActivePantry,
  useBatches,
  useConsumeMutation,
  useOutboxSync,
  type ConsumeVariables,
} from "@/features/pantry/hooks";
import { networkProblem, PROBLEM_TYPES, ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import { offlineDb, type OutboxMutationRecord } from "@/lib/db/offline-db";
import { useUiStore } from "@/stores/ui-store";
import { IDS, makeBatch } from "./helpers/pantry-fixtures";

/*
 * Hooks del dominio pantry contra Dexie real sobre `fake-indexeddb` y `fetch`
 * simulado por ruta (el BFF).
 */

const USER = { id: "user-a", email: "a@despensa-qa.com", full_name: "A" } as unknown as UserResponse;
const OTHER = "user-b";

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;

/** `fetch` por ruta; las rutas sin handler fallan como error de red. */
function routeFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const handler = routes[path.split("?")[0]!];
    if (!handler) throw new TypeError(`Failed to fetch ${path}`);
    return handler(init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const problemResponse = (status: number, slug: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ type: problemTypeUri(slug), title: "x", status, detail: slug }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup({ user = USER as UserResponse | null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  if (user !== undefined) queryClient.setQueryData(authKeys.me(), user);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const CONSUME_PATH = `/api/bff/pantries/${IDS.pantry}/consume`;
const BATCHES_PATH = `/api/bff/pantries/${IDS.pantry}/batches`;

const milk = (current = "2", extra: Partial<FoodBatchResponse> = {}) =>
  makeBatch({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", current_quantity: current, ...extra });

const consumeVars = (quantity: string, extra: Partial<ConsumeVariables> = {}): ConsumeVariables => ({
  pantryId: IDS.pantry,
  input: { product_id: IDS.milk, quantity },
  productName: "Leche",
  unitCode: "l",
  clientMutationId: crypto.randomUUID(),
  ...extra,
});

const cachedQuantities = (queryClient: QueryClient) =>
  queryClient.getQueryData<FoodBatchResponse[]>(pantryKeys.batches(IDS.pantry))?.map((b) => b.current_quantity);

async function seedRow(overrides: Partial<OutboxMutationRecord> = {}): Promise<number> {
  return (await offlineDb.outboxQueue.add({
    clientMutationId: crypto.randomUUID(),
    userId: USER.id,
    endpoint: CONSUME_PATH,
    method: "POST",
    payload: { product_id: IDS.milk, quantity: "0.5" },
    pantryId: IDS.pantry,
    status: "pending",
    createdAt: new Date().toISOString(),
    kind: "consume",
    label: "Leche · 0,5 l",
    attempts: 0,
    lastError: null,
    ...overrides,
  })) as number;
}

beforeEach(async () => {
  await offlineDb.outboxQueue.clear();
  useUiStore.setState({ activePantryId: null, connectionStatus: "online" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Dexie OutboxStore (fake-indexeddb)", () => {
  it("claim es atómico: solo reclama filas pending existentes", async () => {
    const { getDexieOutboxStore } = await import("@/lib/offline/outbox");
    const store = await getDexieOutboxStore();
    const id = await seedRow();

    const results = await Promise.all([
      store.claim(id, { status: "syncing" }),
      store.claim(id, { status: "syncing" }),
      store.claim(id, { status: "syncing" }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await offlineDb.outboxQueue.get(id))?.status).toBe("syncing");

    await store.remove(id);
    expect(await store.claim(id, { status: "syncing" })).toBe(false);
  });

  it("purgeForeign borra filas de otros usuarios y sin userId (v1), en cualquier estado", async () => {
    const { getDexieOutboxStore } = await import("@/lib/offline/outbox");
    const store = await getDexieOutboxStore();
    const mine = await seedRow();
    await seedRow({ userId: OTHER, status: "conflict" });
    await seedRow({ userId: undefined });

    expect(await store.purgeForeign(USER.id)).toBe(2);
    expect((await offlineDb.outboxQueue.toArray()).map((row) => row.id)).toEqual([mine]);
    expect(await store.count()).toBe(1);
  });

  it("la v2 indexa userId", async () => {
    await seedRow({ userId: OTHER });
    expect(await offlineDb.outboxQueue.where("userId").equals(OTHER).count()).toBe(1);
    expect(offlineDb.verno).toBe(2);
  });

  it("countPendingOutbox cuenta pending + syncing (opcionalmente por usuario)", async () => {
    await seedRow();
    await seedRow({ status: "syncing" });
    await seedRow({ status: "conflict" });
    await seedRow({ userId: OTHER });
    expect(await countPendingOutbox()).toBe(3);
    expect(await countPendingOutbox(USER.id)).toBe(2);
  });
});

describe("shouldEnqueueAfterSend (coherente con isTransientError)", () => {
  const p = (status: number, slug: string) => new ProblemDetailError({ type: problemTypeUri(slug), title: "x", status });
  it.each([
    [networkProblem(), true],
    [p(502, PROBLEM_TYPES.backendUnavailable), true],
    [p(503, "x"), true],
    [p(504, "x"), true],
    [p(500, "x"), true],
    [p(429, PROBLEM_TYPES.rateLimitExceeded), true],
    [p(409, PROBLEM_TYPES.idempotencyRequestInProgress), true],
    [p(401, PROBLEM_TYPES.invalidToken), false],
    [p(400, PROBLEM_TYPES.insufficientStock), false],
    [p(403, PROBLEM_TYPES.pantryAccessDenied), false],
    [new Error("local"), false],
  ])("%o → %s", (error, expected) => {
    expect(shouldEnqueueAfterSend(error)).toBe(expected);
  });
});

describe("useConsumeMutation", () => {
  it("aplica el descuento optimista antes de la respuesta y refresca al confirmar", async () => {
    const response = deferred<Response>();
    routeFetch({ [CONSUME_PATH]: () => response.promise });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => result.current.mutate(consumeVars("0.5")));
    await waitFor(() => expect(cachedQuantities(queryClient)).toEqual(["1.5"]));
    expect(invalidate).not.toHaveBeenCalled();

    response.resolve(json({ product_id: IDS.milk, consumed_quantity: "0.5", batches: [] }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ queued: false });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pantryKeys.batches(IDS.pantry) });
  });

  it("conserva dataUpdatedAt en el optimista (no rejuvenece la caché)", async () => {
    routeFetch({ [CONSUME_PATH]: () => new Promise(() => undefined) });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")], { updatedAt: 1_000 });
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => result.current.mutate(consumeVars("0.5")));
    await waitFor(() => expect(cachedQuantities(queryClient)).toEqual(["1.5"]));
    expect(queryClient.getQueryState(pantryKeys.batches(IDS.pantry))?.dataUpdatedAt).toBe(1_000);
  });

  it("revierte el snapshot ante insufficient-stock si es el único consumo en vuelo", async () => {
    routeFetch({ [CONSUME_PATH]: () => problemResponse(400, PROBLEM_TYPES.insufficientStock) });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => result.current.mutate(consumeVars("0.5")));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cachedQuantities(queryClient)).toEqual(["2"]);
    expect(await offlineDb.outboxQueue.count()).toBe(0);
  });

  it("con dos consumos en vuelo no restaura el snapshot y el refetch lo hace el último", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const queue = [first, second];
    routeFetch({ [CONSUME_PATH]: () => queue.shift()!.promise });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const a = renderHook(() => useConsumeMutation(), { wrapper });
    const b = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => a.result.current.mutate(consumeVars("0.5")));
    await waitFor(() => expect(cachedQuantities(queryClient)).toEqual(["1.5"]));
    act(() => b.result.current.mutate(consumeVars("0.5")));
    await waitFor(() => expect(cachedQuantities(queryClient)).toEqual(["1"]));
    expect(queryClient.isMutating({ mutationKey: CONSUME_MUTATION_KEY })).toBe(2);

    first.resolve(problemResponse(400, PROBLEM_TYPES.insufficientStock));
    await waitFor(() => expect(a.result.current.isError).toBe(true));
    // No se restaura (borraría el optimista de B) ni se refresca aún.
    expect(cachedQuantities(queryClient)).toEqual(["1"]);
    expect(invalidate).not.toHaveBeenCalled();

    second.resolve(json({ product_id: IDS.milk, consumed_quantity: "0.5", batches: [] }));
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pantryKeys.batches(IDS.pantry) });
  });

  it.each([
    ["error de red", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["502 backend-unavailable", () => Promise.resolve(problemResponse(502, PROBLEM_TYPES.backendUnavailable))],
    ["503", () => Promise.resolve(problemResponse(503, "service-unavailable"))],
    ["504", () => Promise.resolve(problemResponse(504, "gateway-timeout"))],
  ])("tras enviar, %s encola con la misma clave, userId y cuerpo (notes incluido) y conserva el optimista", async (_name, reply) => {
    routeFetch({ [CONSUME_PATH]: () => reply() });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });
    const vars = consumeVars("0.5", { input: { product_id: IDS.milk, quantity: "0.5", notes: "caducaba" } });

    act(() => result.current.mutate(vars));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({ queued: true, clientMutationId: vars.clientMutationId });
    const [row] = await offlineDb.outboxQueue.toArray();
    expect(row).toMatchObject({
      clientMutationId: vars.clientMutationId,
      userId: USER.id,
      status: "pending",
      kind: "consume",
      endpoint: CONSUME_PATH,
      payload: { product_id: IDS.milk, quantity: "0.5", notes: "caducaba" },
    });
    expect(cachedQuantities(queryClient)).toEqual(["1.5"]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("sin red encola sin notes y sin llamar a fetch", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetchMock = routeFetch({});
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => result.current.mutate(consumeVars("1", { input: { product_id: IDS.milk, quantity: "1", notes: "privado" } })));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await offlineDb.outboxQueue.toArray();
    expect(row!.payload).toEqual({ product_id: IDS.milk, quantity: "1" });
    expect(row!.userId).toBe(USER.id);
  });

  it("sin usuario conocido no encola: revierte", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    routeFetch({});
    const { queryClient, wrapper } = setup({ user: null });
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => result.current.mutate(consumeVars("1")));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(await offlineDb.outboxQueue.count()).toBe(0);
    expect(cachedQuantities(queryClient)).toEqual(["2"]);
  });

  it("un 401 no se encola: revierte", async () => {
    routeFetch({
      [CONSUME_PATH]: () => problemResponse(401, PROBLEM_TYPES.invalidToken),
      "/api/bff/auth/refresh": () => problemResponse(401, PROBLEM_TYPES.invalidToken),
    });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);
    const { result } = renderHook(() => useConsumeMutation(), { wrapper });

    act(() => result.current.mutate(consumeVars("1")));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(await offlineDb.outboxQueue.count()).toBe(0);
    expect(cachedQuantities(queryClient)).toEqual(["2"]);
  });
});

describe("useBatches", () => {
  it("re-aplica los consumos pending y syncing del usuario, no los de otros ni los conflictos", async () => {
    routeFetch({ [BATCHES_PATH]: () => json([milk("2")]) });
    await seedRow({ payload: { product_id: IDS.milk, quantity: "0.5" } });
    await seedRow({ status: "syncing", payload: { product_id: IDS.milk, quantity: "0.25" } });
    await seedRow({ status: "conflict", payload: { product_id: IDS.milk, quantity: "1" } });
    await seedRow({ userId: OTHER, payload: { product_id: IDS.milk, quantity: "1" } });
    const { wrapper } = setup();

    const { result } = renderHook(() => useBatches(IDS.pantry), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((batch) => batch.current_quantity)).toEqual(["1.25"]);
  });

  it("envejece días y semáforo si la caché es de un día anterior", async () => {
    const { queryClient, wrapper } = setup();
    const threeDaysAgo = Date.now() - 3 * 86_400_000;
    queryClient.setQueryData(
      pantryKeys.batches(IDS.pantry),
      [milk("2", { dias_para_vencer: 5, semaforo: "PRECAUCIÓN" })],
      { updatedAt: threeDaysAgo },
    );
    queryClient.setQueryDefaults(pantryKeys.batches(IDS.pantry), { staleTime: Infinity });

    const { result } = renderHook(() => useBatches(IDS.pantry), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data![0]).toMatchObject({ dias_para_vencer: 2, semaforo: "CRÍTICO" });
    // La caché no se muta.
    expect(queryClient.getQueryData<FoodBatchResponse[]>(pantryKeys.batches(IDS.pantry))![0]!.dias_para_vencer).toBe(5);
  });
});

describe("useActivePantry", () => {
  const pantry = (id: string, name: string) => ({ id, name }) as unknown as PantryResponse;
  const A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const B = "aaaaaaaa-0000-4000-8000-00000000000b";

  it("usa el ID guardado si sigue entre los hogares del usuario", async () => {
    routeFetch({ "/api/bff/pantries": () => json([pantry(A, "Casa"), pantry(B, "Playa")]) });
    useUiStore.setState({ activePantryId: B });
    const { wrapper } = setup();
    const { result } = renderHook(() => useActivePantry(), { wrapper });
    await waitFor(() => expect(result.current.pantry?.id).toBe(B));
  });

  it("si el ID guardado no está (otro usuario, membresía revocada) cae al primero y lo persiste", async () => {
    routeFetch({ "/api/bff/pantries": () => json([pantry(A, "Casa"), pantry(B, "Playa")]) });
    useUiStore.setState({ activePantryId: "ffffffff-0000-4000-8000-000000000000" });
    const { wrapper } = setup();
    const { result } = renderHook(() => useActivePantry(), { wrapper });
    await waitFor(() => expect(result.current.pantry?.id).toBe(A));
    await waitFor(() => expect(useUiStore.getState().activePantryId).toBe(A));
  });

  it("sin hogares deja activePantryId en null", async () => {
    routeFetch({ "/api/bff/pantries": () => json([]) });
    useUiStore.setState({ activePantryId: A });
    const { wrapper } = setup();
    const { result } = renderHook(() => useActivePantry(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pantry).toBeNull();
    await waitFor(() => expect(useUiStore.getState().activePantryId).toBeNull());
  });
});

describe("useOutboxSync", () => {
  /** Retardos (ms) de los temporizadores de reintento programados por el hook. */
  function retryDelays(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls.map((call) => call[1] as number).filter((ms) => ms >= 5_000);
  }

  it("verifica /me, borra filas ajenas y envía solo las del usuario", async () => {
    const mine = await seedRow();
    await seedRow({ userId: OTHER });
    const sent: string[] = [];
    routeFetch({
      "/api/bff/auth/me": () => json(USER),
      [CONSUME_PATH]: (init) => {
        sent.push(new Headers(init?.headers).get("Idempotency-Key")!);
        return json({ product_id: IDS.milk, consumed_quantity: "0.5", batches: [] });
      },
    });
    const { wrapper } = setup();
    const row = await offlineDb.outboxQueue.get(mine);

    renderHook(() => useOutboxSync(), { wrapper });

    await waitFor(async () => expect(await offlineDb.outboxQueue.count()).toBe(0));
    expect(sent).toEqual([row!.clientMutationId]);
    expect(useUiStore.getState().connectionStatus).toBe("online");
  });

  it("otro usuario autenticado en el dispositivo: no envía nada y borra la cola ajena", async () => {
    await seedRow();
    const consume = vi.fn(() => json({}));
    routeFetch({ "/api/bff/auth/me": () => json({ ...USER, id: OTHER }), [CONSUME_PATH]: consume });
    const { wrapper } = setup();

    renderHook(() => useOutboxSync(), { wrapper });

    await waitFor(async () => expect(await offlineDb.outboxQueue.count()).toBe(0));
    expect(consume).not.toHaveBeenCalled();
  });

  it("sin sesión (401 en /me) pausa: no envía ni programa reintentos", async () => {
    await seedRow();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const consume = vi.fn(() => json({}));
    const fetchMock = routeFetch({
      "/api/bff/auth/me": () => problemResponse(401, PROBLEM_TYPES.invalidToken),
      "/api/bff/auth/refresh": () => problemResponse(401, PROBLEM_TYPES.invalidToken),
      [CONSUME_PATH]: consume,
    });
    const { wrapper } = setup();

    renderHook(() => useOutboxSync(), { wrapper });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/bff/auth/me", expect.anything()));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(consume).not.toHaveBeenCalled();
    expect(retryDelays(timers)).toEqual([]);
    expect((await offlineDb.outboxQueue.toArray()).map((row) => row.status)).toEqual(["pending"]);
  });

  it("un 401 al enviar pausa sin reintentos en bucle", async () => {
    await seedRow();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const consume = vi.fn(() => problemResponse(401, PROBLEM_TYPES.invalidToken));
    routeFetch({
      "/api/bff/auth/me": () => json(USER),
      "/api/bff/auth/refresh": () => problemResponse(401, PROBLEM_TYPES.invalidToken),
      [CONSUME_PATH]: consume,
    });
    const { wrapper } = setup();

    renderHook(() => useOutboxSync(), { wrapper });

    await waitFor(() => expect(consume).toHaveBeenCalledOnce());
    await waitFor(() => expect(useUiStore.getState().connectionStatus).toBe("online"));
    expect(retryDelays(timers)).toEqual([]);
    expect((await offlineDb.outboxQueue.toArray()).map((row) => row.status)).toEqual(["pending"]);
  });

  it("ante 503 reintenta con backoff exponencial (5 s, 10 s) y respeta Retry-After", async () => {
    await seedRow();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const replies = [
      () => problemResponse(503, PROBLEM_TYPES.backendUnavailable),
      () => problemResponse(503, PROBLEM_TYPES.backendUnavailable),
      () => problemResponse(429, PROBLEM_TYPES.rateLimitExceeded, { "Retry-After": "40" }),
      () => json({ product_id: IDS.milk, consumed_quantity: "0.5", batches: [] }),
    ];
    const keys: (string | null)[] = [];
    const consume = vi.fn((init: RequestInit | undefined) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key"));
      return replies.shift()!();
    });
    routeFetch({ "/api/bff/auth/me": () => json(USER), [CONSUME_PATH]: consume });
    const { wrapper } = setup();

    const fireLastRetry = async () => {
      const call = timers.mock.calls.filter((c) => (c[1] as number) >= 5_000).at(-1)!;
      await act(async () => (call[0] as () => void)());
    };

    renderHook(() => useOutboxSync(), { wrapper });
    await waitFor(() => expect(retryDelays(timers)).toEqual([5_000]));
    await fireLastRetry();
    await waitFor(() => expect(retryDelays(timers)).toEqual([5_000, 10_000]));
    await fireLastRetry();
    // Retry-After (40 s) > backoff (20 s).
    await waitFor(() => expect(retryDelays(timers)).toEqual([5_000, 10_000, 40_000]));
    await fireLastRetry();
    await waitFor(async () => expect(await offlineDb.outboxQueue.count()).toBe(0));
    expect(consume).toHaveBeenCalledTimes(4);
    // La misma Idempotency-Key en todos los intentos.
    expect(new Set(keys).size).toBe(1);
  });

  it("si /me falla por red programa un reintento en lugar de drenar", async () => {
    await seedRow();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const consume = vi.fn(() => json({}));
    routeFetch({ [CONSUME_PATH]: consume }); // /me sin handler → error de red
    const { wrapper } = setup();

    renderHook(() => useOutboxSync(), { wrapper });

    await waitFor(() => expect(retryDelays(timers)).toEqual([5_000]));
    expect(consume).not.toHaveBeenCalled();
  });
});
