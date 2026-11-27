import { afterEach, describe, expect, it, vi } from "vitest";
import { networkProblem, PROBLEM_TYPES, ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import type { OutboxMutationRecord } from "@/lib/db/offline-db";
import {
  drainOutbox,
  enqueueMutation,
  isExpiredOutboxConflict,
  isOutboxRecordExpired,
  isTransientError,
  OUTBOX_MAX_REPLAY_AGE_MS,
  outboxEntryExpiredProblem,
  renewedOutboxChanges,
  type OutboxSender,
  type OutboxStore,
} from "@/lib/offline/outbox";
import { normalizeOutboxEndpoint, sendOutboxRecord } from "@/features/pantry/hooks";

/**
 * Store en memoria con latencia asíncrona para exponer carreras: microtareas
 * por defecto, macrotareas (`setTimeout`) en las pruebas de concurrencia.
 */
function createMemoryStore({ macrotask = false } = {}) {
  const rows = new Map<number, OutboxMutationRecord>();
  let nextId = 1;
  const tick = () =>
    new Promise<void>((resolve) => (macrotask ? setTimeout(resolve, 0) : queueMicrotask(resolve)));
  const store: OutboxStore = {
    add: async (record) => {
      await tick();
      const id = nextId++;
      rows.set(id, structuredClone({ ...record, id }));
      return id;
    },
    listPending: async () => {
      await tick();
      return [...rows.values()].filter((row) => row.status === "pending").sort((a, b) => a.id! - b.id!).map((row) => structuredClone(row));
    },
    listSyncing: async () => {
      await tick();
      return [...rows.values()].filter((row) => row.status === "syncing").map((row) => structuredClone(row));
    },
    claim: async (id, changes) => {
      await tick();
      const row = rows.get(id);
      if (!row || row.status !== "pending") return false;
      rows.set(id, { ...row, ...changes });
      return true;
    },
    update: async (id, changes) => {
      await tick();
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, ...changes });
    },
    remove: async (id) => {
      await tick();
      rows.delete(id);
    },
    purgeForeign: async (userId) => {
      await tick();
      let removed = 0;
      for (const [id, row] of rows) {
        if (row.userId !== userId) {
          rows.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
    count: async () => {
      await tick();
      return rows.size;
    },
  };
  return { store, rows };
}

const PANTRY = "11111111-1111-4111-8111-111111111111";
const USER = "user-a";
const OTHER_USER = "user-b";

function enqueueConsume(store: OutboxStore, index: number, userId = USER) {
  return enqueueMutation(store, {
    clientMutationId: `cmid-${index}`,
    userId,
    endpoint: `/api/bff/pantries/${PANTRY}/consume`,
    payload: { product_id: "p", quantity: String(index) },
    pantryId: PANTRY,
    kind: "consume",
    label: `Leche · ${index}`,
  });
}

function problem(status: number, slug: string, extra: Partial<ConstructorParameters<typeof ProblemDetailError>[0]> = {}) {
  return new ProblemDetailError({ type: problemTypeUri(slug), title: "x", status, ...extra });
}

const recorder = () => {
  const sent: string[] = [];
  const send: OutboxSender = async (record) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    sent.push(record.clientMutationId);
  };
  return { sent, send };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("enqueueMutation", () => {
  it("guarda la fila como pending con attempts 0 y timestamps del reloj inyectado", async () => {
    const { store, rows } = createMemoryStore();
    const now = () => new Date("2026-11-26T10:00:00.000Z");
    const id = await enqueueMutation(
      store,
      { clientMutationId: "a", userId: USER, endpoint: "/api/bff/x", payload: {}, pantryId: null, kind: "consume", label: "L" },
      now,
    );
    expect(rows.get(id)).toMatchObject({
      userId: USER,
      status: "pending",
      method: "POST",
      attempts: 0,
      lastError: null,
      createdAt: "2026-11-26T10:00:00.000Z",
      updatedAt: "2026-11-26T10:00:00.000Z",
    });
  });
});

describe("drainOutbox", () => {
  it("envía en orden FIFO y borra las filas confirmadas", async () => {
    const { store, rows } = createMemoryStore();
    for (let i = 1; i <= 5; i++) await enqueueConsume(store, i);
    const { sent, send } = recorder();

    const result = await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual(["cmid-1", "cmid-2", "cmid-3", "cmid-4", "cmid-5"]);
    expect(result).toMatchObject({ ran: true, synced: 5, conflicts: 0, stoppedEarly: false, touchedPantryIds: [PANTRY] });
    expect(rows.size).toBe(0);
  });

  it("marca conflict con lastError ante 400 insufficient-stock y sigue con las demás", async () => {
    const { store, rows } = createMemoryStore();
    for (let i = 1; i <= 3; i++) await enqueueConsume(store, i);
    const onConflict = vi.fn();
    const sent: string[] = [];
    const send: OutboxSender = async (record) => {
      if (record.clientMutationId === "cmid-2") {
        throw problem(400, PROBLEM_TYPES.insufficientStock, { detail: "Disponible: 0", correlation_id: "corr-1" });
      }
      sent.push(record.clientMutationId);
    };

    const result = await drainOutbox({ store, userId: USER, send, onConflict });

    expect(sent).toEqual(["cmid-1", "cmid-3"]);
    expect(result).toMatchObject({ synced: 2, conflicts: 1, stoppedEarly: false });
    const [conflict] = [...rows.values()];
    expect(rows.size).toBe(1);
    expect(conflict).toMatchObject({ clientMutationId: "cmid-2", status: "conflict", attempts: 1 });
    expect(conflict!.lastError).toMatchObject({
      type: problemTypeUri(PROBLEM_TYPES.insufficientStock),
      status: 400,
      detail: "Disponible: 0",
      correlation_id: "corr-1",
    });
    expect(onConflict).toHaveBeenCalledOnce();
  });

  it.each([
    ["red", () => networkProblem()],
    ["503", () => problem(503, PROBLEM_TYPES.backendUnavailable)],
    ["401", () => problem(401, PROBLEM_TYPES.invalidToken)],
    ["429", () => problem(429, PROBLEM_TYPES.rateLimitExceeded, { retry_after: 12 })],
    ["409 idempotency-request-in-progress", () => problem(409, PROBLEM_TYPES.idempotencyRequestInProgress, { retry_after: 3 })],
  ])("un error transitorio (%s) detiene el drenado y conserva el orden", async (_name, makeError) => {
    const { store, rows } = createMemoryStore();
    for (let i = 1; i <= 4; i++) await enqueueConsume(store, i);
    const sent: string[] = [];
    let fail = true;
    const send: OutboxSender = async (record) => {
      if (record.clientMutationId === "cmid-2" && fail) throw makeError();
      sent.push(record.clientMutationId);
    };

    const first = await drainOutbox({ store, userId: USER, send });
    expect(first).toMatchObject({ synced: 1, conflicts: 0, stoppedEarly: true });
    expect(sent).toEqual(["cmid-1"]);
    const remaining = [...rows.values()].sort((a, b) => a.id! - b.id!);
    expect(remaining.map((row) => [row.clientMutationId, row.status])).toEqual([
      ["cmid-2", "pending"],
      ["cmid-3", "pending"],
      ["cmid-4", "pending"],
    ]);
    expect(remaining[0]!.lastError).not.toBeNull();
    expect(remaining[0]!.attempts).toBe(1);

    fail = false;
    const second = await drainOutbox({ store, userId: USER, send });
    expect(second).toMatchObject({ synced: 3, stoppedEarly: false });
    expect(sent).toEqual(["cmid-1", "cmid-2", "cmid-3", "cmid-4"]);
  });

  it("propaga Retry-After del error transitorio (409 en curso)", async () => {
    const { store } = createMemoryStore();
    await enqueueConsume(store, 1);
    const result = await drainOutbox({
      store,
      userId: USER,
      send: async () => {
        throw problem(409, PROBLEM_TYPES.idempotencyRequestInProgress, { retry_after: 7 });
      },
    });
    expect(result).toMatchObject({ stoppedEarly: true, retryAfterSeconds: 7 });
  });

  it("422 idempotency-key-reused es conflicto, no transitorio", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1);
    const result = await drainOutbox({
      store,
      userId: USER,
      send: async () => {
        throw problem(422, PROBLEM_TYPES.idempotencyKeyReused);
      },
    });
    expect(result).toMatchObject({ conflicts: 1, stoppedEarly: false });
    expect([...rows.values()][0]!.status).toBe("conflict");
  });

  it("reintenta las filas huérfanas en syncing antes que las nuevas", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1);
    await enqueueConsume(store, 2);
    await store.update(1, { status: "syncing", attempts: 1 });
    const { sent, send } = recorder();

    const result = await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual(["cmid-1", "cmid-2"]);
    expect(result.synced).toBe(2);
    expect(rows.size).toBe(0);
  });

  it("no envía una fila borrada a mitad de drenado (logout / descarte)", async () => {
    const { store, rows } = createMemoryStore();
    for (let i = 1; i <= 3; i++) await enqueueConsume(store, i);
    const sent: string[] = [];
    const send: OutboxSender = async (record) => {
      sent.push(record.clientMutationId);
      if (record.clientMutationId === "cmid-1") rows.clear(); // clearUserOfflineData
    };

    const result = await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual(["cmid-1"]);
    expect(result.synced).toBe(1);
  });

  it("50 llamadas concurrentes: cada fila se envía exactamente una vez y en orden", async () => {
    const { store, rows } = createMemoryStore({ macrotask: true });
    for (let i = 1; i <= 20; i++) await enqueueConsume(store, i);
    const { sent, send } = recorder();

    const results = await Promise.all(Array.from({ length: 50 }, () => drainOutbox({ store, userId: USER, send })));

    expect(results.filter((result) => result.ran)).toHaveLength(1);
    expect(results.reduce((acc, result) => acc + result.synced, 0)).toBe(20);
    expect(sent).toEqual(Array.from({ length: 20 }, (_, i) => `cmid-${i + 1}`));
    expect(rows.size).toBe(0);
  });

  it("una fila encolada durante el drenado se envía en ese mismo drenado", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1);
    const sent: string[] = [];
    const send: OutboxSender = async (record) => {
      if (record.clientMutationId === "cmid-1") {
        await enqueueConsume(store, 2);
        void drainOutbox({ store, userId: USER, send }); // se fusiona con el drenado en curso
      }
      sent.push(record.clientMutationId);
    };

    const result = await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual(["cmid-1", "cmid-2"]);
    expect(result.synced).toBe(2);
    expect(rows.size).toBe(0);
  });

  it("con Web Locks, dos 'pestañas' (módulos distintos) se serializan sin duplicados", async () => {
    // Fake de navigator.locks: cola exclusiva por nombre.
    const queues = new Map<string, Promise<unknown>>();
    const request = vi.fn((name: string, callback: () => Promise<unknown>) => {
      const previous = queues.get(name) ?? Promise.resolve();
      const next = previous.then(() => callback());
      queues.set(name, next.catch(() => undefined));
      return next;
    });
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });

    vi.resetModules();
    const tabA = await import("@/lib/offline/outbox");
    vi.resetModules();
    const tabB = await import("@/lib/offline/outbox");
    expect(tabA.drainOutbox).not.toBe(tabB.drainOutbox);

    const { store, rows } = createMemoryStore({ macrotask: true });
    for (let i = 1; i <= 10; i++) await enqueueConsume(store, i);
    const { sent, send } = recorder();

    const results = await Promise.all([
      ...Array.from({ length: 25 }, () => tabA.drainOutbox({ store, userId: USER, send })),
      ...Array.from({ length: 25 }, () => tabB.drainOutbox({ store, userId: USER, send })),
    ]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0]).toBe(tabA.OUTBOX_LOCK_NAME);
    expect(results.reduce((acc, result) => acc + result.synced, 0)).toBe(10);
    expect(sent).toEqual(Array.from({ length: 10 }, (_, i) => `cmid-${i + 1}`));
    expect(rows.size).toBe(0);
  });

  it("solo envía las filas del usuario autenticado y borra las de otros (o sin userId)", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1, OTHER_USER);
    await enqueueConsume(store, 2);
    await enqueueConsume(store, 3, OTHER_USER);
    await store.update(3, { status: "conflict" });
    const legacy = await enqueueConsume(store, 4);
    await store.update(legacy, { userId: undefined }); // fila v1 sin dueño
    await enqueueConsume(store, 5);
    const { sent, send } = recorder();

    const result = await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual(["cmid-2", "cmid-5"]);
    expect(result).toMatchObject({ synced: 2, purgedForeign: 3, unauthorized: false });
    expect(rows.size).toBe(0);
  });

  it("no envía una fila ajena encolada después de la purga", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1);
    const sent: string[] = [];
    const send: OutboxSender = async (record) => {
      if (record.clientMutationId === "cmid-1") await enqueueConsume(store, 2, OTHER_USER);
      sent.push(record.clientMutationId);
    };

    await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual(["cmid-1"]);
    expect([...rows.values()].map((row) => [row.clientMutationId, row.status])).toEqual([["cmid-2", "pending"]]);
  });

  it("un 401 detiene el drenado con unauthorized y conserva la fila pending", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1);
    await enqueueConsume(store, 2);
    const send = vi.fn<OutboxSender>(async () => {
      throw problem(401, PROBLEM_TYPES.invalidToken);
    });

    const result = await drainOutbox({ store, userId: USER, send });

    expect(send).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ stoppedEarly: true, unauthorized: true, synced: 0 });
    expect([...rows.values()].map((row) => row.status)).toEqual(["pending", "pending"]);
  });

  it("una fila huérfana syncing de otro usuario no se reintenta: se borra", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1, OTHER_USER);
    await store.update(1, { status: "syncing" });
    const { sent, send } = recorder();

    const result = await drainOutbox({ store, userId: USER, send });

    expect(sent).toEqual([]);
    expect(result.purgedForeign).toBe(1);
    expect(rows.size).toBe(0);
  });

  it("drena 500 mutaciones encoladas en orden estricto", async () => {
    const { store, rows } = createMemoryStore();
    for (let i = 1; i <= 500; i++) await enqueueConsume(store, i);
    const sent: string[] = [];

    const result = await drainOutbox({
      store,
      userId: USER,
      send: async (record) => {
        sent.push(record.clientMutationId);
      },
    });

    expect(result.synced).toBe(500);
    expect(sent).toEqual(Array.from({ length: 500 }, (_, i) => `cmid-${i + 1}`));
    expect(rows.size).toBe(0);
  }, 20_000);
});

