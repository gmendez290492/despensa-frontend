import Dexie, { type EntityTable } from "dexie";
import type { ProblemDetail } from "@/lib/api/problem";

/**
 * Estado de una mutación en la outbox: `pending` → `syncing` → (borrada | `conflict`
 * si FastAPI responde un error de negocio RFC 7807 | `failed`).
 */
export type OutboxMutationStatus = "pending" | "syncing" | "conflict" | "failed";

/** Fila de la tabla `outboxQueue` (patrón Client Outbox). */
export interface OutboxMutationRecord {
  id?: number;
  clientMutationId: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: unknown;
  pantryId: string | null;
  status: OutboxMutationStatus;
  createdAt: string;
  /** Último error RFC 7807 al sincronizar (tipo compartido de `@/lib/api/problem`). */
  lastError?: ProblemDetail | null;
}

/**
 * Base IndexedDB de la app (Dexie). Al añadir tablas, sube `version()` y
 * declara la migración; `clearUserOfflineData` vacía todas al cerrar sesión.
 */
export class DespensaOfflineDB extends Dexie {
  outboxQueue!: EntityTable<OutboxMutationRecord, "id">;

  constructor() {
    super("DespensaOfflineDB");
    this.version(1).stores({
      outboxQueue: "++id, clientMutationId, status, pantryId, createdAt",
    });
  }
}

/** Instancia única de {@link DespensaOfflineDB}. Impórtala dinámicamente para no cargar Dexie en el bundle inicial. */
export const offlineDb = new DespensaOfflineDB();
