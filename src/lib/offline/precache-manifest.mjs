// @ts-check

/**
 * Allowlist de HTML prerenderizado que puede entrar en el precache de Serwist.
 *
 * El precache es *cache-first* y sigue redirecciones al instalarse (copia la
 * respuesta final), así que solo se admite HTML de rutas públicas, estáticas y
 * sin redirecciones del proxy. `/` y cualquier ruta protegida quedan fuera:
 * su shell prerenderizado se serviría sin pasar por `proxy.ts` y sin el
 * contenido dinámico de la sesión.
 *
 * `/login` y `/registro` tampoco se precachean (el proxy las redirige cuando
 * hay sesión); `src/sw.ts` las calienta en una caché runtime con
 * `credentials: "omit"` y las sirve NetworkFirst.
 */
export const PRECACHE_HTML_ROUTES = ["/offline"];

/**
 * Ruta pública de un HTML prerenderizado por Next (`.next/server/app/offline.html`
 * -> `/offline`, `.../index.html` -> `/`). `null` si no es HTML de app/pages.
 *
 * @param {string} rawUrl
 * @returns {string | null}
 */
export function prerenderedHtmlRoute(rawUrl) {
  const url = rawUrl.replaceAll("\\", "/");
  if (!url.endsWith(".html")) return null;
  const match = /(?:^|\/)server\/(?:app|pages)(\/.*)\.html$/.exec(url);
  if (!match || match[1] === undefined) return null;
  const route = match[1];
  if (route === "/index") return "/";
  return route.endsWith("/index") ? route.slice(0, -"/index".length) : route;
}

/**
 * `manifestTransform` de Serwist: descarta todo HTML fuera de la allowlist.
 * Se ejecuta antes de la transformación de `@serwist/next` (rutas crudas).
 *
 * @template {{ url: string }} T
 * @param {T[]} entries
 * @param {readonly string[]} [allowlist]
 * @returns {{ manifest: T[]; warnings: string[] }}
 */
export function filterPrecacheHtml(entries, allowlist = PRECACHE_HTML_ROUTES) {
  const manifest = entries.filter((entry) => {
    if (!entry.url.replaceAll("\\", "/").endsWith(".html")) return true;
    const route = prerenderedHtmlRoute(entry.url);
    return route !== null && allowlist.includes(route);
  });
  return { manifest, warnings: [] };
}