describe("isTransientError", () => {
  it.each([
    [networkProblem(), true],
    [problem(500, "x"), true],
    [problem(502, PROBLEM_TYPES.backendUnavailable), true],
    [problem(401, PROBLEM_TYPES.invalidToken), true],
    [problem(408, "x"), true],
    [problem(429, PROBLEM_TYPES.rateLimitExceeded), true],
    [problem(409, PROBLEM_TYPES.idempotencyRequestInProgress), true],
    [problem(400, PROBLEM_TYPES.insufficientStock), false],
    [problem(403, PROBLEM_TYPES.pantryAccessDenied), false],
    [problem(404, PROBLEM_TYPES.productNotFound), false],
    [problem(409, "otro-conflicto"), false],
    [problem(422, PROBLEM_TYPES.idempotencyKeyReused), false],
    [problem(400, PROBLEM_TYPES.invalidIdempotencyKey), false],
    // Bug de cliente: no se reintenta aunque llegue con un status "transitorio".
    [problem(503, PROBLEM_TYPES.invalidIdempotencyKey), false],
    [new Error("boom"), true],
  ])("%o → %s", (error, expected) => {
    expect(isTransientError(error)).toBe(expected);
  });
});

describe("sendOutboxRecord", () => {
  const base: OutboxMutationRecord = {
    id: 1,
    clientMutationId: "cmid-x",
    endpoint: `/api/bff/pantries/${PANTRY}/consume`,
    method: "POST",
    payload: { product_id: "p", quantity: "1" },
    pantryId: PANTRY,
    userId: USER,
    kind: "consume",
    status: "syncing",
    createdAt: "2026-11-26T00:00:00Z",
  };

  it.each([
    "https://evil.example/api/bff/x",
    "//evil.example/api/bff/x",
    "/api/v1/pantries/x/consume",
    "/api/bff/../v1/pantries/x/consume",
    "/api/bff/%2e%2e/v1/x",
    "/api/bff/auth/logout",
    "/api/bff\\..\\v1",
    "api/bff/x",
    // B1: `next start` responde 308 a la ruta sin `//` y fetch lo seguiría.
    "/api/bff//auth/logout",
    "/api/bff/pantries//consume",
    `/api/bff/pantries/${PANTRY}//consume`,
    // Allowlist por kind: solo `/api/bff/pantries/<uuid>/consume` exacto.
    "/api/bff/pantries",
    `/api/bff/pantries/${PANTRY}/batches`,
    `/api/bff/pantries/${PANTRY}/consume?x=1`,
    `/api/bff/pantries/${PANTRY}/consume/`,
    `/api/bff/pantries/${PANTRY}/x/../consume`,
    "/api/bff/pantries/not-a-uuid/consume",
    "/api/bff/notifications",
  ])("rechaza %s como conflicto 400 (no transitorio) sin llamar a fetch", async (endpoint) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await sendOutboxRecord({ ...base, endpoint }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProblemDetailError);
    expect((error as ProblemDetailError).status).toBe(400);
    expect(isTransientError(error)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "desconocido" }],
    [{ kind: undefined }],
    [{ kind: "toString" }],
    [{ kind: "create-batch" }],
    [{ method: "PATCH" as const }],
  ])("rechaza una fila cuyo kind/método no casa con el destino (%o)", async (overrides) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const error = await sendOutboxRecord({ ...base, ...overrides }).catch((caught: unknown) => caught);
    expect((error as ProblemDetailError).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("acepta create-batch hacia /batches", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendOutboxRecord({ ...base, kind: "create-batch", endpoint: `/api/bff/pantries/${PANTRY}/batches` });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("nunca sigue redirecciones: redirect manual y un 3xx/opaqueredirect es conflicto", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 308, headers: { Location: "/api/bff/auth/logout" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await sendOutboxRecord(base).catch((caught: unknown) => caught);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect((error as ProblemDetailError).status).toBe(400);
    expect(isTransientError(error)).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rechaza métodos no permitidos", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const record = { ...base, method: "GET" } as unknown as OutboxMutationRecord;
    await expect(sendOutboxRecord(record)).rejects.toBeInstanceOf(ProblemDetailError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envía al BFF con Idempotency-Key y cuerpo JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendOutboxRecord(base);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe(base.endpoint);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("cmid-x");
    expect(init.body).toBe(JSON.stringify(base.payload));
  });

  it("un 400 insufficient-stock repetido (Idempotent-Replayed) sigue siendo conflicto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ type: problemTypeUri(PROBLEM_TYPES.insufficientStock), title: "Bad Request", status: 400 }),
            { status: 400, headers: { "Content-Type": "application/problem+json", "Idempotent-Replayed": "true" } },
          ),
      ),
    );
    const error = await sendOutboxRecord(base).catch((caught: unknown) => caught);
    expect((error as ProblemDetailError).is(PROBLEM_TYPES.insufficientStock)).toBe(true);
    expect(isTransientError(error)).toBe(false);
  });

  it("un 409 idempotency-request-in-progress con Retry-After es transitorio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ type: problemTypeUri(PROBLEM_TYPES.idempotencyRequestInProgress), title: "Conflict", status: 409 }),
            { status: 409, headers: { "Content-Type": "application/problem+json", "Retry-After": "2" } },
          ),
      ),
    );
    const error = await sendOutboxRecord(base).catch((caught: unknown) => caught);
    expect(isTransientError(error)).toBe(true);
    expect((error as ProblemDetailError).retry_after).toBe(2);
  });

  it("normalizeOutboxEndpoint conserva la query y normaliza segmentos internos", () => {
    expect(normalizeOutboxEndpoint("/api/bff/pantries/a/../b/consume?x=1")).toBe("/api/bff/pantries/b/consume?x=1");
  });

  it("normalizeOutboxEndpoint rechaza segmentos vacíos (//) en el pathname", () => {
    expect(normalizeOutboxEndpoint("/api/bff//auth/logout")).toBeNull();
    expect(normalizeOutboxEndpoint("/api/bff/pantries//x")).toBeNull();
  });
});

