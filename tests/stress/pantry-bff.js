// Escenarios de ESTRÉS del BFF de Despensa (Etapa 2 · pantry) con k6.
//
//   pnpm test:stress                       # SCENARIO=smoke por defecto
//   SCENARIO=load pnpm test:stress
//   SCENARIO=consume_contention pnpm test:stress
//
// Escenarios (variable SCENARIO):
//   smoke               1 VU · 30 s           — el script y el entorno funcionan.
//   load                0→50 VUs · 6 min      — lectura del panel (pantries + batches + locations + alertas).
//   spike               0→200 VUs en 10 s     — pico súbito (p. ej. notificación push masiva).
//   soak                20 VUs · 30 min       — fugas de memoria / degradación del proceso Next.
//   consume_contention  200 consumos de 1 pza contra un lote de 100 en paralelo:
//                       exactamente 100 OK, 100 `400 insufficient-stock`, stock final 0, nunca 5xx
//                       ni stock negativo (FOR UPDATE del backend + BFF sin estado).
//   refresh_storm       100 VUs sin access token y con el MISMO refresh token a la vez:
//                       el mutex del BFF debe hacer 1 rotación real y la sesión seguir viva
//                       (sin disparar la detección de reuso de FastAPI).
//   idempotent_replay   el mismo consumo reenviado N veces con la misma Idempotency-Key
//                       (simula la outbox tras perder respuestas): solo debe descontar una vez.
//                       Test de aceptación de despensa-backend#11 (PR #14).
//
// Requisitos: Next (`pnpm build && pnpm start`, con AUTH_COOKIE_SECURE=false en http)
// y FastAPI con rate limits altos (docs/FRONTEND_CONTEXT.md §5).
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import {
  BASE_URL,
  bffPost,
  mutationHeaders,
  noServerError,
  registerAndGetCookies,
  seedPantry,
  useCookies,
  uuid,
} from "./lib.js";

const SCENARIO = __ENV.SCENARIO || "smoke";
// "split" (4 GET en paralelo, como antes) | "aggregate" (1 GET al endpoint del dashboard, despensa-backend#20).
const DASHBOARD_MODE = __ENV.DASHBOARD_MODE || "split";

const consumeOk = new Counter("consume_ok");
const consumeInsufficient = new Counter("consume_insufficient_stock");
const consumeUnexpected = new Counter("consume_unexpected");
const refreshOk = new Rate("refresh_ok");
const replayExtraDeductions = new Counter("replay_extra_deductions");
const dashboardLatency = new Trend("dashboard_roundtrip", true);

const readThresholds = {
  http_req_failed: ["rate<0.01"],
  ...(DASHBOARD_MODE === "aggregate"
    ? { "http_req_duration{name:dashboard}": ["p(95)<800", "p(99)<1500"] }
    : {
        "http_req_duration{name:batches}": ["p(95)<800", "p(99)<1500"],
        "http_req_duration{name:pantries}": ["p(95)<500"],
      }),
  dashboard_roundtrip: ["p(95)<1500"],
  checks: ["rate>0.99"],
};

const SCENARIOS = {
  smoke: {
    executor: "constant-vus",
    vus: 1,
    duration: "30s",
    exec: "dashboard",
  },
  load: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "1m", target: 50 },
      { duration: "4m", target: 50 },
      { duration: "1m", target: 0 },
    ],
    exec: "dashboard",
  },
  spike: {
    executor: "ramping-vus",
    startVUs: 0,
    stages: [
      { duration: "10s", target: 200 },
      { duration: "1m", target: 200 },
      { duration: "10s", target: 0 },
    ],
    exec: "dashboard",
  },
  soak: {
    executor: "constant-vus",
    vus: 20,
    duration: __ENV.SOAK_DURATION || "30m",
    exec: "dashboard",
  },
  consume_contention: {
    executor: "shared-iterations",
    vus: 50,
    iterations: 200,
    maxDuration: "2m",
    exec: "consumeContention",
  },
  refresh_storm: {
    executor: "per-vu-iterations",
    vus: 100,
    iterations: 1,
    maxDuration: "1m",
    exec: "refreshStorm",
  },
  idempotent_replay: {
    executor: "shared-iterations",
    vus: 10,
    iterations: 20,
    maxDuration: "1m",
    exec: "idempotentReplay",
  },
};

