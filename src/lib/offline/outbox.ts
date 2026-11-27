import {
  isProblemDetailError,
  PROBLEM_TYPES,
  problemSlug,
  problemTypeUri,
  type ProblemDetail,
} from "@/lib/api/problem";
import type { OutboxMutationRecord } from "@/lib/db/offline-db";

/**
 * Patrón *Client Outbox* (skill `offline-outbox-mutation`): las escrituras
 * hechas sin red se guardan en IndexedDB (`offlineDb.outboxQueue`) y se
 * reenvían en orden FIFO (`id` autoincremental) al recuperar conexión.
 *
 * - Cada fila lleva un `clientMutationId` que viaja como `Idempotency-Key`:
 *   FastAPI deduplica por `(user_id, key)` (despensa-backend#14), así que un
 *   reintento tras perder la respuesta no duplica el efecto.
 * - Las claves caducan en FastAPI a las 168 h (`IDEMPOTENCY_KEY_TTL_HOURS`):
 *   pasado ese plazo la misma clave **se ejecuta otra vez**. Por eso una fila
 *   más antigua que {@link OUTBOX_MAX_REPLAY_AGE_MS} no se reenvía sola: pasa
 *   a `conflict` (`outbox-entry-expired`) y el usuario decide si reenviarla
 *   como operación nueva (`retryExpiredOutboxRecord` en `@/features/pantry/hooks`).
 * - Cada fila pertenece a un usuario (`userId`, el de `GET /api/bff/auth/me`
 *   al encolar). El drenado recibe el usuario **autenticado ahora** y:
 *   - solo envía sus filas (la cookie de sesión decide a quién se atribuye la
 *     mutación; el backend acota la clave por `(user_id, key)`);
 *   - **borra** las filas de cualquier otro usuario (o sin `userId`, filas
 *     anteriores a la v2 de la base): no se pueden atribuir con seguridad y
 *     conservarlas expondría datos de otra persona en este dispositivo
 *     (privacidad > reintento). Ver {@link OutboxStore.purgeForeign}.
 * - Error de negocio RFC 7807 (4xx salvo 401/408/429) → `conflict` con
 *   `lastError`; nunca se descarta en silencio.
 * - Error transitorio (red, 5xx, 401, 408, 429) → vuelve a `pending` y se
 *   detiene el drenado para conservar el orden. Un `401` además marca
 *   `unauthorized`: el llamador debe **pausar** (sin reintentos en bucle)
 *   hasta que haya sesión de nuevo.
 * - Exclusión mutua:
 *   - En la pestaña, las llamadas concurrentes se **fusionan** en el drenado
 *     en curso (que vuelve a listar la cola antes de terminar, así una fila
 *     encolada durante el drenado no se queda esperando al siguiente evento).
 *   - Entre pestañas, `navigator.locks` (Baseline Widely available) serializa
 *     los drenados. Sin Web Locks solo queda la exclusión dentro de la pestaña.
 * - Cada fila se "reclama" (`pending` → `syncing`) de forma atómica antes de
 *   enviarla: si se borró entretanto (logout, descarte), no se envía.
 */

/** Nombre del Web Lock compartido por todas las pestañas del origen. */
export const OUTBOX_LOCK_NAME = "despensa-outbox-drain";

/**
 * Antigüedad máxima (desde `createdAt`) con la que la outbox reenvía una fila
 * automáticamente con su `Idempotency-Key`: 6 d 20 h, 4 h por debajo del TTL
 * de 168 h de FastAPI (`IDEMPOTENCY_KEY_TTL_HOURS`) como margen para relojes
 * desajustados y para el tiempo entre `createdAt` y el primer envío. Pasado
 * este umbral la clave podría haber caducado en el servidor y el reenvío
 * duplicaría el efecto, así que la fila pasa a `conflict`
 * (`outbox-entry-expired`) y requiere confirmación del usuario.
 */
export const OUTBOX_MAX_REPLAY_AGE_MS = (6 * 24 + 20) * 60 * 60 * 1000;

