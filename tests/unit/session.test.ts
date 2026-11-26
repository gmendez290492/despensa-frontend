// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import { createCookieJarState, nextHeadersMock } from "./helpers/next-headers-mock";

const jar = vi.hoisted(() => {
  const state = {
    values: new Map<string, string>(),
    sets: [] as { name: string; value: string; options: Record<string, unknown> }[],
    requestHeaders: new Headers(),
    reset(initial: Record<string, string> = {}) {
      state.values = new Map(Object.entries(initial));
      state.sets = [];
      state.requestHeaders = new Headers();
    },
  };
  return state;
});
vi.mock("next/headers", () => nextHeadersMock(jar as ReturnType<typeof createCookieJarState>));

const { refreshSession, authenticatedRequest } = await import("@/lib/auth/session");

const ACCESS = "despensa_access_token";
const REFRESH = "despensa_refresh_token";
const CORR = "corr-session-test";

let refreshResponse: () => Response;
const fetchMock = vi.fn(async () => refreshResponse());

const problem = (status: number, slug: string) =>
  new Response(
    JSON.stringify({ type: problemTypeUri(slug), title: "x", status, detail: slug }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );

let seq = 0;
const okTokens = () => {
  seq += 1;
  return new Response(
    JSON.stringify({
      access_token: `at-new-${seq}`,
      refresh_token: `rt-new-${seq}`,
      token_type: "bearer",
      expires_in: 900,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  refreshResponse = okTokens;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("refreshSession", () => {
  it("rota y persiste el nuevo par en cookies", async () => {
    jar.reset({ [REFRESH]: "rt-ok-1" });
    const tokens = await refreshSession("rt-ok-1", CORR);
    expect(tokens.refresh_token).toMatch(/^rt-new-/);
    expect(jar.values.get(REFRESH)).toBe(tokens.refresh_token);
    expect(jar.values.get(ACCESS)).toBe(tokens.access_token);
  });

  it("si FastAPI rechaza el refresh (401) limpia cookies y relanza 401", async () => {
    jar.reset({ [ACCESS]: "at-old", [REFRESH]: "rt-rejected-1" });
    refreshResponse = () => problem(401, "invalid-token");
    const error = await refreshSession("rt-rejected-1", CORR).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProblemDetailError);
    expect((error as ProblemDetailError).status).toBe(401);
    expect(jar.values.size).toBe(0);
    expect(jar.sets.every((s) => s.options.maxAge === 0)).toBe(true);
  });

  it("un 422 (token malformado) también limpia y se normaliza a 401", async () => {
    jar.reset({ [REFRESH]: "rt-rejected-2" });
    refreshResponse = () =>
      new Response(JSON.stringify({ detail: [{ loc: ["body"], msg: "bad" }] }), { status: 422 });
    const error = (await refreshSession("rt-rejected-2", CORR).catch((e: unknown) => e)) as ProblemDetailError;
    expect(error.status).toBe(401);
    expect(jar.values.size).toBe(0);
  });

  it.each([
    ["429 rate-limit", () => problem(429, "rate-limit-exceeded"), 429],
    ["503 backend", () => new Response("down", { status: 503 }), 503],
  ])("%s NO destruye la sesión", async (_label, response, status) => {
    jar.reset({ [ACCESS]: "at-keep", [REFRESH]: `rt-keep-${status}` });
    refreshResponse = response;
    const error = (await refreshSession(`rt-keep-${status}`, CORR).catch((e: unknown) => e)) as ProblemDetailError;
    expect(error.status).toBe(status);
    expect(jar.sets).toHaveLength(0);
    expect(jar.values.get(REFRESH)).toBe(`rt-keep-${status}`);
  });

  it("error de red NO destruye la sesión", async () => {
    jar.reset({ [REFRESH]: "rt-keep-net" });
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("ECONNREFUSED");
    });
    const error = (await refreshSession("rt-keep-net", CORR).catch((e: unknown) => e)) as ProblemDetailError;
    expect(error.status).toBe(503);
    expect(jar.sets).toHaveLength(0);
  });
});

describe("authenticatedRequest", () => {
  const invalidToken = () =>
    new ProblemDetailError({
      type: problemTypeUri("invalid-token"),
      title: "Invalid",
      status: 401,
    });

  it("ante 401 invalid-token refresca y reintenta UNA sola vez", async () => {
    jar.reset({ [ACCESS]: "at-stale", [REFRESH]: "rt-retry-1" });
    const call = vi.fn(async () => {
      throw invalidToken();
    });
    const error = await authenticatedRequest(call, { correlationId: CORR, allowRefresh: true }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProblemDetailError);
    expect(call).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("el reintento usa el access token rotado", async () => {
    jar.reset({ [ACCESS]: "at-stale", [REFRESH]: "rt-retry-2" });
    const seen: (string | null)[] = [];
    const call = vi.fn(async (client: { GET: (path: "/api/v1/users/me") => Promise<unknown> }) => {
      void client;
      if (seen.length === 0) {
        seen.push("first");
        throw invalidToken();
      }
      seen.push("second");
      return "ok";
    });
    await expect(
      authenticatedRequest(call, { correlationId: CORR, allowRefresh: true }),
    ).resolves.toBe("ok");
    expect(jar.values.get(ACCESS)).toMatch(/^at-new-/);
  });

  it("con allowRefresh=false (RSC) no refresca ni escribe cookies", async () => {
    jar.reset({ [ACCESS]: "at-stale", [REFRESH]: "rt-rsc" });
    const call = vi.fn(async () => {
      throw invalidToken();
    });
    await expect(
      authenticatedRequest(call, { correlationId: CORR, allowRefresh: false }),
    ).rejects.toBeInstanceOf(ProblemDetailError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jar.sets).toHaveLength(0);
  });

  it("no reintenta errores que no son invalid-token", async () => {
    jar.reset({ [ACCESS]: "at-ok", [REFRESH]: "rt-403" });
    const call = vi.fn(async () => {
      throw new ProblemDetailError({ type: problemTypeUri("pantry-access-denied"), title: "x", status: 403 });
    });
    await expect(
      authenticatedRequest(call, { correlationId: CORR, allowRefresh: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