describe("TTL de Idempotency-Key (168 h en FastAPI)", () => {
  const NOW = new Date("2026-12-10T12:00:00.000Z");
  const now = () => NOW;
  const ago = (ms: number) => () => new Date(NOW.getTime() - ms);
  const HOUR = 3_600_000;

  const enqueueAt = (store: OutboxStore, clientMutationId: string, createdAgoMs: number) =>
    enqueueMutation(
      store,
      {
        clientMutationId,
        userId: USER,
        endpoint: `/api/bff/pantries/${PANTRY}/consume`,
        payload: { product_id: "p", quantity: "1" },
        pantryId: PANTRY,
        kind: "consume",
        label: "Leche · 1 l",
      },
      ago(createdAgoMs),
    );

  it("OUTBOX_MAX_REPLAY_AGE_MS es 6 d 20 h (4 h de margen bajo las 168 h)", () => {
    expect(OUTBOX_MAX_REPLAY_AGE_MS).toBe((6 * 24 + 20) * HOUR);
    expect(168 * HOUR - OUTBOX_MAX_REPLAY_AGE_MS).toBe(4 * HOUR);
  });

  it("isOutboxRecordExpired: umbral exclusivo y createdAt ilegible cuenta como caducado", () => {
    const at = (ms: number) => ({ createdAt: new Date(NOW.getTime() - ms).toISOString() });
    expect(isOutboxRecordExpired(at(OUTBOX_MAX_REPLAY_AGE_MS), NOW.getTime())).toBe(false);
    expect(isOutboxRecordExpired(at(OUTBOX_MAX_REPLAY_AGE_MS + 1), NOW.getTime())).toBe(true);
    expect(isOutboxRecordExpired({ createdAt: "no-es-fecha" }, NOW.getTime())).toBe(true);
  });

  it("no reenvía una fila caducada: pasa a conflict outbox-entry-expired y sigue con las demás", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueAt(store, "cmid-old", 7 * 24 * HOUR);
    await enqueueAt(store, "cmid-fresh", OUTBOX_MAX_REPLAY_AGE_MS - 60_000);
    const { sent, send } = recorder();
    const onConflict = vi.fn();

    const result = await drainOutbox({ store, userId: USER, send, now, onConflict });

    expect(sent).toEqual(["cmid-fresh"]);
    expect(result).toMatchObject({
      synced: 1,
      conflicts: 1,
      expired: 1,
      stoppedEarly: false,
      touchedPantryIds: [PANTRY],
    });
    expect(rows.size).toBe(1);
    const row = rows.get(1)!;
    expect(row).toMatchObject({ clientMutationId: "cmid-old", status: "conflict", attempts: 0 });
    expect(row.lastError).toEqual(outboxEntryExpiredProblem());
    expect(row.lastError).toMatchObject({
      type: problemTypeUri(PROBLEM_TYPES.outboxEntryExpired),
      status: 0,
      detail: expect.stringMatching(/más de 7 días sin sincronizar; confirma si quieres reenviarlo/),
    });
    expect(isExpiredOutboxConflict(row)).toBe(true);
    expect(onConflict).toHaveBeenCalledOnce();

    // Un drenado posterior tampoco la reenvía: sigue esperando al usuario.
    await drainOutbox({ store, userId: USER, send, now });
    expect(sent).toEqual(["cmid-fresh"]);
  });

  it("una fila huérfana syncing antigua tampoco se reenvía", async () => {
    const { store, rows } = createMemoryStore();
    await enqueueAt(store, "cmid-orphan", 8 * 24 * HOUR);
    await store.update(1, { status: "syncing", attempts: 3 });
    const { sent, send } = recorder();

    const result = await drainOutbox({ store, userId: USER, send, now });

    expect(sent).toEqual([]);
    expect(result).toMatchObject({ expired: 1, conflicts: 1 });
    expect(rows.get(1)).toMatchObject({ status: "conflict", attempts: 3 });
    expect(isExpiredOutboxConflict(rows.get(1)!)).toBe(true);
  });

  it("isExpiredOutboxConflict solo reconoce conflictos por caducidad", () => {
    expect(isExpiredOutboxConflict({ status: "conflict", lastError: outboxEntryExpiredProblem() })).toBe(true);
    expect(isExpiredOutboxConflict({ status: "pending", lastError: outboxEntryExpiredProblem() })).toBe(false);
    expect(
      isExpiredOutboxConflict({
        status: "conflict",
        lastError: { type: problemTypeUri(PROBLEM_TYPES.insufficientStock), title: "x", status: 400 },
      }),
    ).toBe(false);
    expect(isExpiredOutboxConflict({ status: "conflict", lastError: null })).toBe(false);
  });

  it("renewedOutboxChanges: clave nueva, createdAt actual, pending y contadores a cero", () => {
    expect(renewedOutboxChanges("cmid-new", NOW)).toEqual({
      clientMutationId: "cmid-new",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      status: "pending",
      attempts: 0,
      lastError: null,
    });
  });
});