/**
 * `true` si la fila es demasiado antigua para reenviarla con su clave (ver
 * {@link OUTBOX_MAX_REPLAY_AGE_MS}). Un `createdAt` ilegible cuenta como
 * caducado: IndexedDB no es fuente de confianza y lo seguro es preguntar.
 *
 * @param record - Fila de la outbox.
 * @param nowMs - Instante actual (ms desde epoch).
 * @returns `true` si no debe reenviarse automáticamente.
 *
 * @example
 * ```ts
 * if (isOutboxRecordExpired(row, Date.now())) markExpired(row);
 * ```
 */
export function isOutboxRecordExpired(record: Pick<OutboxMutationRecord, "createdAt">, nowMs: number): boolean {
  const createdMs = Date.parse(record.createdAt);
  if (Number.isNaN(createdMs)) return true;
  return nowMs - createdMs > OUTBOX_MAX_REPLAY_AGE_MS;
}

/**
 * `ProblemDetail` local (no viene de la red, `status: 0`) con el que se marca
 * una fila caducada. La UI lo reconoce por el slug `outbox-entry-expired`.
 *
 * @returns El problema RFC 7807 de la fila caducada.
 */
export function outboxEntryExpiredProblem(): ProblemDetail {
  return {
    type: problemTypeUri(PROBLEM_TYPES.outboxEntryExpired),
    title: "Cambio caducado",
    status: 0,
    detail: "Este cambio lleva más de 7 días sin sincronizar; confirma si quieres reenviarlo.",
  };
}

/**
 * `true` si la fila está en conflicto por caducidad (y no por un error del
 * servidor): solo esas se pueden reenviar como operación nueva.
 *
 * @param record - Fila de la outbox.
 * @returns `true` si es un conflicto `outbox-entry-expired`.
 */
export function isExpiredOutboxConflict(record: Pick<OutboxMutationRecord, "status" | "lastError">): boolean {
  return (
    record.status === "conflict" &&
    !!record.lastError &&
    problemSlug(record.lastError.type) === PROBLEM_TYPES.outboxEntryExpired
  );
}

/**
 * Cambios que convierten una fila caducada en una **operación nueva**: nueva
 * `Idempotency-Key`, `createdAt` actual, `pending` y contadores a cero. Se
 * conserva el `id` (posición FIFO), el destino y el cuerpo.
 *
 * @param clientMutationId - Clave nueva (`crypto.randomUUID()`).
 * @param now - Instante actual.
 * @returns Cambios a aplicar sobre la fila.
 */
export function renewedOutboxChanges(clientMutationId: string, now: Date): Partial<OutboxMutationRecord> {
  const timestamp = now.toISOString();
  return {
    clientMutationId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "pending",
    attempts: 0,
    lastError: null,
  };
}

/** Slugs que indican un bug del cliente con `Idempotency-Key` (se registran con `console.warn`). */
const CLIENT_IDEMPOTENCY_BUGS: ReadonlySet<string> = new Set([
  PROBLEM_TYPES.invalidIdempotencyKey,
  PROBLEM_TYPES.idempotencyKeyReused,
]);

/** Subconjunto de almacenamiento que usa la outbox (Dexie en la app, memoria en tests). */
export interface OutboxStore {
  add(record: OutboxMutationRecord): Promise<number>;
  /** Filas `pending` en orden de inserción (FIFO por `id`). */
  listPending(): Promise<OutboxMutationRecord[]>;
  /** Filas que quedaron en `syncing` (pestaña cerrada a mitad de envío). */
  listSyncing(): Promise<OutboxMutationRecord[]>;
  /**
   * Pasa la fila de `pending` a `syncing` (aplicando `changes`) solo si sigue
   * existiendo y en `pending`. Debe ser atómico (transacción en Dexie).
   *
   * @returns `true` si se reclamó; `false` si se borró o cambió de estado.
   */
  claim(id: number, changes: Partial<OutboxMutationRecord>): Promise<boolean>;
  update(id: number, changes: Partial<OutboxMutationRecord>): Promise<void>;
  remove(id: number): Promise<void>;
  /**
   * Borra (en cualquier estado) las filas cuyo `userId` no es `userId`,
   * incluidas las que no tienen `userId`.
   *
   * @returns Número de filas borradas.
   */
  purgeForeign(userId: string): Promise<number>;
  /** Número total de filas (cualquier estado y usuario). */
  count(): Promise<number>;
}

