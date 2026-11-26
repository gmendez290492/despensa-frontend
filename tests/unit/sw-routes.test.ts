import { describe, expect, it } from "vitest";
import {
  classifyRequest,
  isCacheablePageResponse,
  isPreservedCacheName,
  LEGACY_USER_DATA_CACHES,
  publicPageCacheKey,
  SW_CACHE_NAMES,
  type SwRouteKind,
} from "@/lib/offline/sw-routes";

const ORIGIN = "https://despensa.test";

interface RequestInit {
  method?: string;
  mode?: string;
  destination?: string;
  headers?: Record<string, string>;
  origin?: string;
}

function classify(path: string, init: RequestInit = {}): SwRouteKind {
  const origin = init.origin ?? ORIGIN;
  const headers = new Headers(init.headers);
  return classifyRequest({
    url: new URL(path, origin),
    sameOrigin: origin === ORIGIN,
    request: {
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
      destination: init.destination ?? "",
      headers,
    },
  });
}

const navigate = { mode: "navigate", destination: "document" } as const;

describe("classifyRequest (reglas del Service Worker)", () => {
  it.each([
    ["/api/bff/auth/login", "POST"],
    ["/api/bff/auth/me", "GET"],
    ["/api/bff/auth/refresh?next=/", "GET"],
    ["/api/bff/auth/logout", "POST"],
    ["/api/v1/auth/refresh", "POST"],
  ])("%s (%s) es auth NetworkOnly", (path, method) => {
    expect(classify(path, { method })).toBe("auth-network-only");
  });

  it("auth de FastAPI cross-origin también es NetworkOnly", () => {
    expect(classify("/api/v1/auth/login", { method: "POST", origin: "https://api.test" })).toBe(
      "auth-network-only",
    );
  });

  it("la navegación del proxy a /api/bff/auth/refresh nunca es una página cacheable", () => {
    expect(classify("/api/bff/auth/refresh?next=/", navigate)).toBe("auth-network-only");
  });

  it.each([
    ["/api/bff/products", "GET", ORIGIN],
    ["/api/bff/batches", "POST", ORIGIN],
    ["/api", "GET", ORIGIN],
    ["/api/v1/products", "GET", "https://api.test"],
  ])("%s (%s) es API NetworkOnly", (path, method, origin) => {
    expect(classify(path, { method, origin })).toBe("api-network-only");
  });

  it("rutas que solo empiezan por 'api' no son API", () => {
    expect(classify("/apiario", navigate)).toBe("protected-page");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])(
    "cualquier %s fuera de /api es NetworkOnly (Server Actions, formularios)",
    (method) => {
      expect(classify("/", { method, ...navigate })).toBe("mutation-network-only");
      expect(classify("/login", { method, headers: { "Next-Action": "abc" } })).toBe(
        "mutation-network-only",
      );
    },
  );

  it("los payloads RSC nunca se cachean, ni de rutas públicas", () => {
    expect(classify("/", { headers: { RSC: "1" } })).toBe("rsc-network-only");
    expect(classify("/login?_rsc=abc12")).toBe("rsc-network-only");
    expect(classify("/registro", { headers: { RSC: "1", "Next-Router-Prefetch": "1" } })).toBe(
      "rsc-network-only",
    );
  });

  it.each(["/login", "/login/", "/login?next=%2Fdespensa", "/registro"])(
    "%s es página pública cacheable",
    (path) => {
      expect(classify(path, navigate)).toBe("public-page");
    },
  );

  it.each(["/", "/despensa", "/login-extra", "/registro/paso-2", "/offline"])(
    "%s es navegación NetworkOnly (fallback /offline)",
    (path) => {
      expect(classify(path, navigate)).toBe("protected-page");
    },
  );

  it.each<[string, SwRouteKind]>([
    ["/_next/static/chunks/app.js", "next-static"],
    ["/_next/static/media/manrope.woff2", "next-static"],
    ["/_next/image?url=%2Fa.png&w=64&q=75", "static-image"],
    ["/favicon.ico", "static-image"],
    ["/icons/icon-192.png", "static-image"],
    ["/fonts/x.woff2", "static-font"],
    ["/swe-worker-abc.js", "static-script"],
    ["/styles.css", "static-style"],
    ["/manifest.webmanifest", "web-manifest"],
    ["/robots.txt", "network-only"],
  ])("%s -> %s", (path, kind) => {
    expect(classify(path)).toBe(kind);
  });

  it("todo cross-origin que no es API va directo a red", () => {
    expect(classify("/css2?family=Manrope", { origin: "https://fonts.googleapis.com" })).toBe(
      "network-only",
    );
  });
});

describe("isCacheablePageResponse", () => {
  const ok = { status: 200, type: "basic", redirected: false, url: `${ORIGIN}/login` };

  it("acepta un 200 basic sin redirección de una página pública", () => {
    expect(isCacheablePageResponse(ok)).toBe(true);
  });

  it("rechaza redirecciones del proxy (opaqueredirect, status 0)", () => {
    expect(isCacheablePageResponse({ ...ok, status: 0, type: "opaqueredirect", url: "" })).toBe(
      false,
    );
  });

  it("rechaza respuestas seguidas tras redirección (/login -> / con sesión)", () => {
    expect(isCacheablePageResponse({ ...ok, redirected: true, url: `${ORIGIN}/` })).toBe(false);
    expect(isCacheablePageResponse({ ...ok, url: `${ORIGIN}/` })).toBe(false);
  });

  it.each([303, 307, 404, 500])("rechaza status %i", (status) => {
    expect(isCacheablePageResponse({ ...ok, status })).toBe(false);
  });

  it("rechaza respuestas opacas / cors", () => {
    expect(isCacheablePageResponse({ ...ok, type: "opaque" })).toBe(false);
    expect(isCacheablePageResponse({ ...ok, type: "cors" })).toBe(false);
  });
});

describe("publicPageCacheKey", () => {
  it("elimina query y barra final", () => {
    expect(publicPageCacheKey(new URL(`${ORIGIN}/login/?next=%2Fx`))).toBe(`${ORIGIN}/login`);
  });
});

describe("isPreservedCacheName", () => {
  it("conserva precache, assets estáticos y HTML público", () => {
    expect(isPreservedCacheName("serwist-precache-v2-https://despensa.test/")).toBe(true);
    for (const name of Object.values(SW_CACHE_NAMES)) expect(isPreservedCacheName(name)).toBe(true);
  });

  it("no conserva cachés heredadas de defaultCache ni desconocidas", () => {
    for (const name of LEGACY_USER_DATA_CACHES) expect(isPreservedCacheName(name)).toBe(false);
    expect(isPreservedCacheName("despensa-api-data")).toBe(false);
    expect(isPreservedCacheName("serwist-runtime-https://despensa.test/")).toBe(false);
  });
});
