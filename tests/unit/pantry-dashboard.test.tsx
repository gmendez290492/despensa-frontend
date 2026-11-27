import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys, type UserResponse } from "@/features/auth/api";
import {
  BFF_PANTRY_ROUTES,
  pantryKeys,
  type FoodBatchResponse,
  type PantryDashboardResponse,
  type PantryResponse,
} from "@/features/pantry/api";
import {
  useBatches,
  useConsumeMutation,
  useLocations,
  usePantries,
  usePantryDashboard,
  useUnreadNotificationsCount,
  type ConsumeVariables,
} from "@/features/pantry/hooks";
import { problemTypeUri } from "@/lib/api/problem";
import { offlineDb } from "@/lib/db/offline-db";
import { useUiStore } from "@/stores/ui-store";
import { IDS, LOCATIONS, makeBatch } from "./helpers/pantry-fixtures";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const { StatusAnnouncerProvider } = await import("@/components/status-announcer");
const { ConsumeDialogProvider } = await import("@/features/pantry/components/consume-dialog-provider");
const { HomeDashboard } = await import("@/features/pantry/components/home-dashboard");

/*
 * `GET /api/bff/pantries/{id}/dashboard` (issue #10): una petición siembra
 * las claves sueltas (lista, ubicaciones, lotes, alertas) y el panel deja de
 * hacer 4 llamadas.
 */

const USER = { id: "user-a", email: "a@despensa-qa.com", full_name: "A" } as unknown as UserResponse;
const OTHER_PANTRY = "77777777-7777-4777-8777-777777777777";

const DASHBOARD_PATH = BFF_PANTRY_ROUTES.dashboard(IDS.pantry);
const BATCHES_PATH = BFF_PANTRY_ROUTES.batches(IDS.pantry);
const LOCATIONS_PATH = BFF_PANTRY_ROUTES.locations(IDS.pantry);
const CONSUME_PATH = BFF_PANTRY_ROUTES.consume(IDS.pantry);

const PANTRY = {
  id: IDS.pantry,
  name: "Casa",
  invite_code: "DESP-ABCD1234",
  created_at: "2026-01-01T00:00:00Z",
} as unknown as PantryResponse;