const THRESHOLDS = {
  smoke: readThresholds,
  load: readThresholds,
  spike: {
    // En un pico se tolera más latencia, pero no errores de servidor.
    http_req_failed: ["rate<0.05"],
    [DASHBOARD_MODE === "aggregate" ? "http_req_duration{name:dashboard}" : "http_req_duration{name:batches}"]: ["p(95)<3000"],
    checks: ["rate>0.95"],
  },
  soak: readThresholds,
  consume_contention: {
    consume_ok: ["count==100"],
    consume_insufficient_stock: ["count==100"],
    consume_unexpected: ["count==0"],
    checks: ["rate==1"],
  },
  refresh_storm: {
    refresh_ok: ["rate>0.99"],
    checks: ["rate>0.99"],
  },
  idempotent_replay: {
    replay_extra_deductions: ["count==0"],
  },
};

if (!SCENARIOS[SCENARIO]) throw new Error(`SCENARIO desconocido: ${SCENARIO}`);

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] },
  // El setup registra un usuario por VU (bcrypt en FastAPI): puede tardar.
  setupTimeout: "10m",
  thresholds: THRESHOLDS[SCENARIO],
  // Las cookies del setup se reutilizan por VU: k6 vacía el tarro en cada
  // iteración salvo con `noCookiesReset` (y así el BFF puede rotar la sesión).
  noCookiesReset: true,
  // No seguir redirecciones del proxy.
  maxRedirects: 0,
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

const CONTENTION_STOCK = 100;
const REPLAY_STOCK = 1000;
const REPLAY_TIMES = 5;

function maxVus(config) {
  if (config.vus) return config.vus;
  return Math.max(...(config.stages || []).map((stage) => stage.target), 1);
}

/**
 * Un usuario por VU, todos miembros del mismo hogar (como una familia que usa
 * la app a la vez). Compartir UNA sesión entre VUs no es realista: al rotar el
 * access token (15 min) los demás VUs reusarían un refresh token ya rotado y
 * FastAPI revocaría la familia. `refresh_storm` hace justo eso a propósito.
 */
export function setup() {
  const owner = registerAndGetCookies(`owner-${SCENARIO}`);
  useCookies(owner.cookies);
  const stock =
    SCENARIO === "consume_contention" ? CONTENTION_STOCK : SCENARIO === "idempotent_replay" ? REPLAY_STOCK : 50;
  const seed = seedPantry(stock);

  const pool = [owner.cookies];
  const poolSize = SCENARIO === "refresh_storm" ? 1 : Number(__ENV.POOL_SIZE || maxVus(SCENARIOS[SCENARIO]));
  for (let i = 1; i < poolSize; i += 1) {
    http.cookieJar().clear(BASE_URL);
    const member = registerAndGetCookies(`member-${SCENARIO}-${i}`);
    useCookies(member.cookies);
    bffPost("/api/bff/pantries/join", { invite_code: seed.inviteCode }, 200);
    pool.push(member.cookies);
  }
  return { cookies: owner.cookies, pool, seed };
}

function sessionFor(data) {
  return data.pool[(__VU - 1) % data.pool.length];
}

// ── Lectura del panel (smoke/load/spike/soak) ───────────────────────────────
export function dashboard(data) {
  if (__ITER === 0) useCookies(sessionFor(data));
  const { pantryId } = data.seed;
  const started = Date.now();
  const responses = DASHBOARD_MODE === "aggregate"
    ? [http.get(`${BASE_URL}/api/bff/pantries/${pantryId}/dashboard`, { tags: { name: "dashboard" } })]
    : http.batch([
    ["GET", `${BASE_URL}/api/bff/pantries`, null, { tags: { name: "pantries" } }],
    ["GET", `${BASE_URL}/api/bff/pantries/${pantryId}/batches`, null, { tags: { name: "batches" } }],
    ["GET", `${BASE_URL}/api/bff/pantries/${pantryId}/locations`, null, { tags: { name: "locations" } }],
    ["GET", `${BASE_URL}/api/bff/notifications?unread_only=true&limit=1`, null, { tags: { name: "notifications" } }],
      ]);
  dashboardLatency.add(Date.now() - started);
  for (const res of responses) {
    check(res, {
      "200": (r) => r.status === 200,
      "no-store": (r) => (r.headers["Cache-Control"] || "").includes("no-store"),
      "correlation id": (r) => Boolean(r.headers["X-Correlation-Id"]),
    });
  }
  sleep(1 + Math.random());
}

