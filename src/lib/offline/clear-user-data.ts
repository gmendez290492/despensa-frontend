import type { DespensaOfflineDB } from "@/lib/db/offline-db";
import { isPreservedCacheName } from "@/lib/offline/sw-routes";

/** Subconjunto de Dexie usado aquí (inyectable en tests). */
export type ClearableOfflineDb = Pick<DespensaOfflineDB, "tables" | "transaction" | "outboxQueue">;

/** Dependencias inyectables de {@link clearUserOfflineData}. */
export interface ClearUserOfflineDataOptions {
  /** Por defecto `offlineDb` (import dinámico: Dexie fuera del bundle inicial). */
  db?: ClearableOfflineDb;
  /** Por defecto `globalThis.caches`; `null` desactiva la limpieza de Cache Storage. */
  cacheStorage?: Pick<CacheStorage, "keys" | "delete"> | null;
}

/** Resumen de lo borrado por {@link clearUserOfflineData}. */
export interface ClearUserOfflineDataResult {
  /** Tablas de Dexie vaciadas. */
  clearedTables: string[];
  /** Mutaciones `pending` de la outbox descartadas. */
  discardedPendingMutations: number;
  /** Cachés de Cache Storage eliminadas. */
  deletedCaches: string[];
  errors: unknown[];
}

async function resolveDb(db: ClearableOfflineDb | undefined): Promise<ClearableOfflineDb> {
  if (db) return db;
  const { offlineDb } = await import("@/lib/db/offline-db");
  return offlineDb;
}

function resolveCacheStorage(
  cacheStorage: ClearUserOfflineDataOptions["cacheStorage"],
): Pick<CacheStorage, "keys" | "delete"> | null {
  if (cacheStorage !== undefined) return cacheStorage;
  return typeof globalThis.caches === "undefined" ? null : globalThis.caches;
}

/**
 * Cuenta las filas de la outbox que se perderían al cerrar sesión (cualquier
 * estado: `pending`, `syncing`, `conflict` o `failed`; todas se borran en
 * {@link clearUserOfflineData}). Nunca lanza: sin IndexedDB devuelve `0`.
 *
 * @param options.db - Base inyectable (tests); por defecto `offlineDb`.
 * @returns Número de cambios locales sin sincronizar.
 */
export async function countUnsyncedOutboxRecords(
  options: Pick<ClearUserOfflineDataOptions, "db"> = {},
): Promise<number> {
  try {
    const db = await resolveDb(options.db);
    return await db.outboxQueue.count();
  } catch {
    return 0;
  }
}

/**
 * Borra los datos locales ligados al usuario al cerrar sesión:
 *
 * - Todas las tablas de Dexie (`offlineDb`): outbox y, en el futuro, lotes e
 *   inventario offline. Otro usuario en el mismo dispositivo no debe verlos ni
 *   sincronizarlos con su sesión.
 * - Cachés de Cache Storage salvo el precache del app shell, los assets
 *   estáticos y el HTML público anónimo (ver `isPreservedCacheName`).
 *
 * Nunca lanza: los fallos se registran y se devuelven en `errors` para no
 * bloquear el logout.
 */
export async function clearUserOfflineData(
  options: ClearUserOfflineDataOptions = {},
): Promise<ClearUserOfflineDataResult> {
  const result: ClearUserOfflineDataResult = {
    clearedTables: [],
    discardedPendingMutations: 0,
    deletedCaches: [],
    errors: [],
  };

  try {
    const db = await resolveDb(options.db);
    const pending = await db.outboxQueue.where("status").equals("pending").count();
    if (pending > 0) {
      // Respaldo: `LogoutButton` ya pidió confirmación ("Tienes N cambios sin
      // sincronizar"). Si se llega aquí con pendientes (el usuario eligió
      // "Cerrar sesión igualmente" u otra vía de logout), se priorizan la
      // privacidad y la integridad entre usuarios: se descartan y se avisa.
      console.warn(
        `[offline] Cierre de sesión con ${pending} mutación(es) pendiente(s) en la outbox; se descartan.`,
      );
    }
    result.discardedPendingMutations = pending;

    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    result.clearedTables = db.tables.map((table) => table.name);
  } catch (error) {
    console.error("[offline] No se pudo limpiar IndexedDB al cerrar sesión", error);
    result.errors.push(error);
  }

  const cacheStorage = resolveCacheStorage(options.cacheStorage);
  if (cacheStorage) {
    try {
      const names = await cacheStorage.keys();
      const toDelete = names.filter((name) => !isPreservedCacheName(name));
      const outcomes = await Promise.allSettled(toDelete.map((name) => cacheStorage.delete(name)));
      outcomes.forEach((outcome, index) => {
        const name = toDelete[index]!;
        if (outcome.status === "fulfilled") result.deletedCaches.push(name);
        else result.errors.push(outcome.reason);
      });
    } catch (error) {
      console.error("[offline] No se pudo limpiar Cache Storage al cerrar sesión", error);
      result.errors.push(error);
    }
  }

  return result;
}