const milk = (current = "2", extra: Partial<FoodBatchResponse> = {}) =>
  makeBatch({ id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001", current_quantity: current, ...extra });

const dashboardBody = (extra: Partial<PantryDashboardResponse> = {}): PantryDashboardResponse => ({
  pantries: [PANTRY],
  locations: LOCATIONS,
  batches: [milk("2")],
  unread_notifications: 3,
  ...extra,
});

type Handler = () => Response | Promise<Response>;

/** `fetch` por ruta (sin query); las rutas sin handler fallan como error de red. */
function routeFetch(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const handler = routes[path.split("?")[0]!];
    if (!handler) throw new TypeError(`Failed to fetch ${path}`);
    return handler();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const calledPaths = (fetchMock: ReturnType<typeof routeFetch>) =>
  fetchMock.mock.calls.map(([input]) => String(input).split("?")[0]!);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, slug: string) =>
  new Response(JSON.stringify({ type: problemTypeUri(slug), title: slug, status, detail: slug }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  // Usuario conocido: el *rebase* de la outbox no pide `/me`.
  queryClient.setQueryData(authKeys.me(), USER);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const consumeVars = (quantity: string): ConsumeVariables => ({
  pantryId: IDS.pantry,
  input: { product_id: IDS.milk, quantity },
  productName: "Leche",
  unitCode: "l",
  clientMutationId: crypto.randomUUID(),
});

const cachedQuantities = (queryClient: QueryClient) =>
  queryClient.getQueryData<FoodBatchResponse[]>(pantryKeys.batches(IDS.pantry))?.map((b) => b.current_quantity);

beforeEach(async () => {
  await offlineDb.outboxQueue.clear();
  useUiStore.setState({ activePantryId: null, connectionStatus: "online" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usePantryDashboard", () => {
  it("siembra lista, ubicaciones, lotes (con la outbox re-aplicada) y alertas con el mismo updatedAt", async () => {
    const fetchMock = routeFetch({ [DASHBOARD_PATH]: () => json(dashboardBody()) });
    await offlineDb.outboxQueue.add({
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
    });
    const { queryClient, wrapper } = setup();
    const before = Date.now();

    const { result } = renderHook(() => usePantryDashboard(IDS.pantry), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calledPaths(fetchMock)).toEqual([DASHBOARD_PATH]);
    expect(queryClient.getQueryData(pantryKeys.list())).toEqual([PANTRY]);
    expect(queryClient.getQueryData(pantryKeys.locations(IDS.pantry))).toEqual(LOCATIONS);
    expect(cachedQuantities(queryClient)).toEqual(["1.5"]);
    expect(queryClient.getQueryData(pantryKeys.unreadNotifications())).toBe(3);

    const updatedAt = queryClient.getQueryState(pantryKeys.batches(IDS.pantry))!.dataUpdatedAt;
    expect(updatedAt).toBeGreaterThanOrEqual(before);
    for (const key of [pantryKeys.list(), pantryKeys.locations(IDS.pantry), pantryKeys.unreadNotifications()]) {
      expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(updatedAt);
    }
  });

  it("las queries sueltas montadas después esperan al dashboard: una sola petición", async () => {
    const fetchMock = routeFetch({ [DASHBOARD_PATH]: () => json(dashboardBody()) });
    const { wrapper } = setup();

    const { result } = renderHook(
      () => {
        usePantryDashboard(IDS.pantry);
        return {
          batches: useBatches(IDS.pantry),
          locations: useLocations(IDS.pantry),
          unread: useUnreadNotificationsCount(),
        };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.batches.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.unread.isSuccess).toBe(true));
    expect(result.current.locations.data).toEqual(LOCATIONS);
    expect(result.current.unread.data).toBe(3);
    expect(calledPaths(fetchMock)).toEqual([DASHBOARD_PATH]);
  });

  it("no pisa un consumo optimista que empezó mientras el dashboard estaba en vuelo", async () => {
    const dashboard = deferred<Response>();
    const consume = deferred<Response>();
    routeFetch({ [DASHBOARD_PATH]: () => dashboard.promise, [CONSUME_PATH]: () => consume.promise });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")], { updatedAt: 1_000 });

    const { result } = renderHook(
      () => ({ dashboard: usePantryDashboard(IDS.pantry), consume: useConsumeMutation() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.dashboard.fetchStatus).toBe("fetching"));
    act(() => result.current.consume.mutate(consumeVars("0.5")));
    await waitFor(() => expect(cachedQuantities(queryClient)).toEqual(["1.5"]));

    // El servidor aún no ve el consumo: devuelve el stock previo.
    dashboard.resolve(json(dashboardBody({ batches: [milk("2")] })));
    await waitFor(() => expect(result.current.dashboard.isSuccess).toBe(true));
    expect(cachedQuantities(queryClient)).toEqual(["1.5"]);
    expect(queryClient.getQueryState(pantryKeys.batches(IDS.pantry))?.dataUpdatedAt).toBe(1_000);
    // El resto sí se siembra.
    expect(queryClient.getQueryData(pantryKeys.locations(IDS.pantry))).toEqual(LOCATIONS);

    consume.resolve(json({ product_id: IDS.milk, consumed_quantity: "0.5", batches_affected: [] }));
    await waitFor(() => expect(result.current.consume.isSuccess).toBe(true));
  });

  it("no siembra los lotes si al llegar hay un consumo de ese hogar en vuelo", async () => {
    const dashboard = deferred<Response>();
    routeFetch({ [DASHBOARD_PATH]: () => dashboard.promise, [CONSUME_PATH]: () => new Promise(() => undefined) });
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(pantryKeys.batches(IDS.pantry), [milk("2")]);

    const { result } = renderHook(() => useConsumeMutation(), { wrapper });
    act(() => result.current.mutate(consumeVars("0.5")));
    await waitFor(() => expect(cachedQuantities(queryClient)).toEqual(["1.5"]));

    const { result: dash } = renderHook(() => usePantryDashboard(IDS.pantry), { wrapper });
    dashboard.resolve(json(dashboardBody({ batches: [milk("2")] })));
    await waitFor(() => expect(dash.current.isSuccess).toBe(true));
    expect(cachedQuantities(queryClient)).toEqual(["1.5"]);
  });

  it("403 pantry-access-denied llega a useBatches sin pedir GET /batches", async () => {
    const fetchMock = routeFetch({ [DASHBOARD_PATH]: () => problem(403, "pantry-access-denied") });
    const { wrapper } = setup();

    const { result } = renderHook(
      () => {
        usePantryDashboard(IDS.pantry);
        return useBatches(IDS.pantry);
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(403);
    expect(result.current.error?.is("pantry-access-denied")).toBe(true);
    expect(calledPaths(fetchMock)).toEqual([DASHBOARD_PATH]);
  });

  it("404 (backend sin el endpoint): cae a las llamadas sueltas y no vuelve a probarlo", async () => {
    const fetchMock = routeFetch({
      [DASHBOARD_PATH]: () => json({ detail: "Not Found" }, 404),
      [BATCHES_PATH]: () => json([milk("2")]),
      [LOCATIONS_PATH]: () => json(LOCATIONS),
      [BFF_PANTRY_ROUTES.notifications]: () => json({ items: [], total: 0, unread_count: 1 }),
    });
    const { wrapper } = setup();

    const { result } = renderHook(
      () => ({
        dashboard: usePantryDashboard(IDS.pantry),
        batches: useBatches(IDS.pantry),
        locations: useLocations(IDS.pantry),
        unread: useUnreadNotificationsCount(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.batches.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.unread.data).toBe(1));
    expect(result.current.dashboard.data).toBeNull();
    expect(result.current.locations.data).toEqual(LOCATIONS);
    expect(calledPaths(fetchMock).sort()).toEqual(
      [DASHBOARD_PATH, BATCHES_PATH, LOCATIONS_PATH, BFF_PANTRY_ROUTES.notifications].sort(),
    );

    // Otro hogar en la misma sesión: no se repite el 404.
    const { result: other } = renderHook(() => usePantryDashboard(OTHER_PANTRY), { wrapper });
    await waitFor(() => expect(other.current.isSuccess).toBe(true));
    expect(other.current.data).toBeNull();
    expect(calledPaths(fetchMock).filter((path) => path.endsWith("/dashboard"))).toHaveLength(1);
  });
});

describe("usePantries vía dashboard", () => {
  it("con un hogar guardado la lista sale del dashboard (y siembra el resto)", async () => {
    useUiStore.setState({ activePantryId: IDS.pantry });
    const fetchMock = routeFetch({ [DASHBOARD_PATH]: () => json(dashboardBody()) });
    const { queryClient, wrapper } = setup();

    const { result } = renderHook(() => usePantries(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([PANTRY]);
    expect(calledPaths(fetchMock)).toEqual([DASHBOARD_PATH]);
    expect(cachedQuantities(queryClient)).toEqual(["2"]);
  });

  it("si el hogar guardado da 403 (ajeno o revocado) cae a GET /pantries", async () => {
    useUiStore.setState({ activePantryId: IDS.pantry });
    const fetchMock = routeFetch({
      [DASHBOARD_PATH]: () => problem(403, "pantry-access-denied"),
      [BFF_PANTRY_ROUTES.pantries]: () => json([PANTRY]),
    });
    const { wrapper } = setup();

    const { result } = renderHook(() => usePantries(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calledPaths(fetchMock)).toEqual([DASHBOARD_PATH, BFF_PANTRY_ROUTES.pantries]);
  });
});

describe("HomeDashboard con el dashboard", () => {
  function renderPanel() {
    const { queryClient, wrapper: QueryWrapper } = setup();
    render(
      <QueryWrapper>
        <NuqsTestingAdapter>
          <StatusAnnouncerProvider>
            <ConsumeDialogProvider>
              <HomeDashboard />
            </ConsumeDialogProvider>
          </StatusAnnouncerProvider>
        </NuqsTestingAdapter>
      </QueryWrapper>,
    );
    return { queryClient };
  }

  it("primera carga con un hogar guardado: una sola petición", async () => {
    useUiStore.setState({ activePantryId: IDS.pantry });
    const fetchMock = routeFetch({ [DASHBOARD_PATH]: () => json(dashboardBody()) });
    renderPanel();

    expect(await screen.findByRole("heading", { name: "Ubicaciones" })).toBeInTheDocument();
    expect(screen.getByText("3 alertas sin leer")).toBeInTheDocument();
    expect(screen.getByText("Casa")).toBeInTheDocument();
    expect(calledPaths(fetchMock)).toEqual([DASHBOARD_PATH]);
  });

  it("sin hogar guardado: GET /pantries y después el dashboard (2 peticiones)", async () => {
    const fetchMock = routeFetch({
      [BFF_PANTRY_ROUTES.pantries]: () => json([PANTRY]),
      [DASHBOARD_PATH]: () => json(dashboardBody()),
    });
    renderPanel();

    expect(await screen.findByRole("heading", { name: "Ubicaciones" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("3 alertas sin leer")).toBeInTheDocument());
    expect(calledPaths(fetchMock)).toEqual([BFF_PANTRY_ROUTES.pantries, DASHBOARD_PATH]);
  });

  it("un 403 del dashboard muestra el mismo estado que un 403 de los lotes", async () => {
    useUiStore.setState({ activePantryId: IDS.pantry });
    routeFetch({
      [DASHBOARD_PATH]: () => problem(403, "pantry-access-denied"),
      [BFF_PANTRY_ROUTES.pantries]: () => json([PANTRY]),
      [BFF_PANTRY_ROUTES.notifications]: () => json({ items: [], total: 0, unread_count: 0 }),
    });
    renderPanel();

    expect(await screen.findByText("Ya no tienes acceso a este hogar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recargar hogares" })).toBeInTheDocument();
  });
});
