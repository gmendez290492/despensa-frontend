import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  backendIsUp,
  BACKEND_API_URL,
  bffPost,
  newIsolatedRequest,
  registerUser,
  sameOriginHeaders,
  seedPantry,
  type PantrySeed,
} from "../support/seed";

/*
 * Escenarios de SEGURIDAD de la Etapa 2 (módulo pantry) contra el backend real.
 *
 *   pnpm test:security            # solo esta carpeta
 *   BACKEND_API_URL=http://localhost:8000 pnpm test:e2e tests/e2e/security
 *
 * Requiere FastAPI con rate limits altos (docs/FRONTEND_CONTEXT.md §5). Cada
 * escenario documenta la amenaza (OWASP / ASVS) que cubre.
 */

const APP = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

test.describe.configure({ mode: "serial" });

test.describe("seguridad · pantry", () => {
  let owner: APIRequestContext;
  let intruder: APIRequestContext;
  let seed: PantrySeed;

  test.beforeAll(async () => {
    test.skip(!(await backendIsUp()), `Backend no disponible en ${BACKEND_API_URL}`);
    owner = await newIsolatedRequest(APP);
    intruder = await newIsolatedRequest(APP);
    await registerUser(owner, APP, "owner", "Dueña QA");
    await registerUser(intruder, APP, "intruder", "Intruso QA");
    seed = await seedPantry(owner, APP);
  });

  test.afterAll(async () => {
    await owner?.dispose();
    await intruder?.dispose();
  });

  // ── A01 Broken Access Control: IDOR ──────────────────────────────────────
  test("IDOR: otro usuario no puede leer lotes ni ubicaciones del hogar ajeno", async () => {
    for (const path of [
      `/api/bff/pantries/${seed.pantryId}/batches`,
      `/api/bff/pantries/${seed.pantryId}/locations`,
    ]) {
      const response = await intruder.get(path);
      expect(response.status(), path).toBe(403);
      expect(response.headers()["content-type"]).toContain("application/problem+json");
      const body = await response.json();
      expect(body.type).toMatch(/pantry-access-denied$/);
      // No se filtra nada del recurso ajeno.
      expect(JSON.stringify(body)).not.toContain(seed.productName);
    }
  });

  test("IDOR: otro usuario no puede consumir, crear lotes ni ubicaciones en el hogar ajeno", async () => {
    const headers = sameOriginHeaders(APP);
    const attempts = [
      intruder.post(`/api/bff/pantries/${seed.pantryId}/consume`, {
        headers,
        data: { product_id: seed.productId, quantity: "1" },
      }),
      intruder.post(`/api/bff/pantries/${seed.pantryId}/batches`, {
        headers,
        data: {
          location_id: seed.locationId,
          product_id: seed.productId,
          unit_code: "l",
          quantity: "5",
          expiration_date: new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10),
        },
      }),
      intruder.post(`/api/bff/pantries/${seed.pantryId}/locations`, {
        headers,
        data: { name: "Escondite" },
      }),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status()).toBe(403);
    }
    // El stock del dueño sigue intacto.
    const batches = (await (await owner.get(`/api/bff/pantries/${seed.pantryId}/batches`)).json()) as {
      current_quantity: string;
    }[];
    expect(batches.map((b) => Number(b.current_quantity))).toEqual([2]);
  });

  test("IDOR en la UI: un activePantryId ajeno en localStorage no muestra datos del otro hogar", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: APP });
    const page = await context.newPage();
    await registerUser(page.request, APP, "ui-intruder", "Intrusa UI");
    // Manipulación del estado persistido de Zustand (lo único que guarda es el ID).
    await page.addInitScript((pantryId) => {
      localStorage.setItem(
        "despensa-ui-storage",
        JSON.stringify({ state: { activePantryId: pantryId, continuousScanQueue: [] }, version: 0 }),
      );
    }, seed.pantryId);
    const forbidden: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes(seed.pantryId) && response.status() === 200) forbidden.push(response.url());
    });
    await page.goto("/");
    // Sin hogares propios → onboarding; nunca los datos del hogar ajeno.
    await expect(page.getByText(seed.productName)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /hogar/i }).first()).toBeVisible();
    expect(forbidden).toEqual([]);
    await context.close();
  });

  test("unirse con el código de invitación SÍ concede acceso (control positivo)", async () => {
    const guest = await newIsolatedRequest(APP);
    await registerUser(guest, APP, "guest", "Invitada QA");
    await bffPost(guest, APP, "/api/bff/pantries/join", { invite_code: seed.inviteCode }, 200);
    expect((await guest.get(`/api/bff/pantries/${seed.pantryId}/batches`)).status()).toBe(200);
    // Unirse dos veces → 409, no duplica la membresía.
    const again = await guest.post("/api/bff/pantries/join", {
      headers: sameOriginHeaders(APP),
      data: { invite_code: seed.inviteCode },
    });
    expect(again.status()).toBe(409);
    await guest.dispose();
  });

  // ── Autenticación obligatoria ────────────────────────────────────────────
  test("sin sesión: el BFF responde 401 problem+json y las páginas redirigen a /login", async ({ page }) => {
    const anonymous = await newIsolatedRequest(APP);
    for (const path of ["/api/bff/pantries", `/api/bff/pantries/${seed.pantryId}/batches`, "/api/bff/notifications"]) {
      const response = await anonymous.get(path);
      expect(response.status(), path).toBe(401);
      expect(response.headers()["content-type"]).toContain("application/problem+json");
    }
    await anonymous.dispose();
    await page.goto("/despensa");
    await expect(page).toHaveURL(/\/login\?next=%2Fdespensa$/);
  });

  // ── A01/CSRF ─────────────────────────────────────────────────────────────
  test("CSRF: Origin ajeno → 403, Sec-Fetch-Site cross-site → 403, text/plain → 415", async () => {
    const path = `/api/bff/pantries/${seed.pantryId}/consume`;
    const data = JSON.stringify({ product_id: seed.productId, quantity: "1" });
    const evilOrigin = await owner.post(path, {
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      data,
    });
    expect(evilOrigin.status()).toBe(403);
    const crossSite = await owner.post(path, {
      headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
      data,
    });
    expect(crossSite.status()).toBe(403);
    // Formulario HTML "simple" (sin preflight): text/plain.
    const simpleForm = await owner.post(path, {
      headers: { Origin: new URL(APP).origin, "Content-Type": "text/plain" },
      data,
    });
    expect(simpleForm.status()).toBe(415);
    // Nada de lo anterior tocó el stock.
    const batches = (await (await owner.get(`/api/bff/pantries/${seed.pantryId}/batches`)).json()) as {
      current_quantity: string;
    }[];
    expect(Number(batches[0]!.current_quantity)).toBe(2);
  });

  // ── A03 Injection / validación de entrada ────────────────────────────────
  test("parámetros de ruta: UUID inválido o path traversal → 400/404, nunca 5xx ni datos", async () => {
    for (const segment of ["not-a-uuid", "..%2F..%2Fusers%2Fme", "%00", "1%27%20OR%201%3D1"]) {
      const response = await owner.get(`/api/bff/pantries/${segment}/batches`);
      expect([400, 404], segment).toContain(response.status());
    }
  });

  test("Idempotency-Key malformada → 400; cuerpo con campos extra no se reenvía (mass assignment)", async () => {
    const long = await owner.post(`/api/bff/pantries/${seed.pantryId}/consume`, {
      headers: { ...sameOriginHeaders(APP), "Idempotency-Key": "x".repeat(300) },
      data: { product_id: seed.productId, quantity: "0.1" },
    });
    expect(long.status()).toBe(400);
    // FastAPI tiene `extra="forbid"`: si el BFF reenviara campos extra, sería 422.
    const pantry = await bffPost<{ id: string; name: string }>(owner, APP, "/api/bff/pantries", {
      name: "Casa limpia",
      owner_id: "00000000-0000-0000-0000-000000000000",
      role: "admin",
    });
    expect(pantry.name).toBe("Casa limpia");
  });

  test("cantidades hostiles se rechazan en el BFF (negativas, notación científica, overflow)", async () => {
    for (const quantity of ["-1", "1e9", "99999999", "0", "0.0001", "NaN"]) {
      const response = await owner.post(`/api/bff/pantries/${seed.pantryId}/consume`, {
        headers: sameOriginHeaders(APP),
        data: { product_id: seed.productId, quantity },
      });
      expect(response.status(), quantity).toBe(400);
    }
  });

  test("XSS almacenado: un nombre de producto con HTML se muestra como texto", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: APP });
    const page = await context.newPage();
    await registerUser(page.request, APP, "xss");
    const payload = `<img src=x onerror="window.__xss=1">Pan<script>window.__xss=2</script>`;
    await seedPantry(page.request, APP, { productName: payload, daysToExpire: 1 });
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    for (const path of ["/", "/despensa"]) {
      await page.goto(path);
      await expect(page.getByText(payload, { exact: false }).first()).toBeVisible();
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      await expect(page.locator("img[src='x']")).toHaveCount(0);
    }
    expect(dialogs).toEqual([]);
    await context.close();
  });

  // ── A02/A07: secretos en el cliente ──────────────────────────────────────
  test("tokens: nunca en Web Storage, IndexedDB ni document.cookie; cookies HttpOnly+SameSite", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: APP });
    const page = await context.newPage();
    await registerUser(page.request, APP, "storage");
    const own = await seedPantry(page.request, APP);
    await page.goto("/despensa");
    await expect(page.getByText(own.productName).first()).toBeVisible();

    const cookies = await context.cookies();
    const sessionCookies = cookies.filter((cookie) => cookie.name.startsWith("despensa_"));
    expect(sessionCookies.map((c) => c.name).sort()).toEqual(
      expect.arrayContaining(["despensa_access_token", "despensa_refresh_token"]),
    );
    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Lax");
      expect(cookie.path).toBe("/");
    }
    const secrets = sessionCookies.map((cookie) => cookie.value).filter((value) => value.length > 16);

    const dump = await page.evaluate(async () => {
      const storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
      const databases = (await indexedDB.databases?.()) ?? [];
      let idb = "";
      for (const info of databases) {
        if (!info.name) continue;
        idb += await new Promise<string>((resolve) => {
          const open = indexedDB.open(info.name!);
          open.onsuccess = () => {
            const db = open.result;
            const names = [...db.objectStoreNames];
            if (names.length === 0) return resolve("");
            const tx = db.transaction(names, "readonly");
            const parts: string[] = [];
            let pending = names.length;
            for (const name of names) {
              const req = tx.objectStore(name).getAll();
              req.onsuccess = () => {
                parts.push(JSON.stringify(req.result));
                if (--pending === 0) resolve(parts.join(""));
              };
            }
          };
          open.onerror = () => resolve("");
        });
      }
      return { storage, idb, cookie: document.cookie };
    });
    for (const secret of secrets) {
      expect(dump.storage).not.toContain(secret);
      expect(dump.idb).not.toContain(secret);
      expect(dump.cookie).not.toContain(secret);
    }
    expect(dump.cookie).not.toMatch(/despensa_(access|refresh)_token/);
    await context.close();
  });

  test("logout borra outbox (IndexedDB) y estado persistido; la sesión queda revocada", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: APP });
    const page = await context.newPage();
    await registerUser(page.request, APP, "logout");
    await seedPantry(page.request, APP);
    await page.goto("/");
    await expect(page.getByText(/Hola,/).first()).toBeVisible();
    const me = (await (await page.request.get("/api/bff/auth/me")).json()) as { id: string };
    // Dexie crea la base al primer uso: espera a que exista el store antes de escribir.
    await page.waitForFunction(
      () =>
        new Promise<boolean>((resolve) => {
          const open = indexedDB.open("DespensaOfflineDB");
          open.onsuccess = () => {
            const ok = open.result.objectStoreNames.contains("outboxQueue");
            open.result.close();
            resolve(ok);
          };
          open.onerror = () => resolve(false);
        }),
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(async (userId) => {
      // Simula un conflicto del usuario actual en la outbox antes de cerrar sesión.
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("DespensaOfflineDB");
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("outboxQueue", "readwrite");
          tx.objectStore("outboxQueue").add({
            clientMutationId: "qa-logout-0001",
            endpoint: "/api/bff/pantries/00000000-0000-0000-0000-000000000000/consume",
            method: "POST",
            payload: {},
            pantryId: null,
            userId,
            kind: "consume",
            label: "QA · 1 l",
            status: "conflict",
            createdAt: new Date().toISOString(),
          });
          tx.oncomplete = () => {
            db.close(); // no bloquear las conexiones/upgrade de Dexie
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
    }, me.id);
    await page.getByRole("button", { name: /cerrar sesión/i }).first().click();
    // Con cambios sin sincronizar aparece la confirmación (M2b): se fuerza el cierre.
    const confirm = page.getByRole("dialog");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Cerrar sesión igualmente" }).click();
    await expect(page).toHaveURL(/\/login/);
    const leftovers = await page.evaluate(async () => {
      const count = await new Promise<number>((resolve) => {
        const open = indexedDB.open("DespensaOfflineDB");
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("outboxQueue")) return resolve(0);
          const req = db.transaction("outboxQueue").objectStore("outboxQueue").count();
          req.onsuccess = () => resolve(req.result);
        };
        open.onerror = () => resolve(0);
      });
      const ui = localStorage.getItem("despensa-ui-storage") ?? "";
      return { count, ui };
    });
    expect(leftovers.count).toBe(0);
    expect(leftovers.ui).not.toMatch(/"activePantryId":"[0-9a-f-]{36}"/);
    expect((await page.request.get("/api/bff/pantries")).status()).toBe(401);
    await context.close();
  });

  // ── A05 Security Misconfiguration ────────────────────────────────────────
  test("cabeceras de seguridad en páginas y no-store en respuestas del BFF", async () => {
    for (const path of ["/", "/despensa"]) {
      const response = await owner.get(path, { maxRedirects: 0 });
      const headers = response.headers();
      expect(headers["x-frame-options"], path).toBe("DENY");
      expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    }
    const data = await owner.get(`/api/bff/pantries/${seed.pantryId}/batches`);
    expect(data.headers()["cache-control"]).toContain("no-store");
    expect(data.headers()["x-correlation-id"]).toMatch(/^[0-9a-f-]{8,}/i);
  });

  test("errores sin fugas: ni stack traces ni URL interna del backend", async () => {
    const responses = await Promise.all([
      owner.get("/api/bff/pantries/not-a-uuid/batches"),
      intruder.get(`/api/bff/pantries/${seed.pantryId}/batches`),
      owner.post(`/api/bff/pantries/${seed.pantryId}/consume`, {
        headers: sameOriginHeaders(APP),
        data: "{not json",
      }),
    ]);
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toMatch(/Traceback|at [A-Za-z]+ \(|node_modules|\.py"/);
      expect(text).not.toContain(BACKEND_API_URL);
      expect(text).not.toMatch(/Bearer |eyJ[A-Za-z0-9_-]{10,}/);
    }
  });

  // ── Open redirect ────────────────────────────────────────────────────────
  test("open redirect: ?next= externo nunca sale del origen", async () => {
    for (const next of ["//evil.example", "https://evil.example", "/\\evil.example", "%2F%2Fevil.example"]) {
      const response = await owner.get(`/api/bff/auth/refresh?next=${encodeURIComponent(next)}`, {
        maxRedirects: 0,
        headers: { "Sec-Fetch-Site": "same-origin" },
      });
      const location = response.headers()["location"] ?? "";
      if (location) {
        expect(new URL(location, APP).origin, next).toBe(new URL(APP).origin);
      }
    }
  });
});
