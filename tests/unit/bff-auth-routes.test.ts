// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCookieJarState,
  nextHeadersMock,
} from "./helpers/next-headers-mock";

const jar = vi.hoisted(() => {
  // vi.hoisted se ejecuta antes de los imports: se replica la fábrica en línea.
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

const { POST: login } = await import("@/app/api/bff/auth/login/route");
const { POST: register } = await import("@/app/api/bff/auth/register/route");
const { POST: logout } = await import("@/app/api/bff/auth/logout/route");
const { POST: refreshPost, GET: refreshGet } = await import("@/app/api/bff/auth/refresh/route");

const APP = "http://localhost:3000";
const ACCESS = "despensa_access_token";
const REFRESH = "despensa_refresh_token";

const user = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "ana@example.com",
  full_name: "Ana",
  timezone: "UTC",
  alert_days_before: 3,
  created_at: "2026-11-26T00:00:00Z",
};

let tokenSeq = 0;
function newTokens() {
  tokenSeq += 1;
  return {
    access_token: `at-secret-${tokenSeq}`,
    refresh_token: `rt-secret-${tokenSeq}`,
    token_type: "bearer",
    expires_in: 900,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Handler = (url: string, body: unknown) => Response | Promise<Response>;
let routes: Record<string, Handler>;
const fetchMock = vi.fn(async (input: Request | string | URL) => {
  const request = input instanceof Request ? input : new Request(String(input));
  const path = new URL(request.url).pathname;
  const text = await request.clone().text();
  const handler = routes[`${request.method} ${path}`];
  if (!handler) throw new Error(`fetch inesperado: ${request.method} ${path}`);
  return handler(request.url, text ? JSON.parse(text) : undefined);
});

function calls(method: string, path: string) {
  return fetchMock.mock.calls.filter(([input]) => {
    const request = input as Request;
    return request.method === method && new URL(request.url).pathname === path;
  });
}

function req(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  const { method = "POST", headers = {}, body } = init;
  return new NextRequest(`${APP}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const sameOriginJson = { Origin: APP, "Content-Type": "application/json" };
const credentials = { email: "ana@example.com", password: "supersecreta" };

beforeEach(() => {
  jar.reset();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  delete process.env.APP_ORIGIN;
  routes = {
    "POST /api/v1/auth/login": () => json(newTokens()),
    "POST /api/v1/auth/register": () => json(user, 201),
    "POST /api/v1/auth/logout": () => new Response(null, { status: 204 }),
    "POST /api/v1/auth/refresh": () => json(newTokens()),
    "GET /api/v1/users/me": () => json(user),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.APP_ORIGIN;
});

describe("POST /api/bff/auth/login", () => {
  it("responde { user } sin tokens y emite cookies HttpOnly; SameSite=lax; Path=/", async () => {
    const response = await login(req("/api/bff/auth/login", { headers: sameOriginJson, body: credentials }));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ user });
    expect(text).not.toMatch(/secret|access_token|refresh_token/);

    const names = jar.sets.map((s) => s.name).sort();
    expect(names).toEqual([ACCESS, REFRESH]);
    for (const cookie of jar.sets) {
      expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
      expect(cookie.options.maxAge).toBeGreaterThan(0);
    }
  });

  it("403 forbidden-origin con un Origin ajeno (sin llamar al backend)", async () => {
    const response = await login(
      req("/api/bff/auth/login", {
        headers: { ...sameOriginJson, Origin: "https://evil.com" },
        body: credentials,
      }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect((await response.json()).type).toMatch(/forbidden-origin$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("403 sin Origin cuando Sec-Fetch-Site es cross-site; acepta same-origin", async () => {
    const crossSite = await login(
      req("/api/bff/auth/login", {
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
        body: credentials,
      }),
    );
    expect(crossSite.status).toBe(403);

    const sameSite = await login(
      req("/api/bff/auth/login", {
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" },
        body: credentials,
      }),
    );
    expect(sameSite.status).toBe(403);

    const sameOrigin = await login(
      req("/api/bff/auth/login", {
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
        body: credentials,
      }),
    );
    expect(sameOrigin.status).toBe(200);
  });

  it("415 unsupported-media-type sin Content-Type JSON", async () => {
    const response = await login(
      req("/api/bff/auth/login", {
        headers: { Origin: APP, "Content-Type": "text/plain" },
        body: JSON.stringify(credentials),
      }),
    );
    expect(response.status).toBe(415);
    expect((await response.json()).type).toMatch(/unsupported-media-type$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("compara contra APP_ORIGIN e ignora X-Forwarded-Host", async () => {
    process.env.APP_ORIGIN = "https://despensa.app";
    const spoofed = await login(
      req("/api/bff/auth/login", {
        headers: {
          ...sameOriginJson,
          Origin: "https://evil.com",
          "X-Forwarded-Host": "evil.com",
          Host: "evil.com",
        },
        body: credentials,
      }),
    );
    expect(spoofed.status).toBe(403);

    const localOrigin = await login(
      req("/api/bff/auth/login", { headers: sameOriginJson, body: credentials }),
    );
    expect(localOrigin.status).toBe(403);

    const configured = await login(
      req("/api/bff/auth/login", {
        headers: { ...sameOriginJson, Origin: "https://despensa.app" },
        body: credentials,
      }),
    );
    expect(configured.status).toBe(200);
  });

  it("sin APP_ORIGIN, X-Forwarded-Host no amplía los orígenes aceptados", async () => {
    const response = await login(
      req("/api/bff/auth/login", {
        headers: { ...sameOriginJson, Origin: "https://evil.com", "X-Forwarded-Host": "evil.com" },
        body: credentials,
      }),
    );
    expect(response.status).toBe(403);
  });

  it("revoca el refresh_token previo (best effort) antes de sobrescribir la sesión", async () => {
    jar.reset({ [REFRESH]: "rt-previo" });
    const response = await login(req("/api/bff/auth/login", { headers: sameOriginJson, body: credentials }));
    expect(response.status).toBe(200);
    const logoutCalls = calls("POST", "/api/v1/auth/logout");
    expect(logoutCalls).toHaveLength(1);
    expect(await (logoutCalls[0]![0] as Request).clone().json()).toEqual({ refresh_token: "rt-previo" });
    expect(jar.values.get(REFRESH)).toMatch(/^rt-secret-/);
  });

  it("si la revocación previa falla, el login sigue funcionando", async () => {
    jar.reset({ [REFRESH]: "rt-previo-2" });
    routes["POST /api/v1/auth/logout"] = () => {
      throw new TypeError("network down");
    };
    const response = await login(req("/api/bff/auth/login", { headers: sameOriginJson, body: credentials }));
    expect(response.status).toBe(200);
  });

  it("preserva el problem+json del backend (invalid-credentials)", async () => {
    routes["POST /api/v1/auth/login"] = () =>
      new Response(
        JSON.stringify({
          type: "https://despensa.api/errors/invalid-credentials",
          title: "Invalid Credentials",
          status: 401,
          detail: "Correo o contraseña incorrectos.",
          correlation_id: "corr-backend",
        }),
        { status: 401, headers: { "Content-Type": "application/problem+json" } },
      );
    const response = await login(req("/api/bff/auth/login", { headers: sameOriginJson, body: credentials }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.type).toBe("https://despensa.api/errors/invalid-credentials");
    expect(body.correlation_id).toBe("corr-backend");
    expect(jar.sets).toHaveLength(0);
  });
});

describe("POST /api/bff/auth/register", () => {
  const payload = { full_name: "Ana", email: "ana@example.com", password: "supersecreta" };

  it("201 { user, authenticated } sin tokens en el body", async () => {
    const response = await register(req("/api/bff/auth/register", { headers: sameOriginJson, body: payload }));
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ user, authenticated: true });
    expect(text).not.toMatch(/secret|access_token|refresh_token/);
    expect(jar.sets.every((s) => s.options.httpOnly === true && s.options.sameSite === "lax")).toBe(true);
  });

  it("415 con text/plain y 403 con Origin ajeno", async () => {
    const textPlain = await register(
      req("/api/bff/auth/register", {
        headers: { Origin: APP, "Content-Type": "text/plain" },
        body: JSON.stringify(payload),
      }),
    );
    expect(textPlain.status).toBe(415);
    const foreign = await register(
      req("/api/bff/auth/register", {
        headers: { ...sameOriginJson, Origin: "https://evil.com" },
        body: payload,
      }),
    );
    expect(foreign.status).toBe(403);
  });
});

describe("POST /api/bff/auth/logout", () => {
  it("415 sin Content-Type JSON (aunque no tenga body)", async () => {
    jar.reset({ [REFRESH]: "rt-logout-0" });
    const response = await logout(req("/api/bff/auth/logout", { headers: { Origin: APP } }));
    expect(response.status).toBe(415);
    expect(jar.values.get(REFRESH)).toBe("rt-logout-0");
  });

  it("204, revoca en backend y limpia cookies", async () => {
    jar.reset({ [ACCESS]: "at-x", [REFRESH]: "rt-logout-1" });
    const response = await logout(req("/api/bff/auth/logout", { headers: sameOriginJson }));
    expect(response.status).toBe(204);
    expect(calls("POST", "/api/v1/auth/logout")).toHaveLength(1);
    expect(jar.values.size).toBe(0);
    expect(jar.sets.every((s) => s.options.maxAge === 0)).toBe(true);
  });

  it("403 sin Origin con Sec-Fetch-Site cross-site", async () => {
    jar.reset({ [REFRESH]: "rt-logout-2" });
    const response = await logout(
      req("/api/bff/auth/logout", {
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
    expect(jar.values.get(REFRESH)).toBe("rt-logout-2");
  });
});

describe("/api/bff/auth/refresh", () => {
  it("POST: 415 sin JSON, 204 con JSON y cookies rotadas", async () => {
    jar.reset({ [REFRESH]: "rt-post-1" });
    const noJson = await refreshPost(req("/api/bff/auth/refresh", { headers: { Origin: APP } }));
    expect(noJson.status).toBe(415);

    const ok = await refreshPost(req("/api/bff/auth/refresh", { headers: sameOriginJson }));
    expect(ok.status).toBe(204);
    expect(jar.values.get(REFRESH)).toMatch(/^rt-secret-/);
  });

  it("GET cross-site: 303 a /login sin rotar ni limpiar la sesión", async () => {
    jar.reset({ [REFRESH]: "rt-get-1" });
    const response = await refreshGet(
      req("/api/bff/auth/refresh?next=%2Fdespensa", {
        method: "GET",
        headers: { "Sec-Fetch-Site": "cross-site" },
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/login?next=%2Fdespensa`);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jar.sets).toHaveLength(0);
  });

  it("GET con backend caído: 303 a /offline conservando la sesión", async () => {
    jar.reset({ [REFRESH]: "rt-get-2" });
    routes["POST /api/v1/auth/refresh"] = () => {
      throw new TypeError("ECONNREFUSED");
    };
    const response = await refreshGet(req("/api/bff/auth/refresh?next=%2F", { method: "GET" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/offline`);
    expect(jar.sets).toHaveLength(0);
  });

  it("GET con backend 5xx: 303 a /offline", async () => {
    jar.reset({ [REFRESH]: "rt-get-3" });
    routes["POST /api/v1/auth/refresh"] = () => new Response("boom", { status: 502 });
    const response = await refreshGet(req("/api/bff/auth/refresh", { method: "GET" }));
    expect(response.headers.get("location")).toBe(`${APP}/offline`);
  });

  it("GET con refresh rechazado: limpia cookies y 303 a /login?next= (sin open redirect)", async () => {
    jar.reset({ [REFRESH]: "rt-get-4" });
    routes["POST /api/v1/auth/refresh"] = () =>
      new Response(
        JSON.stringify({
          type: "https://despensa.api/errors/invalid-token",
          title: "Invalid",
          status: 401,
        }),
        { status: 401, headers: { "Content-Type": "application/problem+json" } },
      );
    const response = await refreshGet(
      req("/api/bff/auth/refresh?next=https%3A%2F%2Fevil.com", { method: "GET" }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/login`);
    expect(jar.values.size).toBe(0);
  });

  it("GET correcto: rota y redirige a next", async () => {
    jar.reset({ [REFRESH]: "rt-get-5" });
    const response = await refreshGet(
      req("/api/bff/auth/refresh?next=%2Fdespensa%3Fq%3D1", { method: "GET" }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/despensa?q=1`);
    expect(jar.values.get(ACCESS)).toMatch(/^at-secret-/);
  });
});