/**
 * Adaptador de Dexie. Se importa dinámicamente para no cargar IndexedDB en el
 * bundle inicial.
 *
 * @returns {@link OutboxStore} sobre `offlineDb.outboxQueue`.
 */
export async function getDexieOutboxStore(): Promise<OutboxStore> {
  const { offlineDb } = await import("@/lib/db/offline-db");
  const table = offlineDb.outboxQueue;
  return {
    add: async (record) => (await table.add(record)) as number,
    listPending: () => table.where("status").equals("pending").sortBy("id"),
    listSyncing: () => table.where("status").equals("syncing").sortBy("id"),
    claim: (id, changes) =>
      offlineDb.transaction("rw", table, async () => {
        const row = await table.get(id);
        if (!row || row.status !== "pending") return false;
        await table.update(id, changes);
        return true;
      }),
    update: async (id, changes) => {
      await table.update(id, changes);
    },
    remove: (id) => table.delete(id),
    purgeForeign: (userId) =>
      offlineDb.transaction("rw", table, () =>
        table.filter((row) => row.userId !== userId).delete(),
      ),
    count: () => table.count(),
  };
}

/** Datos para encolar una mutación. */
export interface EnqueueInput {
  clientMutationId: string;
  /** Usuario autenticado que hace la acción (`UserResponse.id`). */
  userId: string;
  endpoint: string;
  method?: OutboxMutationRecord["method"];
  payload: unknown;
  pantryId: string | null;
  kind: string;
  label: string;
}

/**
 * Encola una mutación como `pending`.
 *
 * @param store - Almacenamiento.
 * @param input - {@link EnqueueInput}.
 * @param now - Reloj inyectable.
 * @returns El `id` autoincremental de la fila.
 */
export function enqueueMutation(
  store: OutboxStore,
  input: EnqueueInput,
  now: () => Date = () => new Date(),
): Promise<number> {
  const timestamp = now().toISOString();
  return store.add({
    clientMutationId: input.clientMutationId,
    userId: input.userId,
    endpoint: input.endpoint,
    method: input.method ?? "POST",
    payload: input.payload,
    pantryId: input.pantryId,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    kind: input.kind,
    label: input.label,
    attempts: 0,
    lastError: null,
  });
}

/** Envía una fila al BFF. Debe lanzar `ProblemDetailError` si falla. */
export type OutboxSender = (record: OutboxMutationRecord) => Promise<unknown>;

/** Resultado de {@link drainOutbox}. */
export interface DrainResult {
  /**
   * `false` si la llamada se fusionó con un drenado ya en curso en esta
   * pestaña (la promesa resuelve cuando ese drenado termina).
   */
  ran: boolean;
  synced: number;
  /** Filas que pasaron a `conflict` (incluidas las caducadas de `expired`). */
  conflicts: number;
  /** Filas no reenviadas por superar {@link OUTBOX_MAX_REPLAY_AGE_MS} (ya contadas en `conflicts`). */
  expired: number;
  /** `true` si se detuvo por un error transitorio (quedan filas `pending`). */
  stoppedEarly: boolean;
  /** Hogares con filas sincronizadas o en conflicto (para invalidar queries una vez). */
  touchedPantryIds: string[];
  /** `Retry-After` (s) del error transitorio que detuvo el drenado, si lo trae. */
  retryAfterSeconds?: number;
  /** `true` si se detuvo por un `401`: pausar el drenado hasta que haya sesión. */
  unauthorized: boolean;
  /** Filas de otros usuarios (o sin `userId`) borradas antes de drenar. */
  purgedForeign: number;
}

