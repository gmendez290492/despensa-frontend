import type { Semaforo } from "@/features/pantry/api";
import { SEMAFORO_LABEL } from "@/features/pantry/fefo";
import { SEMAFORO_TONE } from "@/features/pantry/semaforo-ui";
import { cn } from "@/lib/utils";

/** Props de {@link SemaforoBadge}. */
export interface SemaforoBadgeProps {
  /** Estado FEFO calculado por FastAPI. */
  semaforo: Semaforo;
  /** Texto secundario tras el estado (p. ej. "Vence mañana"). */
  detail?: string;
  className?: string;
}

/**
 * Badge del semáforo FEFO: icono + etiqueta textual + tinte. El estado nunca
 * depende solo del color (WCAG 1.4.1) y la tinta cumple 4.5:1 sobre el tinte.
 *
 * @remarks Sin hooks ni `"use client"`: se renderiza igual en RSC y en hojas
 * cliente. El texto se muestra en mayúsculas por CSS (`ÓPTIMO`, `CRÍTICO`…)
 * pero el lector de pantalla lee la palabra normal ("Crítico"), sin deletrear.
 *
 * @param props - {@link SemaforoBadgeProps}.
 * @returns Un `<span>` en línea.
 *
 * @example
 * ```tsx
 * <SemaforoBadge semaforo="CRÍTICO" detail="Vence mañana" />
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `forms` ("use non-color visual cues").
 */
export function SemaforoBadge({ semaforo, detail, className }: SemaforoBadgeProps) {
  const tone = SEMAFORO_TONE[semaforo];
  const Icon = tone.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[0.6875rem] leading-4 font-bold",
        tone.badge,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.2} />
      <span className="tracking-wider uppercase">{SEMAFORO_LABEL[semaforo]}</span>
      {detail ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="font-semibold">{detail}</span>
        </>
      ) : null}
    </span>
  );
}