// ── Contención de consumo FEFO ──────────────────────────────────────────────
export function consumeContention(data) {
  if (!http.cookieJar().cookiesForURL(BASE_URL).despensa_refresh_token) useCookies(sessionFor(data));
  const { pantryId, productId } = data.seed;
  const res = http.post(
    `${BASE_URL}/api/bff/pantries/${pantryId}/consume`,
    JSON.stringify({ product_id: productId, quantity: "1" }),
    { headers: mutationHeaders({ "Idempotency-Key": uuid() }), tags: { name: "consume" } },
  );
  noServerError(res, "consume");
  if (res.status === 200) consumeOk.add(1);
  else if (res.status === 400 && /insufficient-stock/.test(res.body)) consumeInsufficient.add(1);
  else consumeUnexpected.add(1);
}

// ── Tormenta de refresh ─────────────────────────────────────────────────────
export function refreshStorm(data) {
  // Solo refresh token + binding: el access "caducó" para todos a la vez.
  const jar = http.cookieJar();
  jar.set(BASE_URL, "despensa_refresh_token", data.cookies.despensa_refresh_token);
  if (data.cookies.despensa_client_binding) {
    jar.set(BASE_URL, "despensa_client_binding", data.cookies.despensa_client_binding);
  }
  const res = http.post(`${BASE_URL}/api/bff/auth/refresh`, null, {
    headers: mutationHeaders(),
    tags: { name: "refresh" },
  });
  refreshOk.add(res.status === 200 || res.status === 204);
  noServerError(res, "refresh");
  // El tarro del VU ya tiene las cookies que devolvió el BFF. Si FastAPI hubiera
  // detectado reuso y revocado la familia, esta sesión estaría muerta.
  const me = http.get(`${BASE_URL}/api/bff/auth/me`, { tags: { name: "me_after_storm" } });
  check(me, { "sesión viva tras la tormenta": (r) => r.status === 200 });
}

// ── Reenvío idempotente (aceptación de despensa-backend#11) ─────────────────
export function idempotentReplay(data) {
  if (__ITER === 0) useCookies(sessionFor(data));
  const { pantryId, productId } = data.seed;
  const key = uuid();
  let original;
  for (let i = 0; i < REPLAY_TIMES; i += 1) {
    const res = http.post(
      `${BASE_URL}/api/bff/pantries/${pantryId}/consume`,
      JSON.stringify({ product_id: productId, quantity: "1" }),
      { headers: mutationHeaders({ "Idempotency-Key": key }), tags: { name: "consume_replay" } },
    );
    noServerError(res, "replay");
    if (res.status !== 200) continue;
    // El BFF no reenvía `Idempotent-Replayed`; una repetición deduplicada devuelve
    // la respuesta ORIGINAL (mismo `remaining_stock`). Un descuento nuevo
    // devolvería el stock actual, menor (otros VUs y esta misma clave restaron).
    const remaining = res.json("remaining_stock");
    if (original === undefined) original = remaining;
    else if (remaining !== original) replayExtraDeductions.add(1);
  }
  // La verificación definitiva es el stock final del teardown (1 descuento por clave).
}

export function teardown(data) {
  // refresh_storm ya verificó la sesión en cada VU; reusar aquí sus cookies
  // originales (ya rotadas) dispararía a propósito la detección de reuso.
  if (SCENARIO === "refresh_storm") return;
  http.cookieJar().clear(BASE_URL);
  useCookies(data.pool[data.pool.length - 1]);
  const res = http.get(`${BASE_URL}/api/bff/pantries/${data.seed.pantryId}/batches`, { tags: { name: "verify" } });
  if (res.status !== 200) return;
  const total = res.json().reduce((acc, batch) => acc + Number(batch.current_quantity), 0);
  if (SCENARIO === "consume_contention") {
    check(total, { "stock final == 0 (sin sobreventa ni negativos)": (t) => t === 0 });
  }
  if (SCENARIO === "idempotent_replay") {
    const expected = REPLAY_STOCK - 20;
    check(total, { [`stock == ${expected} (1 descuento por clave)`]: (t) => t === expected });
  }
  // Sin limpieza: no hay DELETE de hogares; los datos usan emails qa+k6-*.
}