/**
 * `true` si el error es transitorio y la mutación debe reintentarse más tarde
 * con el **mismo** `Idempotency-Key`:
 *
 * - red / `backend-unavailable` / 5xx / `408` / `429`;
 * - `401`: la sesión no se pudo rotar (se reintenta tras volver a iniciar sesión);
 * - `409 idempotency-request-in-progress`: FastAPI aún procesa esa misma
 *   clave (p. ej. el envío anterior perdió la respuesta).
 *
 * `422 idempotency-key-reused` (misma clave, cuerpo distinto), `400
 * invalid-idempotency-key` (formato) y los demás 4xx son conflictos; los dos
 * primeros son un bug del cliente y nunca se reintentan, sea cual sea el
 * `status` con el que lleguen. Una respuesta repetida (`Idempotent-Replayed: true`) se
 * clasifica igual que la original: un `400 insufficient-stock` sigue siendo
 * conflicto y un 2xx, éxito.
 *
 * Un error que no es `ProblemDetailError` (fallo de transporte inesperado) se
 * trata como transitorio; los rechazos deterministas del cliente deben
 * lanzarse como `ProblemDetailError` 4xx para no bloquear la cola.
 *
 * @param error - Error capturado al enviar.
 * @returns `true` si debe reintentarse.
 */
export function isTransientError(error: unknown): boolean {
  if (!isProblemDetailError(error)) return true;
  if (CLIENT_IDEMPOTENCY_BUGS.has(error.errorType)) return false;
  if (
    error.is(PROBLEM_TYPES.networkError) ||
    error.is(PROBLEM_TYPES.backendUnavailable) ||
    error.is(PROBLEM_TYPES.idempotencyRequestInProgress)
  ) {
    return true;
  }
  return error.status >= 500 || error.status === 401 || error.status === 408 || error.status === 429;
}

function toProblem(error: unknown): ProblemDetail {
  if (isProblemDetailError(error)) return error.toJSON();
  return {
    type: "about:blank",
    title: "Error desconocido",
    status: 0,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function crossTabLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks && typeof locks.request === "function") {
    // Espera (sin `ifAvailable`): si otra pestaña drena, esta drena después y
    // no se pierde el aviso. Las llamadas de esta pestaña ya vienen fusionadas.
    return locks.request(OUTBOX_LOCK_NAME, () => task()) as Promise<T>;
  }
  return task();
}

/** Opciones de {@link drainOutbox}. */
export interface DrainOptions {
  store: OutboxStore;
  /**
   * Usuario autenticado **ahora** (verificado con `GET /api/bff/auth/me` justo
   * antes de drenar). Solo se envían sus filas; las demás se borran.
   */
  userId: string;
  send: OutboxSender;
  now?: () => Date;
  /** Se invoca por cada fila confirmada. */
  onSynced?: (record: OutboxMutationRecord) => void;
  /** Se invoca por cada conflicto de negocio. */
  onConflict?: (record: OutboxMutationRecord, problem: ProblemDetail) => void;
}

interface DrainRun {
  /** Acepta fusionar nuevas llamadas mientras sea `true`. */
  open: boolean;
  /** Alguien pidió drenar durante la ejecución: volver a listar antes de cerrar. */
  rerun: boolean;
  promise: Promise<DrainResult>;
}

let activeRun: DrainRun | null = null;

const NOT_RAN: Omit<DrainResult, "touchedPantryIds"> = {
  ran: false,
  synced: 0,
  conflicts: 0,
  expired: 0,
  stoppedEarly: false,
  unauthorized: false,
  purgedForeign: 0,
};

