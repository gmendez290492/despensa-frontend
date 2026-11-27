import type { FoodBatchResponse, LocationResponse, Semaforo } from "@/features/pantry/api";
import { compareDecimals, fromMilli, toMilli } from "@/features/pantry/decimal";

/**
 * Reglas puras (sin React) del dominio FEFO en el cliente: textos del
 * semáforo, filtros del panel, métricas y la simulación optimista del
 * consumo. El backend sigue siendo la fuente de verdad; esto solo adelanta lo
 * que FastAPI va a responder.
 */

/** Orden de urgencia (de más a menos urgente). */
export const SEMAFORO_ORDER: readonly Semaforo[] = ["VENCIDO", "CRÍTICO", "PRECAUCIÓN", "ÓPTIMO"];

/** Etiqueta legible de cada estado (el color nunca va solo: WCAG 1.4.1). */
export const SEMAFORO_LABEL: Record<Semaforo, string> = {
  VENCIDO: "Vencido",
  CRÍTICO: "Crítico",
  PRECAUCIÓN: "Precaución",
  ÓPTIMO: "Óptimo",
};

/**
 * Texto relativo de caducidad a partir de `dias_para_vencer` (lo calcula
 * FastAPI con su fecha; `useBatches` lo envejece con {@link ageBatches} si la
 * caché es de días anteriores).
 *
 * @param days - Días hasta la caducidad (negativo si ya venció).
 * @returns p. ej. `"Vence hoy"`, `"Vence mañana"`, `"Venció hace 2 días"`.
 */
export function expiryLabel(days: number): string {
  if (days < -1) return `Venció hace ${Math.abs(days)} días`;
  if (days === -1) return "Venció ayer";
  if (days === 0) return "Vence hoy";
  if (days === 1) return "Vence mañana";
  return `Vence en ${days} días`;
}

const quantityFormatter = new Intl.NumberFormat("es", { maximumFractionDigits: 3 });

/**
 * Cantidad con unidad para la UI (`"1,5 l"`, `"3 pza"`).
 *
 * @param quantity - Decimal como `string`.
 * @param unit - `unit_code` del lote.
 * @returns Texto localizado.
 */
export function formatQuantity(quantity: string, unit: string): string {
  return `${quantityFormatter.format(toMilli(quantity) / 1000)} ${unit}`;
}

/**
 * Porcentaje restante de un lote (`current / initial`), acotado a 0-100.
 *
 * @param batch - Lote.
 * @returns Entero 0-100.
 */
export function remainingPercent(batch: Pick<FoodBatchResponse, "current_quantity" | "initial_quantity">): number {
  const initial = toMilli(batch.initial_quantity);
  if (initial <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((toMilli(batch.current_quantity) / initial) * 100)));
}

/** Plazos del filtro "Prioridad" del panel (`?plazo=`). */
export const PRIORITY_WINDOWS = ["todos", "vencidos", "48h", "semana"] as const;
/** Unión de {@link PRIORITY_WINDOWS}. */
export type PriorityWindow = (typeof PRIORITY_WINDOWS)[number];

/**
 * `true` si el lote entra en el plazo indicado. "todos" = cualquier lote no
 * óptimo (vencidos + ≤ 7 días, igual que el semáforo del backend).
 */
export function matchesWindow(batch: Pick<FoodBatchResponse, "dias_para_vencer">, window: PriorityWindow): boolean {
  const days = batch.dias_para_vencer;
  switch (window) {
    case "vencidos":
      return days <= 0;
    case "48h":
      return days >= 1 && days <= 2;
    case "semana":
      return days >= 1 && days <= 7;
    case "todos":
    default:
      return days <= 7;
  }
}

/** Lotes con stock (> 0). El backend ya filtra `status=available`, pero el optimista puede dejar ceros. */
export function inStock(batches: readonly FoodBatchResponse[]): FoodBatchResponse[] {
  return batches.filter((batch) => toMilli(batch.current_quantity) > 0);
}

/** Métricas de la cabecera del panel. */
export interface PantryStats {
  /** Lotes con stock. */
  total: number;
  /** Lotes por estado. */
  bySemaforo: Record<Semaforo, number>;
  /** Lotes que vencen en ≤ 3 días (CRÍTICO) o ya vencidos: requieren acción. */
  actionRequired: number;
  /** % de lotes en ÓPTIMO (0-100). */
  optimalPercent: number;
}

/**
 * Calcula {@link PantryStats}.
 *
 * @param batches - Lotes del hogar activo.
 * @returns Métricas agregadas.
 */
export function computeStats(batches: readonly FoodBatchResponse[]): PantryStats {
  const stock = inStock(batches);
  const bySemaforo: Record<Semaforo, number> = { VENCIDO: 0, CRÍTICO: 0, PRECAUCIÓN: 0, ÓPTIMO: 0 };
  for (const batch of stock) bySemaforo[batch.semaforo] += 1;
  const total = stock.length;
  return {
    total,
    bySemaforo,
    actionRequired: bySemaforo.VENCIDO + bySemaforo.CRÍTICO,
    optimalPercent: total === 0 ? 0 : Math.round((bySemaforo.ÓPTIMO / total) * 100),
  };
}

