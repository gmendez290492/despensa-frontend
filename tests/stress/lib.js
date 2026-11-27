// Utilidades compartidas de los escenarios k6 contra el BFF de Despensa.
// k6 no es Node: solo módulos `k6/*` y ES modules sin dependencias npm.
import http from "k6/http";
import { check, fail } from "k6";

/** URL base del BFF tal como la ve el contenedor de k6. */
export const BASE_URL = __ENV.BASE_URL || "http://host.docker.internal:3000";
/**
 * Origen que el BFF espera en `Origin` (= `APP_ORIGIN` del servidor Next). Puede
 * diferir de BASE_URL cuando k6 corre en Docker (`host.docker.internal`).
 */
export const APP_ORIGIN = __ENV.APP_ORIGIN || "http://localhost:3000";
export const PASSWORD = "PanDeMasaMadre$24";

/** Cabeceras de una mutación legítima (defensa CSRF del BFF). */
export function mutationHeaders(extra = {}) {
  return { Origin: APP_ORIGIN, "Content-Type": "application/json", ...extra };
}

/** Email único por VU/iteración. */
let emailSeq = 0;
export function uniqueEmail(tag) {
  // `__VU`/`__ITER` no existen en setup()/teardown(): contador local + aleatorio.
  emailSeq += 1;
  const vu = typeof __VU === "number" ? __VU : 0;
  return `qa+k6-${tag}-${Date.now()}-${vu}-${emailSeq}-${Math.floor(Math.random() * 1e6)}@despensa-qa.com`;
}

/** Nombres de las cookies de sesión `HttpOnly` del BFF. */
export const SESSION_COOKIES = ["despensa_access_token", "despensa_refresh_token", "despensa_client_binding"];

/**
 * Registra un usuario y devuelve sus cookies de sesión (para compartirlas
 * con los VUs desde `setup()`).
 */
export function registerAndGetCookies(tag) {
  const email = uniqueEmail(tag);
  const res = http.post(
    `${BASE_URL}/api/bff/auth/register`,
    JSON.stringify({ full_name: "K6 QA", email, password: PASSWORD, timezone: "UTC", alert_days_before: 3 }),
    { headers: mutationHeaders(), tags: { name: "register" } },
  );
  if (res.status !== 201) fail(`registro falló (${res.status}): ${res.body}`);
  const cookies = {};
  for (const name of SESSION_COOKIES) {
    const value = res.cookies[name] && res.cookies[name][0] && res.cookies[name][0].value;
    if (value) cookies[name] = value;
  }
  if (!cookies.despensa_access_token) fail("el registro no devolvió cookie de access token");
  return { email, cookies };
}

/** Carga cookies en el tarro del VU actual. */
export function useCookies(cookies) {
  const jar = http.cookieJar();
  for (const [name, value] of Object.entries(cookies)) jar.set(BASE_URL, name, value);
}

/** POST JSON al BFF con el tarro del VU; falla el setup si el status no es el esperado. */
export function bffPost(path, body, expected = 201, extraHeaders = {}) {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: mutationHeaders(extraHeaders),
    tags: { name: path.replace(/[0-9a-f-]{36}/g, ":id") },
  });
  if (res.status !== expected) fail(`${path} → ${res.status}: ${res.body}`);
  return res.json();
}

/** Siembra hogar + ubicación + producto + lote (cantidad `quantity`) para la sesión cargada. */
export function seedPantry(quantity) {
  const pantry = bffPost("/api/bff/pantries", { name: `Casa k6 ${Date.now()}` });
  const location = bffPost(`/api/bff/pantries/${pantry.id}/locations`, { name: "Nevera k6" });
  const categories = http.get(`${BASE_URL}/api/bff/categories`).json();
  const product = bffPost("/api/bff/products", {
    category_id: categories[0].id,
    name: `Arroz k6 ${Date.now()}`,
    base_unit_code: "pza",
    estimated_shelf_life_days: 30,
  });
  const expiration = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  bffPost(`/api/bff/pantries/${pantry.id}/batches`, {
    location_id: location.id,
    product_id: product.id,
    unit_code: "pza",
    quantity: String(quantity),
    expiration_date: expiration,
  });
  return { pantryId: pantry.id, inviteCode: pantry.invite_code, productId: product.id };
}

/** `check` de respuesta problem+json sin 5xx. */
export function noServerError(res, name) {
  return check(res, {
    [`${name}: sin 5xx`]: (r) => r.status > 0 && r.status < 500,
  });
}

/** UUID v4 aleatorio (para `Idempotency-Key`). */
export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
