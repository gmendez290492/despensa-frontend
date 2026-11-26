/**
 * Reglas puras de enrutamiento del Service Worker (`src/sw.ts`).
 *
 * Este módulo no depende de tipos DOM ni WebWorker: compila en ambos
 * `tsconfig` y se testea en Vitest. `sw.ts` construye `runtimeCaching` a partir
 * de `classifyRequest`, de modo que lo testeado es exactamente lo que ejecuta
 * el SW.
 *
 * Principios:
 * - Nada de `/api/*` (BFF) ni `/api/v1/*` (FastAPI) se cachea nunca.
 * - Ninguna petición no-GET se cachea.
 * - Los payloads RSC (`RSC: 1` / `?_rsc=`) nunca se cachean: contienen datos de
 *   usuario de rutas protegidas.
 * - Solo el HTML de páginas públicas sin datos de usuario (`/login`,
 *   `/registro`, `/offline`) puede servirse desde caché. El resto de
 *   navegaciones es `NetworkOnly` con fallback a `/offline`.
 */

/** Subconjunto estructural de `Request` (válido en DOM y WebWorker). */
export interface SwRequestLike {
  method: string;
  mode: string;
  destination: string;
  headers: { get(name: string): string | null };
}

/** Entrada de {@link classifyRequest} (forma de `RouteMatchCallbackOptions` de Serwist). */
export interface SwRouteMatchInput {
  url: URL;
  request: SwRequestLike;
  sameOrigin: boolean;
}

/** Estrategia que aplica el SW a una petición, según {@link classifyRequest}. */
export type SwRouteKind =
  /** `/api/bff/auth/*` o `/api/v1/auth/*` (cualquier método/origen). */
  | "auth-network-only"
  /** Resto de `/api/*` del mismo origen y `/api/v1/*` de cualquier origen. */
  | "api-network-only"
  /** Cualquier método distinto de GET (Server Actions, formularios, etc.). */
  | "mutation-network-only"
  /** Flight data RSC (navegación cliente / prefetch). */
  | "rsc-network-only"
  /** Navegación a página pública cacheable (NetworkFirst). */
  | "public-page"
  /** Navegación a cualquier otra ruta (protegida): NetworkOnly + fallback. */
  | "protected-page"
  | "next-static"
  | "static-font"
  | "static-image"
  | "static-script"
  | "static-style"
  | "web-manifest"
  /** Todo lo demás (incluido cross-origin): red directa, sin caché. */
  | "network-only";

/** Métodos HTTP para los que Serwist registra rutas (ver `HTTPMethod`). */
export const SW_HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
/** Unión de {@link SW_HTTP_METHODS}. */
export type SwHttpMethod = (typeof SW_HTTP_METHODS)[number];

/** Página estática servida cuando una navegación falla sin red. */
export const OFFLINE_FALLBACK_PATH = "/offline";

/**
 * Páginas públicas sin datos de usuario que pueden abrirse offline. Se
 * calientan en `install` con `credentials: "omit"` (HTML anónimo garantizado)
 * y se actualizan con NetworkFirst.
 */
export const CACHEABLE_PUBLIC_PAGES = ["/login", "/registro"] as const;

/** Nombres de las cachés runtime gestionadas por `sw.ts`. */
export const SW_CACHE_NAMES = {
  publicPages: "despensa-public-pages",
  nextStatic: "despensa-next-static",
  fonts: "despensa-static-fonts",
  images: "despensa-static-images",
  scripts: "despensa-static-scripts",
  styles: "despensa-static-styles",
  manifest: "despensa-web-manifest",
} as const;

/**
 * Cachés que conserva el logout: app shell (precache de Serwist), assets
 * estáticos versionados y HTML público anónimo. Cualquier otra caché (p. ej.
 * las heredadas de `defaultCache`: `apis`, `pages`, `pages-rsc`, `others`…)
 * se considera potencialmente ligada al usuario y se borra.
 */
const PRESERVED_CACHE_PREFIXES = ["serwist-precache", ...Object.values(SW_CACHE_NAMES)] as const;

/**
 * Indica si una caché debe sobrevivir al logout (app shell y assets anónimos).
 *
 * @param name - Nombre de la caché en Cache Storage.
 * @returns `true` si coincide con un prefijo preservado.
 */
export function isPreservedCacheName(name: string): boolean {
  return PRESERVED_CACHE_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
}

