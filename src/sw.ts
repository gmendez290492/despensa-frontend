import type {
  PrecacheEntry,
  RuntimeCaching,
  SerwistGlobalConfig,
  SerwistPlugin,
} from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";
import {
  CACHEABLE_PUBLIC_PAGES,
  LEGACY_USER_DATA_CACHES,
  OFFLINE_FALLBACK_PATH,
  SW_CACHE_NAMES,
  SW_HTTP_METHODS,
  classifyRequest,
  isCacheablePageResponse,
  publicPageCacheKey,
  type SwRouteKind,
} from "./lib/offline/sw-routes";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[];
  }
}

declare const self: ServiceWorkerGlobalScope;

/*
 * Estrategia de caché (ver `src/lib/offline/sw-routes.ts`):
 * - Precache: assets de `/_next/static`, `public/` y el HTML de `/offline`
 *   (allowlist en `serwist.config.mjs`; `/` y rutas protegidas NO).
 * - `/api/*`, `/api/v1/*`, no-GET y RSC: NetworkOnly (nunca se cachean).
 * - Navegación a `/login` y `/registro`: NetworkFirst con caché propia
 *   (anónima, sin redirecciones). Resto de navegaciones: NetworkOnly.
 * - Cualquier navegación que falle sin red cae en `/offline`.
 */

const DAY = 24 * 60 * 60;

const networkOnly = new NetworkOnly();

/**
 * Plugin para el HTML público: clave sin query (`/login?next=` -> `/login`) y
 * solo cachea 200 `basic` no redirigidos (descarta los 307/303 del proxy).
 */
const publicPagePlugin: SerwistPlugin = {
  cacheKeyWillBeUsed: async ({ request }) => publicPageCacheKey(new URL(request.url)),
  cacheWillUpdate: async ({ response }) => (isCacheablePageResponse(response) ? response : null),
};

const handlers: Partial<Record<SwRouteKind, RuntimeCaching["handler"]>> = {
  "auth-network-only": networkOnly,
  "api-network-only": networkOnly,
  "mutation-network-only": networkOnly,
  "rsc-network-only": networkOnly,
  "protected-page": networkOnly,
  "public-page": new NetworkFirst({
    cacheName: SW_CACHE_NAMES.publicPages,
    networkTimeoutSeconds: 4,
    matchOptions: { ignoreVary: true, ignoreSearch: true },
    plugins: [publicPagePlugin],
  }),
  "next-static": new CacheFirst({
    cacheName: SW_CACHE_NAMES.nextStatic,
    plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * DAY, maxAgeFrom: "last-used" })],
  }),
  "static-font": new CacheFirst({
    cacheName: SW_CACHE_NAMES.fonts,
    plugins: [new ExpirationPlugin({ maxEntries: 8, maxAgeSeconds: 365 * DAY, maxAgeFrom: "last-used" })],
  }),
  "static-image": new StaleWhileRevalidate({
    cacheName: SW_CACHE_NAMES.images,
    plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 30 * DAY, maxAgeFrom: "last-used" })],
  }),
  "static-script": new StaleWhileRevalidate({
    cacheName: SW_CACHE_NAMES.scripts,
    plugins: [new ExpirationPlugin({ maxEntries: 48, maxAgeSeconds: DAY, maxAgeFrom: "last-used" })],
  }),
  "static-style": new StaleWhileRevalidate({
    cacheName: SW_CACHE_NAMES.styles,
    plugins: [new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: DAY, maxAgeFrom: "last-used" })],
  }),
  "web-manifest": new StaleWhileRevalidate({ cacheName: SW_CACHE_NAMES.manifest }),
  // "network-only" no se registra: sin ruta, la petición va a la red sin pasar por el SW.
};

/** Reglas que aplican a cualquier método HTTP (el resto solo a GET). */
const ALL_METHOD_KINDS: ReadonlySet<SwRouteKind> = new Set([
  "auth-network-only",
  "api-network-only",
  "mutation-network-only",
]);

const runtimeCaching: RuntimeCaching[] = Object.entries(handlers).flatMap(([kind, handler]) => {
  const routeKind = kind as SwRouteKind;
  const methods = ALL_METHOD_KINDS.has(routeKind) ? SW_HTTP_METHODS : (["GET"] as const);
  return methods.map(
    (method): RuntimeCaching => ({
      matcher: (options) => classifyRequest(options) === routeKind,
      handler: handler!,
      method,
    }),
  );
});

/**
 * Calienta `/login` y `/registro` sin cookies (`credentials: "omit"`) para que
 * el HTML sea siempre anónimo y coincida con el build recién instalado. Nunca
 * hace fallar la instalación.
 */
async function warmPublicPages(): Promise<void> {
  const cache = await caches.open(SW_CACHE_NAMES.publicPages);
  await Promise.all(
    CACHEABLE_PUBLIC_PAGES.map(async (path) => {
      const url = new URL(path, self.location.origin);
      try {
        const response = await fetch(url, {
          credentials: "omit",
          redirect: "manual",
          cache: "reload",
        });
        if (isCacheablePageResponse(response)) {
          await cache.put(publicPageCacheKey(url), response);
        }
      } catch (error) {
        console.warn("[sw] no se pudo precalentar", path, error);
      }
    }),
  );
}

/** Borra cachés de versiones previas del SW (`defaultCache`) con posibles datos de usuario. */
async function deleteLegacyUserCaches(): Promise<void> {
  await Promise.all(LEGACY_USER_DATA_CACHES.map((name) => caches.delete(name)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmPublicPages().catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteLegacyUserCaches().catch(() => undefined));
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: OFFLINE_FALLBACK_PATH,
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
