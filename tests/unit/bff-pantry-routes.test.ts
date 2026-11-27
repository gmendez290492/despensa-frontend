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

const pantriesRoute = await import("@/app/api/bff/pantries/route");
const { POST: joinPantry } = await import("@/app/api/bff/pantries/join/route");
const locationsRoute = await import("@/app/api/bff/pantries/[pantryId]/locations/route");
const batchesRoute = await import("@/app/api/bff/pantries/[pantryId]/batches/route");
const { POST: consume } = await import("@/app/api/bff/pantries/[pantryId]/consume/route");
const productsRoute = await import("@/app/api/bff/products/route");
const { GET: notifications } = await import("@/app/api/bff/notifications/route");

const APP = "http://localhost:3000";
const ACCESS = "despensa_access_token";
const REFRESH = "despensa_refresh_token";
const ERR = "https://despensa.api/errors/";

const PANTRY_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID = "33333333-3333-4333-8333-333333333333";
const LOCATION_ID = "44444444-4444-4444-8444-444444444444";

const pantry = {
  id: PANTRY_ID,
  name: "Casa",
  invite_code: "DESP-ABCD1234",
  created_at: "2026-11-26T00:00:00Z",
};

const consumeResult = {
  product_id: PRODUCT_ID,
  requested_quantity: "1.5",
  consumed_quantity: "1.5",
  remaining_stock: "0.5",
  batches_affected: [],
};

