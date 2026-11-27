"use client";

import { Bell, ChevronRight, CircleX, Hourglass, Leaf, Package, Utensils } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAnnounceOnChange } from "@/components/status-announcer";
import { buttonVariants, Button } from "@/components/ui/button";
import { Label, inputBaseClass } from "@/components/ui/text-field";
import type { FoodBatchResponse, LocationResponse, PantryResponse } from "@/features/pantry/api";
import { computeStats, groupByProduct, inStock } from "@/features/pantry/fefo";
import {
  useBatches,
  useLocations,
  usePantryDashboard,
  useUnreadNotificationsCount,
} from "@/features/pantry/hooks";
import { useConsumeDialog } from "@/features/pantry/components/consume-dialog-provider";
import { PantryErrorState, PantryGate, PantrySkeleton } from "@/features/pantry/components/pantry-states";
import { PriorityShelf } from "@/features/pantry/components/priority-shelf";
import { cn } from "@/lib/utils";

/** Props de {@link PantrySwitcher}. */
export interface PantrySwitcherProps {
  pantries: readonly PantryResponse[];
  activeId: string;
  onChange: (pantryId: string) => void;
}

/** Espera antes de aplicar el hogar elegido (agrupa las flechas en un `<select>` cerrado). */
export const PANTRY_SWITCH_DELAY_MS = 400;

/**
 * Selector del hogar activo (`<select>` nativo). Solo se muestra con más de
 * un hogar.
 *
 * @remarks
 * - Aplica el cambio al elegir (sin botón "Aplicar"): no envía datos ni
 *   navega, solo cambia la vista local y es reversible; el foco se queda en el
 *   control.
 * - Con el `<select>` cerrado, cada flecha dispara `change`: el valor visible
 *   cambia al instante pero `onChange` se aplica tras
 *   {@link PANTRY_SWITCH_DELAY_MS} sin más cambios (o al salir del control),
 *   para no pedir los lotes de cada hogar intermedio.
 * - El hogar mostrado se anuncia desde el panel (`useAnnounceOnChange`).
 *
 * @param props - {@link PantrySwitcherProps}.
 * @returns Etiqueta + `<select>`, o `null` con un solo hogar.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `forms` (etiqueta visible antes del control).
 */