/** Stock agregado de un producto (la unidad de consumo FEFO del backend). */
export interface ProductStock {
  productId: string;
  productName: string;
  unitCode: string;
  /** Suma de `current_quantity` de sus lotes con stock. */
  available: string;
  /** Lote más urgente (primero en FEFO). */
  firstBatch: FoodBatchResponse;
  batchCount: number;
}

/**
 * Agrupa lotes por producto conservando el orden FEFO del primero de cada uno.
 *
 * @param batches - Lotes (en el orden FEFO de FastAPI).
 * @returns Un elemento por producto con stock.
 */
export function groupByProduct(batches: readonly FoodBatchResponse[]): ProductStock[] {
  const map = new Map<string, ProductStock & { milli: number }>();
  for (const batch of inStock(batches)) {
    const existing = map.get(batch.product_id);
    const milli = toMilli(batch.current_quantity);
    if (existing) {
      existing.milli += milli;
      existing.batchCount += 1;
      if (batch.expiration_date < existing.firstBatch.expiration_date) existing.firstBatch = batch;
    } else {
      map.set(batch.product_id, {
        productId: batch.product_id,
        productName: batch.product_name,
        unitCode: batch.unit_code,
        available: "0",
        milli,
        firstBatch: batch,
        batchCount: 1,
      });
    }
  }
  return [...map.values()].map(({ milli, ...rest }) => ({ ...rest, available: fromMilli(milli) }));
}

/** Error de la simulación optimista: el consumo pedido supera el stock en caché. */
export class OptimisticInsufficientStockError extends Error {
  constructor(readonly available: string) {
    super(`Stock insuficiente en caché (disponible: ${available}).`);
    this.name = "OptimisticInsufficientStockError";
  }
}

/**
 * Replica en caché el algoritmo FEFO de FastAPI (`consume_product_fefo`):
 * descuenta del lote del producto que vence antes; los lotes agotados
 * desaparecen (FastAPI los marca `consumed` y ya no los lista).
 *
 * @param batches - Lotes en caché (no se mutan).
 * @param productId - Producto a consumir.
 * @param quantity - Cantidad decimal (`string`).
 * @returns Nueva lista de lotes.
 * @throws {OptimisticInsufficientStockError} Si el stock en caché no alcanza
 *   (el servidor respondería `400 insufficient-stock`).
 *
 * @example
 * ```ts
 * applyOptimisticConsume(batches, milkId, "1.5");
 * ```
 */
export function applyOptimisticConsume(
  batches: readonly FoodBatchResponse[],
  productId: string,
  quantity: string,
): FoodBatchResponse[] {
  const candidates = batches
    .filter((batch) => batch.product_id === productId && toMilli(batch.current_quantity) > 0)
    .sort((a, b) => (a.expiration_date < b.expiration_date ? -1 : a.expiration_date > b.expiration_date ? 1 : 0));

  const available = candidates.reduce((acc, batch) => acc + toMilli(batch.current_quantity), 0);
  let remaining = toMilli(quantity);
  if (available < remaining) throw new OptimisticInsufficientStockError(fromMilli(available));

  const updates = new Map<string, string>();
  for (const batch of candidates) {
    if (remaining <= 0) break;
    const current = toMilli(batch.current_quantity);
    const deducted = Math.min(current, remaining);
    remaining -= deducted;
    updates.set(batch.id, fromMilli(current - deducted));
  }

  return batches.flatMap((batch) => {
    const next = updates.get(batch.id);
    if (next === undefined) return [batch];
    if (compareDecimals(next, "0") <= 0) return [];
    return [{ ...batch, current_quantity: next }];
  });
}

/** Consumo aún no confirmado por FastAPI (fila `pending` de la outbox). */
export interface PendingConsume {
  productId: string;
  quantity: string;
}

/**
 * Re-aplica sobre datos frescos del servidor los consumos que siguen en la
 * outbox, para que un refetch (foco, `staleTime`, invalidación) no "devuelva"
 * stock que el usuario ya consumió sin red. Los que ya no caben en el stock
 * del servidor se omiten: el drenado los marcará `conflict`.
 *
 * @param batches - Lotes recién recibidos de FastAPI.
 * @param pending - Consumos pendientes en orden FIFO.
 * @returns Lotes con los consumos pendientes descontados.
 *
 * @example
 * ```ts
 * applyPendingConsumes(serverBatches, [{ productId: milkId, quantity: "1" }]);
 * ```
 */
