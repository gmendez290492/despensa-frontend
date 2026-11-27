import Dexie, { type EntityTable } from "dexie";
import type { ProblemDetail } from "@/lib/api/problem";

/**
 * Estado de una mutación en la outbox: `pending` → `syncing` → (borrada | `conflict`
 * si FastAPI responde un error de negocio RFC 7807 | `failed`).
 */
export type OutboxMutationStatus = "pending" | "syncing" | "conflict" | "failed";

/**
 * Fila de la tabla `outboxQueue` (patrón Client Outbox).
 *
 * @remarks El `clientMutationId` viaja como `Idempotency-Key`. La rama
 * `feature/pantry-idempotency-issue-11` de FastAPI ya deduplica por
 * `(user_id, key)`, pero hasta que se fusione despensa-backend#11 un reintento
 * tras perder la respuesta puede duplicar el efecto en el backend desplegado.
 *
 * `payload` se guarda en claro en IndexedDB. Los consumos encolados **sin
 * haber llegado a enviarse** no guardan `notes` (texto libre); solo se
 * conserva si la petición ya salió hacia FastAPI, porque el reintento debe
 * llevar exactamente el mismo cuerpo que la clave (si no, `422
 * idempotency-key-reused`). La base se vacía al cerrar sesión y las filas de
 * otros usuarios se borran al drenar.
 */
export interface OutboxMutationRecord {
  id?: number;
  clientMutationId: string;
  /**
   * Usuario que encoló la mutación (`UserResponse.id`). Opcional solo por las
   * filas de la v1 de la base, que se tratan como ajenas y se borran.
   */
  userId?: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: unknown;
  pantryId: string | null;
  status: OutboxMutationStatus;
  createdAt: string;
  /** Último error RFC 7807 al sincronizar (tipo compartido de `@/lib/api/problem`). */
  lastError?: ProblemDetail | null;
  /** Tipo de operación de dominio (p. ej. `"consume"`), para la UI y métricas. */
  kind?: string;
  /** Descripción legible para el usuario ("Leche · 1 l"). Nunca datos sensibles. */
  label?: string;
  /** Intentos de envío realizados. */
  attempts?: number;
  /** Última transición de estado (ISO 8601). */
  updatedAt?: string;
}

/**
 * Base IndexedDB de la app (Dexie). Al añadir tablas o índices, sube
 * `version()` y declara la migración; `clearUserOfflineData` vacía todas al
 * cerrar sesión.
 *
 * - v1: `outboxQueue` (`++id, clientMutationId, status, pantryId, createdAt`).
 * - v2: índice `userId` (la outbox queda ligada al usuario). Sin `upgrade()`:
 *   las filas v1 no tienen dueño y el siguiente drenado las borra
 *   (`purgeForeign`) en lugar de enviarlas con la sesión de quien esté
 *   autenticado.
 *
 * En tests se usa con `fake-indexeddb` (`import "fake-indexeddb/auto"` antes
 * de importar Dexie) y un nombre de base propio por prueba.
 */
export class DespensaOfflineDB extends Dexie {
  outboxQueue!: EntityTable<OutboxMutationRecord, "id">;

  /**
   * @param name - Nombre de la base IndexedDB (inyectable en tests con `fake-indexeddb`).
   */
  constructor(name = "DespensaOfflineDB") {
    super(name);
    this.version(1).stores({
      outboxQueue: "++id, clientMutationId, status, pantryId, createdAt",
    });
    this.version(2).stores({
      outboxQueue: "++id, clientMutationId, status, pantryId, createdAt, userId",
    });
  }
}

/** Instancia única de {@link DespensaOfflineDB}. Impórtala dinámicamente para no cargar Dexie en el bundle inicial. */
export const offlineDb = new DespensaOfflineDB();
