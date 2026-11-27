import { afterEach, describe, expect, it, vi } from "vitest";
import { bffFetch, RATE_LIMIT_RETRY_CAP_SECONDS } from "@/lib/api/bff-fetch";
import { ProblemDetailError } from "@/lib/api/problem";
import { isTransientError } from "@/lib/offline/outbox";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bffFetch", () => {
  it("401 concurrentes comparten un único POST /api/bff/auth/refresh", async () => {
    let refreshed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/bff/auth/refresh") {
        expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
        await new Promise((resolve) => setTimeout(resolve, 10));
        refreshed = true;
        return new Response(null, { status: 204 });
      }
      return refreshed
        ? new Response(JSON.stringify({ ok: url }), { status: 200 })
        : new Response(JSON.stringify({ type: "x/invalid-token", title: "x", status: 401 }), {
            status: 401,
          });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([
      bffFetch("/api/bff/pantries"),
      bffFetch("/api/bff/notifications"),
      bffFetch("/api/bff/recipes/recommended"),
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/bff/auth/refresh");
    expect(refreshCalls).toHaveLength(1);
    // 3 originales + 1 refresh + 3 reintentos
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("si el refresh falla lanza el 401 original como ProblemDetailError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/bff/auth/refresh"
          ? new Response(null, { status: 401 })
          : new Response(
              JSON.stringify({ type: "https://despensa.api/errors/invalid-token", title: "x", status: 401 }),
              { status: 401 },
            ),
      ),
    );
    const error = await bffFetch("/api/bff/pantries").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemDetailError);
    expect((error as ProblemDetailError).errorType).toBe("invalid-token");
  });

  it("no intenta refrescar en rutas /api/bff/auth/*", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(bffFetch("/api/bff/auth/me")).rejects.toBeInstanceOf(ProblemDetailError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("envía Content-Type JSON en mutaciones sin body y X-Correlation-ID siempre", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await bffFetch("/api/bff/auth/logout", { method: "POST" });
    await bffFetch("/api/bff/auth/me");

    const postHeaders = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    expect(postHeaders.get("content-type")).toBe("application/json");
    expect(postHeaders.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
    const getHeaders = new Headers(fetchMock.mock.calls[1]![1]?.headers);
    expect(getHeaders.get("content-type")).toBeNull();
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe("same-origin");
  });

  it("errores de red se normalizan como 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(bffFetch("/api/bff/pantries")).rejects.toMatchObject({ status: 503 });
  });
});

const REFRESH = "/api/bff/auth/refresh";
const unauthorized = () =>
  new Response(
    JSON.stringify({ type: "https://despensa.api/errors/invalid-token", title: "x", status: 401 }),
    { status: 401 },
  );
const rateLimited = (retryAfter: string | null) =>
  new Response(
    JSON.stringify({
      type: "https://despensa.api/errors/rate-limit-exceeded",
      title: "Too Many Requests",
      status: 429,
      correlation_id: "cid-429",
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/problem+json",
        ...(retryAfter === null ? {} : { "Retry-After": retryAfter }),
      },
    },
  );

/**
 * Simula el BFF: los endpoints de datos dan 401 hasta que un refresh tiene
 * éxito; el refresh responde según `refreshResponses` (en orden).
 */
function stubBff(refreshResponses: (() => Response)[]) {
  let refreshed = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === REFRESH) {
      const next = refreshResponses.shift();
      if (!next) throw new Error("refresh inesperado");
      const response = next();
      if (response.ok) refreshed = true;
      return response;
    }
    return refreshed ? new Response(JSON.stringify({ ok: url }), { status: 200 }) : unauthorized();
  });
  vi.stubGlobal("fetch", fetchMock);
  const refreshCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === REFRESH).length;
  return { fetchMock, refreshCalls };
}

describe("bffFetch ante 429 del refresh (despensa-frontend#6)", () => {
  it("401 -> refresh 429 con Retry-After -> espera, reintenta el refresh y luego la petición original", async () => {
    vi.useFakeTimers();
    const { fetchMock, refreshCalls } = stubBff([
      () => rateLimited("2"),
      () => new Response(null, { status: 204 }),
    ]);

    const pending = bffFetch("/api/bff/pantries");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refreshCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    const response = await pending;
    expect(response.status).toBe(200);
    expect(refreshCalls()).toBe(2);
    // original 401 + refresh 429 + refresh 204 + reintento original
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("429 persistente: lanza el 429 con retry_after, no el 401", async () => {
    vi.useFakeTimers();
    const { refreshCalls } = stubBff([() => rateLimited("1"), () => rateLimited("30")]);

    const pending = bffFetch("/api/bff/pantries").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await pending;

    expect(error).toBeInstanceOf(ProblemDetailError);
    expect(error).toMatchObject({ status: 429, retry_after: 30 });
    expect((error as ProblemDetailError).errorType).toBe("rate-limit-exceeded");
    expect(refreshCalls()).toBe(2);
    // La outbox lo trata como transitorio (pausa y reintenta), no como conflicto.
    expect(isTransientError(error)).toBe(true);
  });

  it("Retry-After mayor que el tope: no espera ni reintenta y lanza el 429", async () => {
    vi.useFakeTimers();
    const { fetchMock, refreshCalls } = stubBff([() => rateLimited(String(RATE_LIMIT_RETRY_CAP_SECONDS + 55))]);

    // Sin avanzar timers: si esperase, la promesa nunca se resolvería.
    const error = await bffFetch("/api/bff/pantries").catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 429, retry_after: 60 });
    expect(refreshCalls()).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("401 concurrentes con refresh 429: comparten la espera y un único reintento del refresh", async () => {
    vi.useFakeTimers();
    const { refreshCalls } = stubBff([() => rateLimited("1"), () => new Response(null, { status: 204 })]);

    const pending = Promise.all([
      bffFetch("/api/bff/pantries"),
      bffFetch("/api/bff/notifications"),
      bffFetch("/api/bff/recipes/recommended"),
    ]);
    await vi.advanceTimersByTimeAsync(1_000);

    const results = await pending;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(refreshCalls()).toBe(2);
  });

  it("refresh con 5xx: lanza el error del refresh (no sesión caducada)", async () => {
    stubBff([() => new Response("boom", { status: 502 })]);
    await expect(bffFetch("/api/bff/pantries")).rejects.toMatchObject({ status: 502 });
  });

  it("refresh con 403: sesión caducada (se lanza el 401 original)", async () => {
    stubBff([() => new Response(null, { status: 403 })]);
    const error = await bffFetch("/api/bff/pantries").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
    expect((error as ProblemDetailError).errorType).toBe("invalid-token");
  });
});
