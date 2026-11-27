import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pantryKeys, type LocationResponse, type PantryResponse } from "@/features/pantry/api";
import { PantryOnboarding } from "@/features/pantry/components/pantry-onboarding";
import {
  isIdempotencyInProgressError,
  useActionMutationId,
  useCreateLocationMutation,
  useCreatePantryMutation,
  useCreateProductMutation,
  useJoinPantryMutation,
} from "@/features/pantry/hooks";
import { PROBLEM_TYPES, problemTypeUri } from "@/lib/api/problem";
import { useUiStore } from "@/stores/ui-store";
import { IDS } from "./helpers/pantry-fixtures";

/*
 * `Idempotency-Key` en las mutaciones online (crear hogar, unirse, crear
 * ubicación, crear producto): una clave por intención del usuario, reutilizada
 * en el reintento tras 5xx con el mismo cuerpo y regenerada tras el éxito, un
 * error definitivo o un cambio de cuerpo.
 */

const PANTRY = { id: IDS.pantry, name: "Casa", invite_code: "ABC123", created_at: "2026-01-01T00:00:00Z" } as PantryResponse;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const problem = (status: number, slug: string) =>
  new Response(JSON.stringify({ type: problemTypeUri(slug), title: "x", status, detail: slug }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

/** `fetch` que devuelve las respuestas en orden y registra ruta + clave. */
function sequenceFetch(...responses: (() => Response)[]) {
  const calls: { path: string; key: string | null; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    calls.push({
      path,
      key: new Headers(init?.headers).get("Idempotency-Key"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new TypeError(`Failed to fetch ${path}`);
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: 3 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Hook de prueba: crear hogar con el patrón de `PantryOnboarding`. */
function useCreatePantryForm() {
  const create = useCreatePantryMutation();
  const mutationId = useActionMutationId();
  return {
    create,
    submit: (name: string) =>
      create
        .mutateAsync({ input: { name }, idempotencyKey: mutationId.idFor(["create-pantry", { name }]) })
        .then(
          (pantry) => {
            mutationId.release();
            return pantry;
          },
          (error: unknown) => {
            mutationId.release(error);
            return error;
          },
        ),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useUiStore.setState({ activePantryId: null, connectionStatus: "online" });
});

describe("Idempotency-Key por intención del usuario", () => {
  it("reutiliza la clave en el reintento tras 5xx y la regenera tras el éxito", async () => {
    const { calls } = sequenceFetch(
      () => problem(503, PROBLEM_TYPES.backendUnavailable),
      () => json(PANTRY, 201),
      () => json({ ...PANTRY, id: crypto.randomUUID() }, 201),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePantryForm(), { wrapper });

    await act(() => result.current.submit("Casa"));
    await act(() => result.current.submit("Casa"));
    await act(() => result.current.submit("Casa"));

    // `retry: false` en el hook pese al `retry: 3` por defecto: una petición por envío.
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.path === "/api/bff/pantries")).toBe(true);
    const [first, retry, afterSuccess] = calls.map((call) => call.key);
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(retry).toBe(first);
    expect(afterSuccess).not.toBe(first);
    expect(useUiStore.getState().activePantryId).not.toBeNull();
  });

  it("genera una clave nueva si cambia el cuerpo", async () => {
    const { calls } = sequenceFetch(
      () => problem(500, PROBLEM_TYPES.unknown),
      () => json(PANTRY, 201),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePantryForm(), { wrapper });

    await act(() => result.current.submit("Casa"));
    await act(() => result.current.submit("Casa de la playa"));

    expect(calls.map((call) => call.body)).toEqual([{ name: "Casa" }, { name: "Casa de la playa" }]);
    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  it("regenera la clave tras un error no transitorio (4xx de negocio)", async () => {
    const { calls } = sequenceFetch(
      () => problem(400, PROBLEM_TYPES.invalidRequest),
      () => json(PANTRY, 201),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePantryForm(), { wrapper });

    await act(() => result.current.submit("Casa"));
    await act(() => result.current.submit("Casa"));

    expect(calls[1]!.key).not.toBe(calls[0]!.key);
  });

  it("409 idempotency-request-in-progress: no reintenta solo y conserva la clave", async () => {
    const { calls } = sequenceFetch(
      () => problem(409, PROBLEM_TYPES.idempotencyRequestInProgress),
      () => json(PANTRY, 201),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreatePantryForm(), { wrapper });

    let error: unknown;
    await act(async () => {
      error = await result.current.submit("Casa");
    });
    expect(isIdempotencyInProgressError(error)).toBe(true);
    expect(calls).toHaveLength(1);

    await act(() => result.current.submit("Casa"));
    expect(calls[1]!.key).toBe(calls[0]!.key);
  });
});

describe("la cabecera Idempotency-Key llega al fetch del BFF", () => {
  it("unirse a un hogar", async () => {
    const { calls } = sequenceFetch(() => json(PANTRY));
    const { wrapper } = setup();
    const { result } = renderHook(() => useJoinPantryMutation(), { wrapper });
    await act(() => result.current.mutateAsync({ input: { invite_code: "ABC123" }, idempotencyKey: "join-key-0001" }));
    expect(calls).toEqual([{ path: "/api/bff/pantries/join", key: "join-key-0001", body: { invite_code: "ABC123" } }]);
  });

  it("crear ubicación (y la añade a la caché de ubicaciones)", async () => {
    const location = { id: crypto.randomUUID(), pantry_id: IDS.pantry, name: "Alacena" } as unknown as LocationResponse;
    const { calls } = sequenceFetch(
      () => json(location, 201),
      () => json([location]),
    );
    const { wrapper, queryClient } = setup();
    queryClient.setQueryData<LocationResponse[]>(pantryKeys.locations(IDS.pantry), []);
    const { result } = renderHook(() => useCreateLocationMutation(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ pantryId: IDS.pantry, input: { name: "Alacena" }, idempotencyKey: "loc-key-0001" }),
    );
    expect(calls[0]).toEqual({
      path: `/api/bff/pantries/${IDS.pantry}/locations`,
      key: "loc-key-0001",
      body: { name: "Alacena" },
    });
    await waitFor(() =>
      expect(queryClient.getQueryData<LocationResponse[]>(pantryKeys.locations(IDS.pantry))).toEqual([location]),
    );
  });

  it("crear producto", async () => {
    const input = {
      category_id: crypto.randomUUID(),
      name: "Leche",
      base_unit_code: "l" as const,
      estimated_shelf_life_days: 7,
    };
    const { calls } = sequenceFetch(() => json({ id: crypto.randomUUID(), ...input }, 201));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCreateProductMutation(), { wrapper });
    await act(() => result.current.mutateAsync({ input, idempotencyKey: "prod-key-0001" }));
    expect(calls).toEqual([{ path: "/api/bff/products", key: "prod-key-0001", body: input }]);
  });
});

describe("PantryOnboarding", () => {
  it("muestra un aviso comprensible ante 409 idempotency-request-in-progress y reutiliza la clave", async () => {
    const { calls } = sequenceFetch(
      () => problem(409, PROBLEM_TYPES.idempotencyRequestInProgress),
      () => problem(409, PROBLEM_TYPES.idempotencyRequestInProgress),
    );
    const { wrapper } = setup();
    render(<PantryOnboarding />, { wrapper });

    fireEvent.change(screen.getByLabelText(/Nombre del hogar/), { target: { value: "Casa" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear hogar" }));
    expect(await screen.findByText(/aún se está procesando/)).toBeTruthy();
    expect(calls).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Crear hogar" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.key).toBe(calls[0]!.key);
  });
});
