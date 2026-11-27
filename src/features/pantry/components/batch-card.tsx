import { MapPin, Utensils } from "lucide-react";
import type { FoodBatchResponse } from "@/features/pantry/api";
import { expiryLabel, formatQuantity, remainingPercent } from "@/features/pantry/fefo";
import { SEMAFORO_TONE } from "@/features/pantry/semaforo-ui";
import { SemaforoBadge } from "@/features/pantry/components/semaforo-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Props de {@link BatchCard}. */
export interface BatchCardProps {
  batch: FoodBatchResponse;
  /** Nombre de la ubicación del lote (o `undefined` si aún no cargó). */
  locationName?: string;
  /**
   * Abre el diálogo de consumo para el producto del lote. FastAPI descuenta
   * por FEFO a nivel de producto, no de lote concreto.
   */
  onConsume: (batch: FoodBatchResponse) => void;
  /** Nivel del título (`h3` por defecto; la lista va bajo un `h2`). */
  headingLevel?: "h2" | "h3";
}

/**
 * Tarjeta de un lote FEFO (Stitch "Priority Shelf" / "Stock Ledger"):
 * producto, ubicación, badge del semáforo con caducidad relativa, cantidad,
 * barra de stock restante y acción "Consumir…".
 *
 * @remarks
 * - Raíz `<article>` con regiones en orden de fuente (cabecera, contenido,
 *   pie con la acción) y un `<button>` nativo para la acción independiente.
 * - La barra de stock restante es decorativa (`aria-hidden`): el mismo dato
 *   va en texto ("60 % restante"), así no depende de `<progress>`, que
 *   representa el avance de una tarea y no un nivel.
 * - El botón incluye el producto en su nombre accesible ("Consumir Leche")
 *   para que la lista de controles del lector no repita "Consumir" a secas.
 * - Sin `"use client"`: no usa hooks; se importa desde hojas cliente.
 *
 * @param props - {@link BatchCardProps}.
 * @returns Un `<article>`.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `card`.
 */
export function BatchCard({ batch, locationName, onConsume, headingLevel = "h3" }: BatchCardProps) {
  const Heading = headingLevel;
  const percent = remainingPercent(batch);
  const tone = SEMAFORO_TONE[batch.semaforo];

  return (
    <article className="flex flex-col gap-3 rounded-[4px] border border-border-sand bg-surface-lowest p-4 shadow-ambient">
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="inline-flex min-w-0 items-center gap-1 text-[0.6875rem] font-semibold tracking-wider text-muted-foreground uppercase">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">{locationName ?? "Ubicación"}</span>
          </p>
          <SemaforoBadge semaforo={batch.semaforo} detail={expiryLabel(batch.dias_para_vencer)} />
        </div>
        <Heading className="font-display text-lg leading-6 font-semibold text-foreground">
          {batch.product_name}
        </Heading>
      </header>

      <div className="space-y-1.5">
        <p className="flex items-baseline justify-between gap-2 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">
              {formatQuantity(batch.current_quantity, batch.unit_code)}
            </span>{" "}
            de {formatQuantity(batch.initial_quantity, batch.unit_code)}
          </span>
          <span className="text-xs">{percent} % restante</span>
        </p>
        <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-surface-high">
          <div className={cn("h-full rounded-full", tone.fill)} style={{ width: `${percent}%` }} />
        </div>
      </div>

      <footer className="flex justify-end">
        <button
          type="button"
          onClick={() => onConsume(batch)}
          className={buttonVariants({ variant: "secondary", size: "md" })}
        >
          <Utensils aria-hidden="true" className="size-4" />
          <span>
            Consumir<span className="sr-only"> {batch.product_name}</span>
            <span aria-hidden="true">…</span>
          </span>
        </button>
      </footer>
    </article>
  );
}
