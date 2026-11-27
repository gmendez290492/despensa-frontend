"use client";

import { ArrowRight, CircleCheck } from "lucide-react";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo } from "react";
import { useAnnounceOnChange } from "@/components/status-announcer";
import type { FoodBatchResponse, LocationResponse } from "@/features/pantry/api";
import { inStock, matchesWindow, PRIORITY_WINDOWS, type PriorityWindow } from "@/features/pantry/fefo";
import { BatchCard } from "@/features/pantry/components/batch-card";
import { FilterChip } from "@/features/pantry/components/filter-chip";

/** Etiquetas visibles de cada plazo (`?plazo=`). */
export const PRIORITY_WINDOW_LABEL: Record<PriorityWindow, string> = {
  todos: "Urgentes",
  vencidos: "Vencidos",
  "48h": "En 48 h",
  semana: "Esta semana",
};

/** Máximo de tarjetas en el panel; el resto se ve en el inventario. */
export const PRIORITY_LIMIT = 10;

/** Parser `nuqs` de `?plazo=` (por defecto `todos`, que no se escribe en la URL). */
export const plazoParser = parseAsStringLiteral(PRIORITY_WINDOWS).withDefault("todos");

/** Props de {@link PriorityShelf}. */
export interface PriorityShelfProps {
  /** Lotes del hogar en orden FEFO. */
  batches: readonly FoodBatchResponse[];
  locations: readonly LocationResponse[];
  /** Abre el diálogo de consumo para el producto del lote. */
  onConsume: (batch: FoodBatchResponse) => void;
}

/**
 * Sección "Prioridad" del panel (Stitch "Priority Shelf"): filtros de plazo
 * en la URL (`?plazo=vencidos|48h|semana`, compartible) con recuentos y las
 * tarjetas de los lotes urgentes en orden FEFO.
 *
 * @remarks
 * - Usa `nuqs` (`useSearchParams`): la página debe envolverla en `<Suspense>`
 *   por `cacheComponents`.
 * - Filtros como botones conmutables con `aria-pressed` agrupados con
 *   `role="group"`; el recuento forma parte del nombre ("Vencidos (2)").
 * - El recuento visible no es región viva (se anunciaría en cada *refetch* o
 *   consumo); se anuncia una sola vez al cambiar de plazo vía
 *   `useAnnounceOnChange`, sin mover el foco.
 *
 * @param props - {@link PriorityShelfProps}.
 * @returns La `<section>` con filtros y lista.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `accessibility` (estados conmutables), `dynamic-sort` (anunciar el cambio una vez) y `card`.
 */
export function PriorityShelf({ batches, locations, onConsume }: PriorityShelfProps) {
  const [plazo, setPlazo] = useQueryState("plazo", plazoParser);

  const stock = useMemo(() => inStock(batches), [batches]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        PRIORITY_WINDOWS.map((window) => [window, stock.filter((batch) => matchesWindow(batch, window)).length]),
      ) as Record<PriorityWindow, number>,
    [stock],
  );
  const visible = useMemo(() => stock.filter((batch) => matchesWindow(batch, plazo)), [stock, plazo]);
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);
  const summary =
    visible.length === 0
      ? "Nada en este plazo."
      : `${visible.length} ${visible.length === 1 ? "lote" : "lotes"} · ${PRIORITY_WINDOW_LABEL[plazo].toLowerCase()}`;
  useAnnounceOnChange(plazo, summary);

  return (
    <section aria-labelledby="priority-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="priority-title" className="font-display text-xl font-semibold text-primary">
          Prioridad
        </h2>
        <Link
          href="/despensa"
          className="inline-flex min-h-11 items-center gap-1 text-[0.8125rem] font-semibold text-primary-container underline underline-offset-4 focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          Ver todo el inventario
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      <div role="group" aria-label="Plazo de caducidad" className="flex flex-wrap gap-2">
        {PRIORITY_WINDOWS.map((window) => (
          <FilterChip
            key={window}
            pressed={plazo === window}
            onClick={() => void setPlazo(window)}
            count={counts[window]}
          >
            {PRIORITY_WINDOW_LABEL[window]}
          </FilterChip>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{summary}</p>

      {visible.length === 0 ? (
        <p className="flex items-center gap-2 rounded-[4px] border border-semaforo-optimo/30 bg-semaforo-optimo/12 p-4 text-sm font-medium text-semaforo-optimo-ink">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          {plazo === "todos"
            ? "Todo está en buen estado: no hay lotes que venzan en los próximos 7 días."
            : "No hay lotes en este plazo."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.slice(0, PRIORITY_LIMIT).map((batch) => (
            <li key={batch.id}>
              <BatchCard batch={batch} locationName={locationNames.get(batch.location_id)} onConsume={onConsume} />
            </li>
          ))}
        </ul>
      )}

      {visible.length > PRIORITY_LIMIT ? (
        <p className="text-sm text-muted-foreground">
          Mostrando {PRIORITY_LIMIT} de {visible.length}.{" "}
          <Link href="/despensa" className="font-semibold text-primary-container underline underline-offset-4">
            Ver el resto en el inventario
          </Link>
        </p>
      ) : null}
    </section>
  );
}