let seq = 0;
function newTokens() {
  seq += 1;
  return {
    access_token: `at-new-${seq}`,
    refresh_token: `rt-new-${seq}`,
    token_type: "bearer",
    expires_in: 900,
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const problem = (slug: string, status: number, correlationId = "corr-backend-1") =>
  new Response(
    JSON.stringify({
      type: `${ERR}${slug}`,
      title: slug,
      status,
      detail: `detalle ${slug}`,
      correlation_id: correlationId,
    }),
    {
      status,
      headers: { "Content-Type": "application/problem+json", "X-Correlation-ID": correlationId },
    },
  );

interface Seen {
  url: URL;
  headers: Headers;
  body: unknown;
}
type Handler = (seen: Seen) => Response | Promise<Response>;
let routes: Record<string, Handler>;
const fetchMock = vi.fn(async (input: Request | string | URL) => {
  const request = input instanceof Request ? input : new Request(String(input));
  const url = new URL(request.url);
  const text = await request.clone().text();
  const handler = routes[`${request.method} ${url.pathname}`];
  if (!handler) throw new Error(`fetch inesperado: ${request.method} ${url.pathname}`);
  return handler({ url, headers: request.headers, body: text ? JSON.parse(text) : undefined });
});

function backendCalls(method?: string, path?: string): Request[] {
  return fetchMock.mock.calls
    .map(([input]) => input as Request)
    .filter(
      (request) =>
        (!method || request.method === method) &&
        (!path || new URL(request.url).pathname === path),
    );
}

function req(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  const { method = "GET", headers = {}, body } = init;
  return new NextRequest(`${APP}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const ctx = (pantryId: string) => ({ params: Promise.resolve({ pantryId }) });
const sameOriginJson = { Origin: APP, "Content-Type": "application/json" };
const consumeBody = { product_id: PRODUCT_ID, quantity: "1,50" };

beforeEach(() => {
  seq += 100;
  // Refresh token único por test: el mutex del proceso no reutiliza pares de otro test.
  jar.reset({ [ACCESS]: "at-valid", [REFRESH]: `rt-old-${seq}` });
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.APP_ORIGIN;
  routes = {
    "GET /api/v1/pantries": () => json([pantry]),
    "POST /api/v1/pantries": ({ body }) => json({ ...pantry, ...(body as object) }, 201),
    "POST /api/v1/pantries/join": () => json(pantry),
    "POST /api/v1/auth/refresh": () => json(newTokens()),
    [`GET /api/v1/pantries/${PANTRY_ID}/locations`]: () => json([]),
    [`GET /api/v1/pantries/${PANTRY_ID}/batches`]: () => json([]),
    [`POST /api/v1/pantries/${PANTRY_ID}/consume`]: () => json(consumeResult),
    "GET /api/v1/products": () => json([]),
    "GET /api/v1/notifications": () => json({ items: [], total: 0, unread_count: 0 }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.APP_ORIGIN;
});

describe("GET/POST /api/bff/pantries", () => {
  it("GET lista los hogares con Bearer de la cookie y propaga X-Correlation-ID", async () => {
    const response = await pantriesRoute.GET(
      req("/api/bff/pantries", { headers: { "X-Correlation-ID": "corr-client-123" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([pantry]);
    expect(response.headers.get("X-Correlation-ID")).toBe("corr-client-123");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const [call] = backendCalls("GET", "/api/v1/pantries");
    expect(call?.headers.get("Authorization")).toBe("Bearer at-valid");
    expect(call?.headers.get("X-Correlation-ID")).toBe("corr-client-123");
  });

  it("POST crea el hogar (201) con el nombre recortado", async () => {
    const response = await pantriesRoute.POST(
      req("/api/bff/pantries", { method: "POST", headers: sameOriginJson, body: { name: "  Casa  " } }),
    );
    expect(response.status).toBe(201);
    const [call] = backendCalls("POST", "/api/v1/pantries");
    expect(await call?.clone().json()).toEqual({ name: "Casa" });
  });

  it("POST con cuerpo inválido → 400 sin llamar a FastAPI", async () => {
    const response = await pantriesRoute.POST(
      req("/api/bff/pantries", { method: "POST", headers: sameOriginJson, body: { name: "x" } }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sin cookies → 401 invalid-token sin llamar a FastAPI", async () => {
    jar.reset();
    const response = await pantriesRoute.GET(req("/api/bff/pantries"));
    expect(response.status).toBe(401);
    expect((await response.json()).type).toBe(`${ERR}invalid-token`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("join propaga 409 already-pantry-member", async () => {
    routes["POST /api/v1/pantries/join"] = () => problem("already-pantry-member", 409);
    const response = await joinPantry(
      req("/api/bff/pantries/join", {
        method: "POST",
        headers: sameOriginJson,
        body: { invite_code: "DESP-ABCD1234" },
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).type).toBe(`${ERR}already-pantry-member`);
  });
});

describe("validación de pantryId (UUID)", () => {
  it.each(["not-a-uuid", "..%2F..%2Fusers", "../../users", `${PANTRY_ID}/x`])(
    "%s → 400 invalid-request sin llamar a FastAPI",
    async (pantryId) => {
      const response = await batchesRoute.GET(
        req(`/api/bff/pantries/${encodeURIComponent(pantryId)}/batches`),
        ctx(pantryId),
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.type).toBe(`${ERR}invalid-request`);
      expect(body.correlation_id).toEqual(expect.any(String));
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("UUID inválido → 400 incluso sin access token (no se rota la sesión)", async () => {
    jar.reset({ [REFRESH]: `rt-only-${seq}` });
    const response = await locationsRoute.GET(req("/api/bff/pantries/x/locations"), ctx("x"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(jar.sets).toEqual([]);
  });

  it("UUID en mayúsculas se normaliza a minúsculas antes de llamar a FastAPI", async () => {
    const upper = PANTRY_ID.toUpperCase();
    const response = await locationsRoute.GET(req(`/api/bff/pantries/${upper}/locations`), ctx(upper));
    expect(response.status).toBe(200);
    expect(backendCalls("GET", `/api/v1/pantries/${PANTRY_ID}/locations`)).toHaveLength(1);
  });
});

describe("CSRF en mutaciones", () => {
  it("Origin ajeno → 403 forbidden-origin sin llamar a FastAPI", async () => {
    const response = await consume(
      req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
        method: "POST",
        headers: { ...sameOriginJson, Origin: "https://evil.example" },
        body: consumeBody,
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).type).toBe(`${ERR}forbidden-origin`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Sec-Fetch-Site cross-site sin Origin → 403", async () => {
    const response = await locationsRoute.POST(
      req(`/api/bff/pantries/${PANTRY_ID}/locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
        body: { name: "Nevera" },
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Content-Type text/plain → 415 sin llamar a FastAPI", async () => {
    const response = await batchesRoute.POST(
      req(`/api/bff/pantries/${PANTRY_ID}/batches`, {
        method: "POST",
        headers: { Origin: APP, "Content-Type": "text/plain" },
        body: "{}",
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(415);
    expect((await response.json()).type).toBe(`${ERR}unsupported-media-type`);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("errores de dominio propagados como problem+json", () => {
  it("403 pantry-access-denied (IDOR) pasa tal cual con el correlation id del backend", async () => {
    routes[`GET /api/v1/pantries/${PANTRY_ID}/batches`] = () =>
      problem("pantry-access-denied", 403, "corr-idor-9");
    const response = await batchesRoute.GET(
      req(`/api/bff/pantries/${PANTRY_ID}/batches`),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(response.headers.get("X-Correlation-ID")).toBe("corr-idor-9");
    const body = await response.json();
    expect(body).toMatchObject({
      type: `${ERR}pantry-access-denied`,
      status: 403,
      correlation_id: "corr-idor-9",
    });
    // 403 no es motivo de rotación de tokens.
    expect(backendCalls("POST", "/api/v1/auth/refresh")).toHaveLength(0);
  });

  it("400 insufficient-stock pasa tal cual", async () => {
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () =>
      problem("insufficient-stock", 400, "corr-stock-1");
    const response = await consume(
      req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
        method: "POST",
        headers: sameOriginJson,
        body: consumeBody,
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      type: `${ERR}insufficient-stock`,
      detail: "detalle insufficient-stock",
      correlation_id: "corr-stock-1",
    });
  });
});

describe("POST /api/bff/pantries/{id}/consume", () => {
  it("normaliza la cantidad a string decimal y reenvía Idempotency-Key", async () => {
    const response = await consume(
      req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
        method: "POST",
        headers: { ...sameOriginJson, "Idempotency-Key": "mut_0123456789abcdef" },
        body: consumeBody,
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(consumeResult);
    const [call] = backendCalls("POST", `/api/v1/pantries/${PANTRY_ID}/consume`);
    expect(call?.headers.get("Idempotency-Key")).toBe("mut_0123456789abcdef");
    expect(await call?.clone().json()).toEqual({ product_id: PRODUCT_ID, quantity: "1.5" });
  });

  it.each(["short", "a".repeat(129), "bad key with spaces", "keyéééééé"])(
    "Idempotency-Key inválido (%s) → 400 sin llamar a FastAPI",
    async (key) => {
      const headers = new Headers(sameOriginJson);
      // `Headers` rechaza bytes no ISO-8859-1; los casos usados son válidos para HTTP.
      headers.set("Idempotency-Key", key);
      const response = await consume(
        new NextRequest(`${APP}/api/bff/pantries/${PANTRY_ID}/consume`, {
          method: "POST",
          headers,
          body: JSON.stringify(consumeBody),
        }),
        ctx(PANTRY_ID),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).errors?.[0]?.loc).toEqual(["header", "Idempotency-Key"]);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("sin Idempotency-Key no se envía la cabecera", async () => {
    await consume(
      req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
        method: "POST",
        headers: sameOriginJson,
        body: consumeBody,
      }),
      ctx(PANTRY_ID),
    );
    const [call] = backendCalls("POST", `/api/v1/pantries/${PANTRY_ID}/consume`);
    expect(call?.headers.has("Idempotency-Key")).toBe(false);
  });

  it("401 invalid-token → refresh (una vez) → reintento con el mismo cuerpo y la misma clave", async () => {
    let attempts = 0;
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () => {
      attempts += 1;
      return attempts === 1 ? problem("invalid-token", 401) : json(consumeResult);
    };
    const response = await consume(
      req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
        method: "POST",
        headers: { ...sameOriginJson, "Idempotency-Key": "mut_retry_000001" },
        body: consumeBody,
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(200);
    expect(backendCalls("POST", "/api/v1/auth/refresh")).toHaveLength(1);

    const calls = backendCalls("POST", `/api/v1/pantries/${PANTRY_ID}/consume`);
    expect(calls).toHaveLength(2);
    const [first, second] = calls;
    expect(await first?.clone().json()).toEqual(await second?.clone().json());
    expect(second?.headers.get("Idempotency-Key")).toBe("mut_retry_000001");
    expect(first?.headers.get("Authorization")).toBe("Bearer at-valid");
    expect(second?.headers.get("Authorization")).toMatch(/^Bearer at-new-\d+$/);

    // Nuevo par persistido solo en cookies HttpOnly, nunca en el cuerpo.
    const cookieNames = jar.sets.map((s) => s.name);
    expect(cookieNames).toEqual(expect.arrayContaining([ACCESS, REFRESH]));
    for (const cookie of jar.sets) expect(cookie.options).toMatchObject({ httpOnly: true });
    expect(JSON.stringify(await response.json())).not.toMatch(/at-new|rt-new/);
  });

  it("401 persistente tras el refresh → 401 sin bucle", async () => {
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () => problem("invalid-token", 401);
    const response = await consume(
      req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
        method: "POST",
        headers: sameOriginJson,
        body: consumeBody,
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(401);
    expect(backendCalls("POST", "/api/v1/auth/refresh")).toHaveLength(1);
    expect(backendCalls("POST", `/api/v1/pantries/${PANTRY_ID}/consume`)).toHaveLength(2);
  });
});

describe("Idempotent-Replayed (FastAPI → BFF → navegador)", () => {
  const consumeReq = (key = "mut_replay_000001") =>
    req(`/api/bff/pantries/${PANTRY_ID}/consume`, {
      method: "POST",
      headers: { ...sameOriginJson, "Idempotency-Key": key },
      body: consumeBody,
    });

  it("consume: reenvía Idempotent-Replayed: true de una respuesta 200 repetida", async () => {
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () =>
      json(consumeResult, 200, { "Idempotent-Replayed": "true" });
    const response = await consume(consumeReq(), ctx(PANTRY_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    expect(await response.json()).toEqual(consumeResult);
  });

  it("consume: un 4xx repetido también lleva Idempotent-Replayed (resultado definitivo)", async () => {
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () => {
      const response = problem("insufficient-stock", 400);
      response.headers.set("Idempotent-Replayed", "true");
      return response;
    };
    const response = await consume(consumeReq(), ctx(PANTRY_ID));
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/problem+json");
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("consume: sin la cabecera en FastAPI no se añade", async () => {
    const response = await consume(consumeReq(), ctx(PANTRY_ID));
    expect(response.headers.has("Idempotent-Replayed")).toBe(false);
  });

  it("consume: un valor no booleano de FastAPI no se reenvía", async () => {
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () =>
      json(consumeResult, 200, { "Idempotent-Replayed": "yes; injected" });
    const response = await consume(consumeReq(), ctx(PANTRY_ID));
    expect(response.headers.has("Idempotent-Replayed")).toBe(false);
  });

  it("consume: tras 401 + refresh manda la cabecera de la última respuesta", async () => {
    let attempts = 0;
    routes[`POST /api/v1/pantries/${PANTRY_ID}/consume`] = () => {
      attempts += 1;
      return attempts === 1
        ? problem("invalid-token", 401)
        : json(consumeResult, 200, { "Idempotent-Replayed": "TRUE" });
    };
    const response = await consume(consumeReq(), ctx(PANTRY_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("batches: reenvía Idempotent-Replayed en el 201 repetido", async () => {
    const batch = { id: LOCATION_ID };
    routes[`POST /api/v1/pantries/${PANTRY_ID}/batches`] = () =>
      json(batch, 201, { "Idempotent-Replayed": "true" });
    const response = await batchesRoute.POST(
      req(`/api/bff/pantries/${PANTRY_ID}/batches`, {
        method: "POST",
        headers: { ...sameOriginJson, "Idempotency-Key": "mut_batch_000001" },
        body: {
          product_id: PRODUCT_ID,
          location_id: LOCATION_ID,
          unit_code: "l",
          quantity: "1",
          expiration_date: "2026-12-31",
        },
      }),
      ctx(PANTRY_ID),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    const [call] = backendCalls("POST", `/api/v1/pantries/${PANTRY_ID}/batches`);
    expect(call?.headers.get("Idempotency-Key")).toBe("mut_batch_000001");
  });

  it("una ruta no idempotente (GET) nunca reenvía la cabecera", async () => {
    routes["GET /api/v1/pantries"] = () => json([pantry], 200, { "Idempotent-Replayed": "true" });
    const response = await pantriesRoute.GET(req("/api/bff/pantries"));
    expect(response.headers.has("Idempotent-Replayed")).toBe(false);
  });
});

describe("Idempotency-Key opcional en POST /pantries, /pantries/join, /locations y /products", () => {
  const KEY = "mut_create_00000001";
  const cases = [
    {
      name: "POST /api/bff/pantries",
      backend: "/api/v1/pantries",
      status: 201,
      send: (headers: Record<string, string>) =>
        pantriesRoute.POST(req("/api/bff/pantries", { method: "POST", headers, body: { name: "Casa" } })),
    },
    {
      name: "POST /api/bff/pantries/join",
      backend: "/api/v1/pantries/join",
      status: 200,
      send: (headers: Record<string, string>) =>
        joinPantry(req("/api/bff/pantries/join", { method: "POST", headers, body: { invite_code: "DESP-ABCD1234" } })),
    },
    {
      name: "POST /api/bff/pantries/{id}/locations",
      backend: `/api/v1/pantries/${PANTRY_ID}/locations`,
      status: 201,
      send: (headers: Record<string, string>) =>
        locationsRoute.POST(
          req(`/api/bff/pantries/${PANTRY_ID}/locations`, { method: "POST", headers, body: { name: "Alacena" } }),
          ctx(PANTRY_ID),
        ),
    },
    {
      name: "POST /api/bff/products",
      backend: "/api/v1/products",
      status: 201,
      send: (headers: Record<string, string>) =>
        productsRoute.POST(
          req("/api/bff/products", {
            method: "POST",
            headers,
            body: { category_id: LOCATION_ID, name: "Leche", base_unit_code: "l" },
          }),
        ),
    },
  ];

  beforeEach(() => {
    routes[`POST /api/v1/pantries/${PANTRY_ID}/locations`] = () => json({ id: LOCATION_ID, name: "Alacena" }, 201);
    routes["POST /api/v1/products"] = () => json({ id: PRODUCT_ID, name: "Leche" }, 201);
  });

  it.each(cases)("$name reenvía Idempotency-Key y devuelve Idempotent-Replayed", async ({ backend, status, send }) => {
    const original = routes[`POST ${backend}`]!;
    routes[`POST ${backend}`] = async (seen) => {
      const response = await original(seen);
      response.headers.set("Idempotent-Replayed", "true");
      return response;
    };
    const response = await send({ ...sameOriginJson, "Idempotency-Key": KEY });
    expect(response.status).toBe(status);
    expect(response.headers.get("Idempotent-Replayed")).toBe("true");
    const [call] = backendCalls("POST", backend);
    expect(call?.headers.get("Idempotency-Key")).toBe(KEY);
  });

  it.each(cases)("$name sin Idempotency-Key no envía la cabecera (sigue siendo opcional)", async ({ backend, status, send }) => {
    const response = await send(sameOriginJson);
    expect(response.status).toBe(status);
    const [call] = backendCalls("POST", backend);
    expect(call?.headers.has("Idempotency-Key")).toBe(false);
  });

  it.each(cases)("$name con Idempotency-Key inválido → 400 sin llamar a FastAPI", async ({ send }) => {
    const response = await send({ ...sameOriginJson, "Idempotency-Key": "bad key" });
    expect(response.status).toBe(400);
    expect((await response.json()).errors?.[0]?.loc).toEqual(["header", "Idempotency-Key"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/bff/notifications", () => {
  it("limit=100000 se acota a 100 y el resto de parámetros se conserva", async () => {
    await notifications(
      req("/api/bff/notifications?limit=100000&offset=40&unread_only=true&evil=1"),
    );
    const [call] = backendCalls("GET", "/api/v1/notifications");
    const params = new URL(call!.url).searchParams;
    expect(params.get("limit")).toBe("100");
    expect(params.get("offset")).toBe("40");
    expect(params.get("unread_only")).toBe("true");
    expect(params.has("evil")).toBe(false);
  });

  it("valores no numéricos o negativos caen a los límites", async () => {
    await notifications(req("/api/bff/notifications?limit=abc&offset=-5"));
    const params = new URL(backendCalls("GET", "/api/v1/notifications")[0]!.url).searchParams;
    expect(params.get("limit")).toBe("20");
    expect(params.get("offset")).toBe("0");
    expect(params.get("unread_only")).toBe("false");
  });
});

describe("GET/POST /api/bff/products", () => {
  it("solo reenvía q y category_id (parámetros desconocidos descartados)", async () => {
    await productsRoute.GET(
      req(`/api/bff/products?q=leche&category_id=${LOCATION_ID}&limit=99999&path=../admin`),
    );
    const [call] = backendCalls("GET", "/api/v1/products");
    const params = new URL(call!.url).searchParams;
    expect([...params.keys()].sort()).toEqual(["category_id", "q"]);
    expect(params.get("q")).toBe("leche");
  });

  it("q vacío no se reenvía", async () => {
    await productsRoute.GET(req("/api/bff/products?q=%20%20"));
    const params = new URL(backendCalls("GET", "/api/v1/products")[0]!.url).searchParams;
    expect(params.has("q")).toBe(false);
  });

  it("category_id inválido → 400 sin llamar a FastAPI", async () => {
    const response = await productsRoute.GET(req("/api/bff/products?category_id=1%20OR%201=1"));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POST exige CSRF (Origin ajeno → 403)", async () => {
    const response = await productsRoute.POST(
      req("/api/bff/products", {
        method: "POST",
        headers: { ...sameOriginJson, Origin: "https://evil.example" },
        body: { category_id: LOCATION_ID, name: "Leche", base_unit_code: "l" },
      }),
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