async function runDrain(options: DrainOptions, run: DrainRun): Promise<DrainResult> {
  const { store, send, userId, now = () => new Date(), onSynced, onConflict } = options;
  const result: Omit<DrainResult, "ran" | "touchedPantryIds"> = {
    synced: 0,
    conflicts: 0,
    expired: 0,
    stoppedEarly: false,
    unauthorized: false,
    purgedForeign: 0,
  };
  const touched = new Set<string>();

  try {
    // Dentro del Web Lock: otra pestaña no puede estar enviando filas ajenas.
    result.purgedForeign = await store.purgeForeign(userId);

    // Filas huérfanas en `syncing`: la pestaña se cerró a mitad de envío. Con el
    // Web Lock tomado ninguna otra pestaña está enviando, así que se reintentan
    // con el mismo `Idempotency-Key`.
    for (const orphan of await store.listSyncing()) {
      if (orphan.id !== undefined && orphan.userId === userId) await store.update(orphan.id, { status: "pending" });
    }

    for (;;) {
      run.rerun = false;
      const pending = (await store.listPending()).filter((record) => record.userId === userId);
      if (pending.length === 0) {
        if (run.rerun) continue;
        break;
      }

      for (const record of pending) {
        if (record.id === undefined) continue;
        // Defensa en profundidad: una fila ajena encolada tras la purga no se envía.
        if (record.userId !== userId) continue;

        // TTL de la clave (168 h en FastAPI): una fila demasiado antigua (también
        // una huérfana `syncing` devuelta arriba a `pending`) no se reenvía sola.
        // `claim` es atómico y solo actúa si sigue `pending`.
        if (isOutboxRecordExpired(record, now().getTime())) {
          const problem = outboxEntryExpiredProblem();
          const marked = await store.claim(record.id, {
            status: "conflict",
            lastError: problem,
            updatedAt: now().toISOString(),
          });
          if (!marked) continue;
          result.conflicts += 1;
          result.expired += 1;
          if (record.pantryId) touched.add(record.pantryId);
          onConflict?.({ ...record, status: "conflict", lastError: problem }, problem);
          continue;
        }

        const attempts = (record.attempts ?? 0) + 1;
        const claimed = await store.claim(record.id, {
          status: "syncing",
          attempts,
          updatedAt: now().toISOString(),
        });
        if (!claimed) continue; // Borrada (logout/descarte) o reclamada por otro.

        try {
          await send(record);
          await store.remove(record.id);
          result.synced += 1;
          if (record.pantryId) touched.add(record.pantryId);
          onSynced?.(record);
        } catch (error) {
          const problem = toProblem(error);
          if (isTransientError(error)) {
            await store.update(record.id, {
              status: "pending",
              lastError: problem,
              updatedAt: now().toISOString(),
            });
            result.stoppedEarly = true;
            if (problem.status === 401) result.unauthorized = true;
            if (problem.retry_after !== undefined) result.retryAfterSeconds = problem.retry_after;
            break;
          }
          if (CLIENT_IDEMPOTENCY_BUGS.has(problemSlug(problem.type))) {
            // Bug del cliente (clave mal formada o reutilizada con otro cuerpo): se
            // registra para depurarlo con el correlation ID; sin `label` ni cuerpo.
            console.warn("[outbox] FastAPI rechazó la Idempotency-Key", {
              error_type: problemSlug(problem.type),
              status: problem.status,
              correlation_id: problem.correlation_id,
              kind: record.kind,
              outbox_id: record.id,
            });
          }
          await store.update(record.id, {
            status: "conflict",
            lastError: problem,
            updatedAt: now().toISOString(),
          });
          result.conflicts += 1;
          if (record.pantryId) touched.add(record.pantryId);
          onConflict?.({ ...record, status: "conflict", attempts, lastError: problem }, problem);
        }
      }
      if (result.stoppedEarly) break;
    }
  } finally {
    // Síncrono tras la última lectura vacía: a partir de aquí una nueva llamada
    // arranca su propio drenado en lugar de fusionarse con este.
    run.open = false;
  }

  return { ran: true, ...result, touchedPantryIds: [...touched] };
}

/**
 * Reenvía las mutaciones pendientes en orden FIFO (ver bloque de módulo).
 * Las llamadas concurrentes en la misma pestaña se fusionan: solo la primera
 * envía (`ran: true`), el resto resuelve con `ran: false` cuando termina.
 *
 * @param options - {@link DrainOptions}. Las llamadas fusionadas usan las
 *   opciones de la primera.
 * @returns {@link DrainResult}.
 *
 * @example
 * ```ts
 * const store = await getDexieOutboxStore();
 * await drainOutbox({ store, send: sendOutboxRecord, userId: user.id });
 * ```
 */
export function drainOutbox(options: DrainOptions): Promise<DrainResult> {
  if (activeRun?.open) {
    activeRun.rerun = true;
    const waitFor = activeRun.promise;
    return waitFor.then(
      () => ({ ...NOT_RAN, touchedPantryIds: [] }),
      () => ({ ...NOT_RAN, touchedPantryIds: [] }),
    );
  }

  const run: DrainRun = { open: true, rerun: false, promise: Promise.resolve(null as never) };
  activeRun = run;
  run.promise = crossTabLock(() => runDrain(options, run)).finally(() => {
    run.open = false;
    if (activeRun === run) activeRun = null;
  });
  return run.promise;
}
