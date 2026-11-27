"use client";

import { MapPin, Search, X } from "lucide-react";
import { debounce, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import { useMemo } from "react";
import { useAnnounceOnChange } from "@/components/status-announcer";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/text-field";
import type { FoodBatchResponse, LocationResponse, PantryResponse, Semaforo } from "@/features/pantry/api";
import { filterBatches, inStock, SEMAFORO_LABEL, SEMAFORO_ORDER } from "@/features/pantry/fefo";
import { useBatches, useLocations } from "@/features/pantry/hooks";
import {
  SEMAFORO_SLUGS,
  SEMAFORO_TONE,
  semaforoFromSlug,
  semaforoToSlug,
} from "@/features/pantry/semaforo-ui";
import { BatchCard } from "@/features/pantry/components/batch-card";
import { useConsumeDialog } from "@/features/pantry/components/consume-dialog-provider";
import { FilterChip } from "@/features/pantry/components/filter-chip";
import { PantryErrorState, PantryGate, PantrySkeleton } from "@/features/pantry/components/pantry-states";
import { cn } from "@/lib/utils";

/**
 * Parsers `nuqs` del inventario: `?q=` (texto, URL con *debounce* de 300 ms),
 * `?ubicacion=<uuid>` y `?semaforo=vencido|critico|precaucion|optimo`.
 */
export const inventoryParsers = {
  q: parseAsString.withDefault(""),
  ubicacion: parseAsString,
  semaforo: parseAsStringLiteral(SEMAFORO_SLUGS),
};

function countBySemaforo(batches: readonly FoodBatchResponse[]): Record<Semaforo, number> {
  const counts: Record<Semaforo, number> = { VENCIDO: 0, CRÍTICO: 0, PRECAUCIÓN: 0, ÓPTIMO: 0 };
  for (const batch of batches) counts[batch.semaforo] += 1;
  return counts;
}

/** Props de {@link SemaforoDistribution}. */
export interface SemaforoDistributionProps {
  /** Título del resumen (ubicación seleccionada o "Todas las ubicaciones"). */
  title: string;
  batches: readonly FoodBatchResponse[];
}

/**
 * Distribución por semáforo de un conjunto de lotes (Stitch "Main Fridge"):
 * barra apilada decorativa + leyenda textual con icono y recuento por estado.
 *
 * @remarks La barra es `aria-hidden`; toda la información está en la leyenda
 * (`<ul>`), que no depende del color.
 *
 * @param props - {@link SemaforoDistributionProps}.
 * @returns Un `<section>` con el resumen.
 */
export function SemaforoDistribution({ title, batches }: SemaforoDistributionProps) {
  const counts = countBySemaforo(batches);
  const total = batches.length;
  return (
    <section aria-labelledby="distribution-title" className="space-y-2 rounded-[4px] border border-border-sand bg-surface-low p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="distribution-title" className="flex items-center gap-1.5 text-sm font-bold text-primary">
          <MapPin aria-hidden="true" className="size-4" />
          {title}
        </h2>
        <p className="text-xs font-medium text-muted-foreground">
          {total} {total === 1 ? "lote" : "lotes"}
        </p>
      </div>
      <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-surface-high">
        {total > 0
          ? SEMAFORO_ORDER.map((semaforo) =>
              counts[semaforo] > 0 ? (
                <div
                  key={semaforo}
                  className={cn("h-full", SEMAFORO_TONE[semaforo].fill)}
                  style={{ width: `${(counts[semaforo] / total) * 100}%` }}
                />
              ) : null,
            )
          : null}
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {SEMAFORO_ORDER.map((semaforo) => {
          const Icon = SEMAFORO_TONE[semaforo].icon;
          return (
            <li key={semaforo} className={cn("flex items-center gap-1.5 font-semibold", SEMAFORO_TONE[semaforo].ink)}>
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              <span>
                {SEMAFORO_LABEL[semaforo]}: <span className="tabular-nums">{counts[semaforo]}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function InventoryContent({ pantry }: { pantry: PantryResponse }) {
  const batchesQuery = useBatches(pantry.id);
  const locationsQuery = useLocations(pantry.id);
  const { openConsume } = useConsumeDialog();
  const [filters, setFilters] = useQueryStates(inventoryParsers);

  const locations: readonly LocationResponse[] = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const stock = useMemo(() => inStock(batchesQuery.data ?? []), [batchesQuery.data]);
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);

  // Una ubicación de otro hogar (enlace viejo) se ignora en vez de vaciar la lista.
  const locationId = filters.ubicacion && locationNames.has(filters.ubicacion) ? filters.ubicacion : null;
  const semaforo = semaforoFromSlug(filters.semaforo);
  const inLocation = useMemo(
    () => (locationId ? stock.filter((batch) => batch.location_id === locationId) : stock),
    [stock, locationId],
  );
  const semaforoCounts = useMemo(() => countBySemaforo(inLocation), [inLocation]);
  const visible = useMemo(
    () => filterBatches(stock, { q: filters.q, locationId, semaforo }, locations),
    [stock, filters.q, locationId, semaforo, locations],
  );
  const hasFilters = Boolean(filters.q || locationId || semaforo);
  const resultsLabel = `${visible.length} ${visible.length === 1 ? "resultado" : "resultados"}`;
  // Una vez por cambio de filtros (agrupa la escritura), no en cada refetch o consumo.
  useAnnounceOnChange(JSON.stringify([filters.q.trim(), filters.ubicacion, filters.semaforo]), `${resultsLabel}.`, 600);

  if (batchesQuery.isPending) return <PantrySkeleton label="Cargando inventario" cards={4} />;
  if (batchesQuery.error) {
    return <PantryErrorState error={batchesQuery.error} onRetry={() => void batchesQuery.refetch()} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {pantry.name} · {stock.length} {stock.length === 1 ? "lote" : "lotes"} en {locations.length}{" "}
        {locations.length === 1 ? "ubicación" : "ubicaciones"}
      </p>

      <search className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="inventory-search">Buscar en la despensa</Label>
          <div className="relative flex items-center">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 size-4 text-outline" />
            <Input
              id="inventory-search"
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={120}
              placeholder="Producto o ubicación"
              className="pl-10"
              value={filters.q}
              onChange={(event) =>
                void setFilters(
                  { q: event.target.value || null },
                  { limitUrlUpdates: event.target.value ? debounce(300) : undefined },
                )
              }
            />
          </div>
        </div>

        <div role="group" aria-label="Ubicación" className="flex flex-wrap gap-2">
          <FilterChip pressed={locationId === null} count={stock.length} onClick={() => void setFilters({ ubicacion: null })}>
            Todas
          </FilterChip>
          {locations.map((location) => (
            <FilterChip
              key={location.id}
              pressed={locationId === location.id}
              count={stock.filter((batch) => batch.location_id === location.id).length}
              onClick={() => void setFilters({ ubicacion: location.id })}
            >
              {location.name}
            </FilterChip>
          ))}
        </div>

        <div role="group" aria-label="Estado de caducidad" className="flex flex-wrap gap-2">
          <FilterChip pressed={semaforo === null} onClick={() => void setFilters({ semaforo: null })}>
            Todos los estados
          </FilterChip>
          {SEMAFORO_ORDER.map((value) => {
            const Icon = SEMAFORO_TONE[value].icon;
            return (
              <FilterChip
                key={value}
                pressed={semaforo === value}
                count={semaforoCounts[value]}
                icon={<Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                onClick={() => void setFilters({ semaforo: semaforo === value ? null : semaforoToSlug(value) })}
              >
                {SEMAFORO_LABEL[value]}
              </FilterChip>
            );
          })}
        </div>
      </search>

      <SemaforoDistribution
        title={locationId ? (locationNames.get(locationId) ?? "Ubicación") : "Todas las ubicaciones"}
        batches={inLocation}
      />

      <section aria-labelledby="ledger-title" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ledger-title" className="text-[0.6875rem] font-bold tracking-widest text-muted-foreground uppercase">
            Lotes por caducidad (FEFO)
          </h2>
          <p className="text-xs text-muted-foreground">{resultsLabel}</p>
        </div>

        {stock.length === 0 ? (
          <p className="rounded-[4px] border border-border-sand bg-surface-lowest p-4 text-sm text-muted-foreground">
            Aún no hay lotes con stock en este hogar.
          </p>
        ) : visible.length === 0 ? (
          <div className="space-y-3 rounded-[4px] border border-border-sand bg-surface-lowest p-4">
            <p className="text-sm text-muted-foreground">Ningún lote coincide con los filtros.</p>
            {hasFilters ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => void setFilters({ q: null, ubicacion: null, semaforo: null })}
              >
                <X aria-hidden="true" className="size-4" />
                Quitar filtros
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((batch) => (
              <li key={batch.id}>
                <BatchCard
                  batch={batch}
                  locationName={locationNames.get(batch.location_id)}
                  onConsume={(target) => openConsume(target.product_id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Inventario del hogar activo (Stitch "Pantry Inventory"): búsqueda, chips
 * de ubicación y semáforo (todo en la URL con `nuqs`), distribución por
 * semáforo de la ubicación elegida y lista FEFO con "Consumir".
 *
 * @remarks
 * - Client Component con `useQueryStates`: la página lo envuelve en
 *   `<Suspense>` (`cacheComponents`).
 * - Búsqueda en `<search>` + `<input type="search">` con etiqueta visible,
 *   sin autocorrección (busca nombres, no prosa). La URL se actualiza con
 *   *debounce* (300 ms) para no llenar el historial; el filtro se aplica al
 *   instante en memoria.
 * - El recuento de resultados es texto visible sin región viva; se anuncia
 *   una vez al cambiar los filtros (`useAnnounceOnChange`, 600 ms para agrupar
 *   lo que se teclea), no en cada *refetch* o consumo.
 * - Se omiten del diseño Stitch: fotos, temperatura/humedad, capacidad,
 *   escáner, voz, "Seleccionar varios", +/- de cantidad, lista de compra y
 *   auditoría (no existen en la API).
 *
 * @returns La vista de inventario.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `forms` (búsqueda y `inputmode`), `dynamic-sort` (anunciar el cambio una vez) y `card`.
 */
export function InventoryView() {
  return (
    <PantryGate fallback={<PantrySkeleton label="Cargando tus hogares" cards={4} />}>
      {({ pantry }) => <InventoryContent pantry={pantry} />}
    </PantryGate>
  );
}