describe("errores de Idempotency-Key del cliente (bug, no se reintentan)", () => {
  it.each([
    [400, PROBLEM_TYPES.invalidIdempotencyKey],
    [422, PROBLEM_TYPES.idempotencyKeyReused],
  ])("%i %s → conflict sin reintento y console.warn con correlation_id", async (status, slug) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 1);
    await enqueueConsume(store, 2);
    const sent: string[] = [];
    const send: OutboxSender = async (record) => {
      if (record.clientMutationId === "cmid-1") throw problem(status, slug, { correlation_id: "corr-idem-1" });
      sent.push(record.clientMutationId);
    };

    const result = await drainOutbox({ store, userId: USER, send });

    expect(result).toMatchObject({ synced: 1, conflicts: 1, stoppedEarly: false });
    expect(sent).toEqual(["cmid-2"]);
    expect(rows.get(1)).toMatchObject({ status: "conflict", attempts: 1 });
    expect(warn).toHaveBeenCalledOnce();
    const [message, context] = warn.mock.calls[0]!;
    expect(message).toMatch(/Idempotency-Key/);
    expect(context).toMatchObject({ error_type: slug, status, correlation_id: "corr-idem-1", kind: "consume" });
    // No se registran datos del usuario (label/cuerpo).
    expect(JSON.stringify(context)).not.toMatch(/Leche/);

    // Un segundo drenado no la reenvía.
    await drainOutbox({ store, userId: USER, send });
    expect(sent).toEqual(["cmid-2"]);
  });

  it("un conflicto de negocio (insufficient-stock) no emite console.warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store } = createMemoryStore();
    await enqueueConsume(store, 1);
    await drainOutbox({
      store,
      userId: USER,
      send: async () => {
        throw problem(400, PROBLEM_TYPES.insufficientStock);
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("respuesta perdida: FastAPI aplica la operación pero el cliente no recibe la respuesta", () => {
  /**
   * FastAPI idempotente en memoria: deduplica por `Idempotency-Key`, cuenta
   * efectos por clave y responde `Idempotent-Replayed: true` al repetir. La
   * primera respuesta se "pierde" (error de red tras aplicar el efecto).
   */
  function createIdempotentServer() {
    const results = new Map<string, { body: string; response: unknown }>();
    const effects = new Map<string, number>();
    let stock = 10;
    let dropNextResponse = true;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const key = new Headers(init?.headers).get("Idempotency-Key")!;
      const body = String(init?.body);
      const previous = results.get(key);
      if (previous) {
        if (previous.body !== body) {
          return new Response(
            JSON.stringify({ type: problemTypeUri(PROBLEM_TYPES.idempotencyKeyReused), title: "x", status: 422 }),
            { status: 422, headers: { "Content-Type": "application/problem+json" } },
          );
        }
        return new Response(JSON.stringify(previous.response), {
          status: 200,
          headers: { "Content-Type": "application/json", "Idempotent-Replayed": "true" },
        });
      }
      stock -= Number((JSON.parse(body) as { quantity: string }).quantity);
      effects.set(key, (effects.get(key) ?? 0) + 1);
      const response = { remaining_stock: String(stock) };
      results.set(key, { body, response });
      if (dropNextResponse) {
        dropNextResponse = false;
        throw new TypeError("Failed to fetch");
      }
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    return { fetchMock, effects, stock: () => stock };
  }

  it("el reenvío con la misma clave devuelve 200 replayed y la fila se borra sin duplicar el efecto", async () => {
    const server = createIdempotentServer();
    vi.stubGlobal("fetch", server.fetchMock);
    const { store, rows } = createMemoryStore();
    await enqueueConsume(store, 3);

    const first = await drainOutbox({ store, userId: USER, send: sendOutboxRecord });
    expect(first).toMatchObject({ synced: 0, conflicts: 0, stoppedEarly: true });
    expect(rows.get(1)).toMatchObject({ clientMutationId: "cmid-3", status: "pending", attempts: 1 });
    expect(server.effects.get("cmid-3")).toBe(1);

    const second = await drainOutbox({ store, userId: USER, send: sendOutboxRecord });
    expect(second).toMatchObject({ synced: 1, conflicts: 0, stoppedEarly: false });
    expect(rows.size).toBe(0);

    expect(server.fetchMock).toHaveBeenCalledTimes(2);
    const replayed = (await server.fetchMock.mock.results[1]!.value) as Response;
    expect(replayed.headers.get("Idempotent-Replayed")).toBe("true");
    for (const [, init] of server.fetchMock.mock.calls) {
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("cmid-3");
    }
    expect(server.effects.get("cmid-3")).toBe(1);
    expect(server.stock()).toBe(7);
  });
});