export function PantrySwitcher({ pantries, activeId, onChange }: PantrySwitcherProps) {
  const id = useId();
  const [draftId, setDraftId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pendingRef.current;
    pendingRef.current = null;
    setDraftId(null);
    if (next !== null) onChangeRef.current(next);
  };

  // Al desmontar se aplica lo pendiente: la elección del usuario no se pierde.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pendingRef.current !== null) onChangeRef.current(pendingRef.current);
    },
    [],
  );

  if (pantries.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Hogar activo</Label>
      <select
        id={id}
        value={draftId ?? activeId}
        onChange={(event) => {
          pendingRef.current = event.target.value;
          setDraftId(event.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, PANTRY_SWITCH_DELAY_MS);
        }}
        onBlur={() => {
          if (pendingRef.current !== null) flush();
        }}
        className={cn(inputBaseClass, "appearance-auto")}
      >
        {pantries.map((pantry) => (
          <option key={pantry.id} value={pantry.id}>
            {pantry.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function UnreadAlerts({ pantryId }: { pantryId: string }) {
  // Antes que el contador: la cabecera se suscribe antes que el resto del
  // panel, y el dashboard debe arrancar primero para que el contador espere
  // su respuesta en lugar de pedir `GET /notifications`.
  usePantryDashboard(pantryId);
  const unread = useUnreadNotificationsCount();
  if (unread.data === undefined) return null;
  const count = unread.data;
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-xs font-semibold",
        count > 0
          ? "border-semaforo-critico/30 bg-semaforo-critico/12 text-semaforo-critico-ink"
          : "border-border-sand bg-surface-low text-muted-foreground",
      )}
    >
      <Bell aria-hidden="true" className="size-3.5" />
      {count === 0 ? "Sin alertas nuevas" : `${count} ${count === 1 ? "alerta sin leer" : "alertas sin leer"}`}
    </p>
  );
}

function PantrySummaryHeader({
  pantry,
  pantries,
  setActivePantryId,
}: {
  pantry: PantryResponse;
  pantries: readonly PantryResponse[];
  setActivePantryId: (id: string) => void;
}) {
  return (
    <section aria-label="Hogar" className="space-y-3 rounded-[4px] border border-border-sand bg-surface-low p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold text-primary">{pantry.name}</p>
        <UnreadAlerts pantryId={pantry.id} />
      </div>
      <PantrySwitcher pantries={pantries} activeId={pantry.id} onChange={setActivePantryId} />
      <dl className="text-[0.8125rem]">
        <dt className="text-muted-foreground">Código de invitación</dt>
        <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
          <code className="font-mono text-sm font-semibold tracking-wider break-all text-foreground">
            {pantry.invite_code}
          </code>
          <span className="text-xs text-muted-foreground">Compártelo para que tu familia se una.</span>
        </dd>
      </dl>
    </section>
  );
}

interface StatTileProps {
  icon: typeof Package;
  label: string;
  value: number;
  description: string;
  tone: "alert" | "expired" | "ok" | "neutral";
  percent?: number;
}

const tileTone: Record<StatTileProps["tone"], string> = {
  alert: "text-semaforo-critico-ink",
  expired: "text-semaforo-vencido-ink",
  ok: "text-semaforo-optimo-ink",
  neutral: "text-muted-foreground",
};

function StatTile({ icon: Icon, label, value, description, tone, percent }: StatTileProps) {
  return (
    <div className="flex flex-col justify-between gap-2 rounded-[4px] border border-border-sand bg-surface-lowest p-3.5 shadow-ambient">
      <dt className={cn("flex items-center gap-1.5 text-[0.6875rem] font-bold tracking-wider uppercase", tileTone[tone])}>
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </dt>
      <dd className="space-y-1">
        <span className="block font-display text-3xl leading-none font-semibold text-foreground tabular-nums">
          {value}
        </span>
        <span className="block text-xs text-muted-foreground">{description}</span>
        {percent !== undefined ? (
          <span aria-hidden="true" className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-surface-high">
            <span className="block h-full rounded-full bg-semaforo-optimo" style={{ width: `${percent}%` }} />
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function LocationsSection({
  batches,
  locations,
}: {
  batches: readonly FoodBatchResponse[];
  locations: readonly LocationResponse[];
}) {
  const rows = useMemo(() => {
    const stock = inStock(batches);
    return locations.map((location) => {
      const own = stock.filter((batch) => batch.location_id === location.id);
      return {
        location,
        total: own.length,
        urgent: own.filter((batch) => batch.semaforo === "CRÍTICO" || batch.semaforo === "VENCIDO").length,
      };
    });
  }, [batches, locations]);

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="locations-title" className="space-y-3">
      <div>
        <p className="text-[0.6875rem] font-bold tracking-widest text-muted-foreground uppercase">Secciones</p>
        <h2 id="locations-title" className="font-display text-xl font-semibold text-primary">
          Ubicaciones
        </h2>
      </div>
      <ul className="divide-y divide-border-sand overflow-hidden rounded-[4px] border border-border-sand bg-surface-lowest">
        {rows.map(({ location, total, urgent }) => (
          <li key={location.id}>
            <Link
              href={`/despensa?ubicacion=${encodeURIComponent(location.id)}`}
              className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-low focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary-container"
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold text-foreground">{location.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {total} {total === 1 ? "lote" : "lotes"}
                  {urgent > 0 ? (
                    <span className="font-semibold text-semaforo-critico-ink">
                      {" "}
                      · {urgent} {urgent === 1 ? "requiere" : "requieren"} acción
                    </span>
                  ) : null}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DashboardContent({
  pantry,
  pantries,
  setActivePantryId,
}: {
  pantry: PantryResponse;
  pantries: readonly PantryResponse[];
  setActivePantryId: (id: string) => void;
}) {
  // Antes que las queries sueltas: las siembra y ellas esperan su respuesta.
  usePantryDashboard(pantry.id);
  const batchesQuery = useBatches(pantry.id);
  const locationsQuery = useLocations(pantry.id);
  const { openConsume } = useConsumeDialog();
  const quickConsumeHintId = `${useId()}-quick-consume-hint`;

  const batches = useMemo(() => batchesQuery.data ?? [], [batchesQuery.data]);
  const locations = useMemo(() => locationsQuery.data ?? [], [locationsQuery.data]);
  const stats = useMemo(() => computeStats(batches), [batches]);
  const hasStock = useMemo(() => groupByProduct(batches).length > 0, [batches]);

  // Anuncia el hogar mostrado al cambiarlo (no al montar ni en cada refetch).
  useAnnounceOnChange(pantry.id, `Mostrando hogar ${pantry.name}.`);

  const header = (
    <PantrySummaryHeader pantry={pantry} pantries={pantries} setActivePantryId={setActivePantryId} />
  );

  if (batchesQuery.isPending) {
    return (
      <>
        {header}
        <PantrySkeleton label="Cargando el panel" />
      </>
    );
  }
  if (batchesQuery.error) {
    return (
      <>
        {header}
        <PantryErrorState error={batchesQuery.error} onRetry={() => void batchesQuery.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}

      <section aria-labelledby="stats-title" className="space-y-2">
        <h2 id="stats-title" className="sr-only">
          Resumen del inventario
        </h2>
        <dl className="grid grid-cols-2 gap-2">
          <StatTile
            icon={Hourglass}
            label="Requieren acción"
            value={stats.actionRequired}
            description="Vencidos o vencen en 3 días o menos"
            tone="alert"
          />
          <StatTile
            icon={CircleX}
            label="Vencidos"
            value={stats.bySemaforo.VENCIDO}
            description="Revísalos antes de consumir"
            tone="expired"
          />
          <StatTile
            icon={Leaf}
            label="Óptimos"
            value={stats.bySemaforo.ÓPTIMO}
            description={`${stats.optimalPercent} % del inventario`}
            tone="ok"
            percent={stats.optimalPercent}
          />
          <StatTile
            icon={Package}
            label="Lotes activos"
            value={stats.total}
            description={`En ${locations.length} ${locations.length === 1 ? "ubicación" : "ubicaciones"}`}
            tone="neutral"
          />
        </dl>
      </section>

      <section aria-labelledby="actions-title" className="space-y-2">
        <h2 id="actions-title" className="sr-only">
          Acciones rápidas
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/despensa" className={buttonVariants({ variant: "primary", size: "md" })}>
            <Package aria-hidden="true" className="size-4" />
            Ver inventario
          </Link>
          <Button
            variant="secondary"
            size="md"
            aria-disabled={hasStock ? undefined : true}
            aria-describedby={hasStock ? undefined : quickConsumeHintId}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            onClick={() => {
              if (!hasStock) return;
              openConsume();
            }}
          >
            <Utensils aria-hidden="true" className="size-4" />
            Consumo rápido
          </Button>
        </div>
        {!hasStock ? (
          <p id={quickConsumeHintId} className="text-xs text-muted-foreground">
            No hay productos con stock para consumir.
          </p>
        ) : null}
      </section>

      <PriorityShelf
        batches={batches}
        locations={locations}
        onConsume={(batch) => openConsume(batch.product_id)}
      />

      <LocationsSection batches={batches} locations={locations} />
    </>
  );
}

/**
 * Panel de inicio (Stitch "Home Dashboard") para el hogar activo: cabecera
 * del hogar (nombre, alertas sin leer, selector si hay varios, código de
 * invitación), métricas FEFO, acciones rápidas, "Prioridad" con filtros de
 * plazo en la URL y ubicaciones con recuentos.
 *
 * @remarks
 * - Client Component (TanStack Query + `nuqs`): la página RSC lo envuelve en
 *   `<Suspense>` por `cacheComponents`.
 * - Datos: `usePantryDashboard` trae hogares, ubicaciones, lotes y alertas en
 *   una petición y siembra las queries sueltas, que siguen dando la carga, el
 *   error (un `403` del dashboard llega igual a `useBatches`) y los refetch
 *   tras mutaciones. Con un backend sin el endpoint (`404`) se usan las 4
 *   llamadas sueltas.
 * - Se omiten del diseño Stitch los datos sin respaldo en la API: fotos,
 *   dinero ahorrado, escáner de recibos, recetas y "Descartar".
 * - "Consumo rápido" sin stock usa `aria-disabled` (no `disabled`): sigue
 *   siendo enfocable y su `aria-describedby` explica por qué no actúa; el
 *   *handler* ignora la pulsación.
 * - Las métricas son una `<dl>` (término → valor) para que el lector las lea
 *   como pares; las barras son decorativas con el porcentaje en texto.
 *
 * @returns El contenido del panel según el estado del hogar.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `card`, `form-factor-adaptation`, `accessibility`, `toolbar` (`aria-disabled`) y `respect-os-text-scale` (tamaños en `rem`).
 */
export function HomeDashboard() {
  return (
    <PantryGate fallback={<PantrySkeleton label="Cargando tus hogares" />}>
      {({ pantry, pantries, setActivePantryId }) => (
        <DashboardContent pantry={pantry} pantries={pantries} setActivePantryId={setActivePantryId} />
      )}
    </PantryGate>
  );
}
