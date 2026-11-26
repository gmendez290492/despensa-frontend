import { afterEach, describe, expect, it, vi } from "vitest";
import { bffFetch } from "@/lib/api/bff-fetch";
import { ProblemDetailError } from "@/lib/api/problem";

afterEach(() => {
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