export function applyPendingConsumes(
  batches: readonly FoodBatchResponse[],
  pending: readonly PendingConsume[],
): FoodBatchResponse[] {
  let next = [...batches];
  for (const consume of pending) {
    try {
      next = applyOptimisticConsume(next, consume.productId, consume.quantity);
    } catch (error) {
      if (!(error instanceof OptimisticInsufficientStockError)) throw error;
    }
  }
  return next;
}

/** Umbrales del semáforo de FastAPI (`calcular_semaforo`). */
export const SEMAFORO_THRESHOLDS = { criticalMaxDays: 3, cautionMaxDays: 7 } as const;

/**
 * Semáforo a partir de los días restantes, idéntico a `calcular_semaforo` de
 * FastAPI: `VENCIDO` ≤ 0, `CRÍTICO` 1-3, `PRECAUCIÓN` 4-7, `ÓPTIMO` > 7.
 *
 * @param days - Días hasta la caducidad.
 * @returns Estado del semáforo.
 */
export function computeSemaforo(days: number): Semaforo {
  if (days <= 0) return "VENCIDO";
  if (days <= SEMAFORO_THRESHOLDS.criticalMaxDays) return "CRÍTICO";
  if (days <= SEMAFORO_THRESHOLDS.cautionMaxDays) return "PRECAUCIÓN";
  return "ÓPTIMO";
}

/**
 * Fecha de calendario local (`AAAA-MM-DD`) de un instante. Sirve de clave
 * estable "hoy" para memoizar el envejecimiento de la caché.
 *
 * @param at - Instante (por defecto, ahora).
 * @returns Fecha local `AAAA-MM-DD`.
 */
export function localDayKey(at: Date | number = new Date()): string {
  const date = typeof at === "number" ? new Date(at) : at;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayKeyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

/**
 * Días de calendario local transcurridos entre dos fechas `AAAA-MM-DD`.
 * Opera en UTC sobre fechas de calendario: inmune a cambios de horario.
 *
 * @param fromDay - Fecha inicial (`localDayKey`).
 * @param toDay - Fecha final (`localDayKey`).
 * @returns Días (negativo si `toDay` es anterior).
 */
export function elapsedCalendarDays(fromDay: string, toDay: string): number {
  return Math.round((dayKeyToUtc(toDay) - dayKeyToUtc(fromDay)) / 86_400_000);
}

/**
 * Envejece lotes servidos desde caché: resta a `dias_para_vencer` los días de
 * calendario local transcurridos desde que FastAPI los calculó y recalcula el
 * `semaforo` con {@link computeSemaforo}. Con datos de hoy devuelve la misma
 * referencia (se respeta el cálculo del servidor, que usa su propia fecha).
 *
 * Lo usa `useBatches` como `select`: tras días sin red (o una pestaña abierta
 * desde ayer) el semáforo sigue siendo correcto sin esperar al refetch.
 *
 * @param batches - Lotes tal como están en la caché.
 * @param fetchedAt - Instante en que se obtuvieron (`dataUpdatedAt`).
 * @param today - Hoy en fecha local (`localDayKey()`).
 * @returns Lotes con los campos derivados actualizados.
 *
 * @example
 * ```ts
 * ageBatches(cached, query.dataUpdatedAt, localDayKey());
 * ```
 */
export function ageBatches(
  batches: FoodBatchResponse[],
  fetchedAt: number,
  today: string = localDayKey(),
): FoodBatchResponse[] {
  const elapsed = elapsedCalendarDays(localDayKey(fetchedAt), today);
  if (elapsed <= 0) return batches;
  return batches.map((batch) => {
    const days = batch.dias_para_vencer - elapsed;
    return { ...batch, dias_para_vencer: days, semaforo: computeSemaforo(days) };
  });
}

/**
 * Filtros del inventario (`nuqs`): texto, ubicación y semáforo.
 */
export interface InventoryFilters {
  q?: string | null;
  locationId?: string | null;
  semaforo?: Semaforo | null;
}

/** Normaliza para buscar sin acentos ni mayúsculas. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Aplica {@link InventoryFilters} manteniendo el orden FEFO.
 *
 * @param batches - Lotes con stock.
 * @param filters - Filtros activos.
 * @param locations - Para buscar también por nombre de ubicación.
 * @returns Lotes filtrados.
 */
export function filterBatches(
  batches: readonly FoodBatchResponse[],
  filters: InventoryFilters,
  locations: readonly LocationResponse[] = [],
): FoodBatchResponse[] {
  const query = filters.q ? normalize(filters.q.trim()) : "";
  const locationNames = new Map(locations.map((location) => [location.id, normalize(location.name)]));
  return inStock(batches).filter((batch) => {
    if (filters.locationId && batch.location_id !== filters.locationId) return false;
    if (filters.semaforo && batch.semaforo !== filters.semaforo) return false;
    if (query) {
      const haystack = `${normalize(batch.product_name)} ${locationNames.get(batch.location_id) ?? ""}`;
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}
