---
name: offline-outbox-mutation
description: Procedimiento estándar para implementar escrituras Offline-First con actualización optimista en TanStack Query, cola persistente en Dexie (IndexedDB) y resolución de conflictos RFC 7807.
---

# Implementar Mutación Offline-First (Patrón Client Outbox)

Aplica esta receta para toda operación crítica de escritura en despensa (alta de producto, registro de lote, consumo FEFO o lectura de alertas) que deba funcionar sin conexión a internet.

## Paso 1: Definir la Operación Tipada

1. Verifica el payload y respuesta esperada en `src/lib/api/schema.d.ts`.
2. Genera un `clientMutationId` (`crypto.randomUUID()`) para trazabilidad e idempotencia local.

## Paso 2: Flujo Optimista y Encolado en IndexedDB

1. En `useMutation` de TanStack Query (`networkMode: "offlineFirst"`):
   - **`onMutate`:** Cancela queries en vuelo (`queryClient.cancelQueries`), guarda snapshot previo para rollback y aplica la actualización optimista en caché marcando el elemento con estado visual de sincronización pendiente si `!navigator.onLine`.
   - Si no hay red (o falla por error de transporte), persiste el registro en `offlineDb.outboxQueue` (`src/lib/db/offline-db.ts`) con `status: "pending"` y actualiza `connectionStatus` en `useUiStore`.

## Paso 3: Drenado FIFO y Reconciliación de Conflictos

1. Al recuperar conectividad (evento `online`), procesa `offlineDb.outboxQueue` en estricto orden cronológico (`createdAt` ascendente).
2. Si una mutación previa creó un recurso maestro (ej. `POST /api/v1/products` con ID temporal), sustituye ese ID temporal por el UUID real en las mutaciones dependientes antes de enviarlas.
3. Si FastAPI responde con un error de dominio **RFC 7807** (ej. `400 insufficient-stock` o `403 pantry-access-denied`):
   - **No descartes la fila en silencio.** Actualiza el registro en `outboxQueue` a `status: "conflict"` adjuntando el objeto `ProblemDetailError` en `lastError` e invalida el caché de TanStack Query para reflejar la verdad del servidor y notificar al usuario.

## Implementación de referencia (Etapa 2)

Copia el patrón de `useConsumeMutation` (`src/features/pantry/hooks.ts`) y `src/lib/offline/outbox.ts` en vez de reinventarlo:

- la fila lleva `userId`, `kind` (allowlist en `OUTBOX_ENDPOINT_RULES`), `label`, `attempts` y `updatedAt`;
- el `clientMutationId` es la `Idempotency-Key` y se mantiene estable entre reintentos;
- se encola ante `shouldEnqueueAfterSend(error)` (red, 5xx, 408, 429, 409 en curso) con **el mismo cuerpo** ya enviado;
- conflicto ante cualquier otro 4xx; las filas con más de 6 d 20 h pasan a `outbox-entry-expired`.

Añade un `kind` nuevo a `OUTBOX_ENDPOINT_RULES` con su regex exacta, y tests en `tests/unit/outbox.test.ts` y `pantry-hooks.test.tsx` (`fake-indexeddb`).
