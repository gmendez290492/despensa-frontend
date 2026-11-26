import { afterEach, describe, expect, it, vi } from "vitest";
import { createRefreshMutex } from "@/lib/auth/refresh-mutex";
import { ProblemDetailError } from "@/lib/api/problem";

const tokens = (suffix: string) => ({
  access_token: `access-${suffix}`,
  refresh_token: `refresh-${suffix}`,
  token_type: "bearer" as const,
  expires_in: 900,
});

describe("createRefreshMutex", () => {
  it("comparte una sola ejecución entre llamadas concurrentes con el mismo token", async () => {
    const mutex = createRefreshMutex<ReturnType<typeof tokens>>();
    let resolve!: (value: ReturnType<typeof tokens>) => void;
    const task = vi.fn(
      () => new Promise<ReturnType<typeof tokens>>((r) => (resolve = r)),
    );

    const first = mutex.run("rt-1", task);
    const second = mutex.run("rt-1", task);
    expect(mutex.inFlightCount).toBe(1);

    resolve(tokens("2"));
    const [a, b] = await Promise.all([first, second]);

    expect(task).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(mutex.inFlightCount).toBe(0);
  });

  it("reutiliza el resultado dentro de la ventana de gracia y lo expira después", async () => {
    let now = 1_000;
    const mutex = createRefreshMutex<string>({ graceMs: 100, now: () => now });
    const task = vi.fn(async () => "nuevo-par");

    await mutex.run("rt-1", task);
    now += 50;
    await mutex.run("rt-1", task);
    expect(task).toHaveBeenCalledTimes(1);

    now += 100;
    await mutex.run("rt-1", task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("no cachea errores y libera el candado", async () => {
    const mutex = createRefreshMutex<string>();
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      Promise.all([mutex.run("rt-x", failing), mutex.run("rt-x", failing)]),
    ).rejects.toThrow("boom");
    expect(failing).toHaveBeenCalledTimes(1);
    expect(mutex.inFlightCount).toBe(0);

    const ok = vi.fn(async () => "ok");
    await expect(mutex.run("rt-x", ok)).resolves.toBe("ok");
  });

  it("serializa por clave: tokens distintos no se bloquean", async () => {
    const mutex = createRefreshMutex<string>();
    const task = vi.fn(async () => "x");
    await Promise.all([mutex.run("a", task), mutex.run("b", task)]);
    expect(task).toHaveBeenCalledTimes(2);
  });
});

describe("createRefreshMutex: desalojo por timer y hash de claves", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("graceMs por defecto es 5 s y el timer desaloja la entrada", async () => {
    vi.useFakeTimers();
    const mutex = createRefreshMutex<string>();
    const task = vi.fn(async () => "par");

    await mutex.run("rt-timer", task);
    expect(mutex.settledCount).toBe(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(mutex.settledCount).toBe(1);
    await mutex.run("rt-timer", task);
    expect(task).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mutex.settledCount).toBe(0);

    await mutex.run("rt-timer", task);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("el desalojo no depende de una nueva llamada (sin barrido perezoso)", async () => {
    vi.useFakeTimers();
    const mutex = createRefreshMutex<string>({ graceMs: 100 });
    await Promise.all(["a", "b", "c"].map((k) => mutex.run(k, async () => k)));
    expect(mutex.settledCount).toBe(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(mutex.settledCount).toBe(0);
  });

  it("forget cancela el timer y elimina la entrada", async () => {
    vi.useFakeTimers();
    const mutex = createRefreshMutex<string>();
    await mutex.run("rt-forget", async () => "x");
    mutex.forget("rt-forget");
    expect(mutex.settledCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("usa hashKey para derivar las claves", async () => {
    const hashKey = vi.fn((key: string) => `h(${key.length})`);
    const mutex = createRefreshMutex<string>({ hashKey });
    const task = vi.fn(async () => "x");
    // Misma longitud => misma clave hasheada => una sola ejecución.
    await Promise.all([mutex.run("aaaa", task), mutex.run("bbbb", task)]);
    expect(hashKey).toHaveBeenCalledWith("aaaa");
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("hashRefreshToken (servidor) es SHA-256 hex", async () => {
    const { hashRefreshToken } = await import("@/lib/auth/refresh");
    expect(hashRefreshToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("refreshTokens (contra FastAPI simulado)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dos refrescos concurrentes provocan un único POST /auth/refresh", async () => {
    const fetchMock = vi.fn(async (input: Request | string | URL) => {
      await new Promise((r) => setTimeout(r, 10));
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toMatch(/\/api\/v1\/auth\/refresh$/);
      return new Response(JSON.stringify(tokens("rotated")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { refreshTokens, forgetRefreshToken } = await import("@/lib/auth/refresh");
    const [a, b] = await Promise.all([
      refreshTokens("rt-concurrent", "corr-12345678"),
      refreshTokens("rt-concurrent", "corr-87654321"),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.refresh_token).toBe("refresh-rotated");
    expect(b).toEqual(a);

    const sent = fetchMock.mock.calls[0]![0] as Request;
    expect(sent.headers.get("x-correlation-id")).toBe("corr-12345678");
    expect(await sent.clone().json()).toEqual({ refresh_token: "rt-concurrent" });
    forgetRefreshToken("rt-concurrent");
  });

  it("normaliza el rechazo de FastAPI como ProblemDetailError invalid-token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: "https://despensa.api/errors/invalid-token",
              title: "Invalid or Expired Token",
              status: 401,
              detail: "Token revocado",
              correlation_id: "corr-backend-1",
            }),
            { status: 401, headers: { "Content-Type": "application/problem+json" } },
          ),
      ),
    );
    const { refreshTokens } = await import("@/lib/auth/refresh");
    const error = await refreshTokens("rt-revoked", "corr-12345678").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemDetailError);
    expect((error as ProblemDetailError).errorType).toBe("invalid-token");
    expect((error as ProblemDetailError).correlation_id).toBe("corr-backend-1");
  });
});