/**
 * Cachés creadas por versiones previas del SW con `defaultCache` de
 * `@serwist/next/worker`. Pueden contener HTML/RSC/JSON de un usuario; se
 * eliminan en `activate`.
 */
export const LEGACY_USER_DATA_CACHES = [
  "apis",
  "pages",
  "pages-rsc",
  "pages-rsc-prefetch",
  "others",
  "next-data",
  "static-data-assets",
  "cross-origin",
] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * @param pathname - Ruta de la URL.
 * @returns `true` para `/api/bff/auth/*` y `/api/v1/auth/*` (nunca cacheables).
 */
export function isAuthApiPath(pathname: string): boolean {
  return matchesPrefix(pathname, "/api/bff/auth") || matchesPrefix(pathname, "/api/v1/auth");
}

/**
 * @param pathname - Ruta de la URL.
 * @returns `true` para cualquier ruta bajo `/api`.
 */
export function isApiPath(pathname: string): boolean {
  return matchesPrefix(pathname, "/api");
}

/**
 * Detecta payloads RSC (cabecera `RSC: 1` o `?_rsc=`), que contienen datos de usuario.
 *
 * @param input - URL y petición.
 * @returns `true` si es una petición de Flight data.
 */
export function isRscRequest({ url, request }: Pick<SwRouteMatchInput, "url" | "request">): boolean {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

/**
 * @param request - Petición interceptada.
 * @returns `true` para navegaciones de documento (`mode: "navigate"`).
 */
export function isNavigationRequest(request: SwRequestLike): boolean {
  return request.mode === "navigate" || request.destination === "document";
}

/** Normaliza `/login/` -> `/login`. */
export function normalizePathname(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/**
 * @param pathname - Ruta de la URL (con o sin barra final).
 * @returns `true` si está en {@link CACHEABLE_PUBLIC_PAGES}.
 */
export function isCacheablePublicPage(pathname: string): boolean {
  return (CACHEABLE_PUBLIC_PAGES as readonly string[]).includes(normalizePathname(pathname));
}

const FONT_RE = /\.(?:eot|otf|ttc|ttf|woff2?)$/i;
const IMAGE_RE = /\.(?:jpe?g|gif|png|svg|ico|webp|avif)$/i;
const SCRIPT_RE = /\.(?:js|mjs)$/i;
const STYLE_RE = /\.css$/i;

/**
 * Clasifica una petición. El orden importa: las reglas de seguridad
 * (auth/API/mutaciones/RSC) se evalúan antes que cualquier regla de caché.
 */
export function classifyRequest({ url, request, sameOrigin }: SwRouteMatchInput): SwRouteKind {
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (isAuthApiPath(pathname)) return "auth-network-only";
  if ((sameOrigin && isApiPath(pathname)) || matchesPrefix(pathname, "/api/v1")) {
    return "api-network-only";
  }
  if (method !== "GET") return "mutation-network-only";
  if (!sameOrigin) return "network-only";
  if (isRscRequest({ url, request })) return "rsc-network-only";

  if (isNavigationRequest(request)) {
    return isCacheablePublicPage(pathname) ? "public-page" : "protected-page";
  }

  if (pathname.startsWith("/_next/static/")) return "next-static";
  if (pathname.startsWith("/_next/image")) return "static-image";
  if (pathname === "/manifest.webmanifest") return "web-manifest";
  if (FONT_RE.test(pathname)) return "static-font";
  if (IMAGE_RE.test(pathname)) return "static-image";
  if (SCRIPT_RE.test(pathname)) return "static-script";
  if (STYLE_RE.test(pathname)) return "static-style";

  return "network-only";
}

/**
 * Valida que una respuesta de navegación pública es apta para caché: 200,
 * mismo origen (`basic`), sin redirección y cuya URL final sigue siendo una
 * página pública. Bloquea, entre otros, los 307/303 del proxy
 * (`opaqueredirect`, status 0) que `cacheOkAndOpaquePlugin` de Serwist sí
 * cachearía, y un `/login` que acabó sirviendo `/` tras una redirección.
 */
export function isCacheablePageResponse(response: {
  status: number;
  type: string;
  redirected: boolean;
  url: string;
}): boolean {
  if (response.status !== 200 || response.type !== "basic" || response.redirected) return false;
  if (response.url) {
    try {
      if (!isCacheablePublicPage(new URL(response.url).pathname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Clave de caché sin query (`/login?next=/x` -> `/login`). */
export function publicPageCacheKey(url: URL): string {
  return `${url.origin}${normalizePathname(url.pathname)}`;
}
