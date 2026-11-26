import { afterEach, describe, expect, it, vi } from "vitest";
import { clearUserOfflineData, type ClearableOfflineDb } from "@/lib/offline/clear-user-data";

function createFakeDb({ pending = 0, failClear = false } = {}) {
  const count = vi.fn(async () => pending);
  const equals = vi.fn(() => ({ count }));
  const where = vi.fn(() => ({ equals }));
  const clearOutbox = vi.fn(async () => {
    if (failClear) throw new Error("idb bloqueada");
  });
  const clearLots = vi.fn(async () => undefined);
  const tables = [
    { name: "outboxQueue", clear: clearOutbox },
    { name: "offlineLots", clear: clearLots },
  ];
  const transaction = vi.fn(async (_mode: string, _tables: unknown, scope: () => Promise<void>) =>
    scope(),
  );
  const db = { tables, transaction, outboxQueue: { where } } as unknown as ClearableOfflineDb;
  return { db, where, equals, clearOutbox, clearLots, transaction };
}

function createFakeCaches(names: string[]) {
  return {
    keys: vi.fn(async () => names),
    delete: vi.fn(async (name: string) => name.length > 0),
  };
}

describe("clearUserOfflineData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("vacía todas las tablas de Dexie en una transacción rw", async () => {
    const fake = createFakeDb();
    const result = await clearUserOfflineData({ db: fake.db, cacheStorage: null });

    expect(fake.transaction).toHaveBeenCalledWith("rw", fake.db.tables, expect.any(Function));
    expect(fake.clearOutbox).toHaveBeenCalledOnce();
    expect(fake.clearLots).toHaveBeenCalledOnce();
    expect(result.clearedTables).toEqual(["outboxQueue", "offlineLots"]);
    expect(result.errors).toEqual([]);
  });

  it("avisa (console.warn) si hay mutaciones pending y las descarta", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = createFakeDb({ pending: 3 });

    const result = await clearUserOfflineData({ db: fake.db, cacheStorage: null });

    expect(fake.where).toHaveBeenCalledWith("status");
    expect(fake.equals).toHaveBeenCalledWith("pending");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("3 mutación(es) pendiente(s)"));
    expect(result.discardedPendingMutations).toBe(3);
    expect(fake.clearOutbox).toHaveBeenCalledOnce();
  });

  it("no avisa si la outbox no tiene pendientes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await clearUserOfflineData({ db: createFakeDb().db, cacheStorage: null });
    expect(warn).not.toHaveBeenCalled();
  });

  it("borra cachés con datos de usuario y conserva precache, assets y HTML público", async () => {
    const cacheStorage = createFakeCaches([
      "serwist-precache-v2-https://despensa.test/",
      "despensa-next-static",
      "despensa-static-images",
      "despensa-public-pages",
      "apis",
      "pages",
      "pages-rsc",
      "others",
      "despensa-api-data",
    ]);

    const result = await clearUserOfflineData({ db: createFakeDb().db, cacheStorage });

    expect(result.deletedCaches).toEqual(["apis", "pages", "pages-rsc", "others", "despensa-api-data"]);
    expect(cacheStorage.delete).toHaveBeenCalledTimes(5);
    expect(cacheStorage.delete).not.toHaveBeenCalledWith("serwist-precache-v2-https://despensa.test/");
    expect(cacheStorage.delete).not.toHaveBeenCalledWith("despensa-public-pages");
  });

  it("nunca lanza: un fallo de IndexedDB no impide limpiar las cachés", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cacheStorage = createFakeCaches(["apis"]);

    const result = await clearUserOfflineData({
      db: createFakeDb({ failClear: true }).db,
      cacheStorage,
    });

    expect(result.errors).toHaveLength(1);
    expect(result.clearedTables).toEqual([]);
    expect(result.deletedCaches).toEqual(["apis"]);
  });

  it("tolera la ausencia de Cache Storage (contexto no seguro)", async () => {
    const result = await clearUserOfflineData({ db: createFakeDb().db, cacheStorage: null });
    expect(result.deletedCaches).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
