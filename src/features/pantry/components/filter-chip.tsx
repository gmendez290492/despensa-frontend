import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Props de {@link FilterChip}. */
export interface FilterChipProps extends Omit<ComponentProps<"button">, "type" | "aria-pressed"> {
  /** Filtro activo (`aria-pressed="true"`). */
  pressed: boolean;
  /** Recuento visible junto a la etiqueta (forma parte del nombre accesible). */
  count?: number;
  /** Icono decorativo previo (`aria-hidden`). */
  icon?: ReactNode;
}

/**
 * Chip de filtro conmutable (`<button aria-pressed>`) para grupos de filtros
 * en la URL (plazo, ubicación, semáforo). Objetivo táctil >= 44 px.
 *
 * @remarks El estado activo no depende solo del color: relleno sólido y un
 * icono de check (visual) además de `aria-pressed="true"` para lectores de
 * pantalla. El nombre no repite "seleccionado" (lo expone
 * `aria-pressed`). El borde en reposo usa `--input-border` (3.97:1 sobre
 * blanco) y no `--outline-variant` (1.70:1): el límite del control necesita
 * 3:1 (WCAG 1.4.11).
 *
 * @param props - {@link FilterChipProps}.
 * @returns Un `<button type="button">`.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `accessibility` ("Manage toggle states") y `color` (contraste no textual).
 */
export function FilterChip({ pressed, count, icon, className, children, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-[4px] border px-3 text-[0.8125rem] font-semibold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container",
        "border-input-border bg-surface-lowest text-foreground hover:bg-surface-low",
        "aria-pressed:border-primary-container aria-pressed:bg-primary-container aria-pressed:text-primary-foreground",
        className,
      )}
      {...props}
    >
      {pressed ? <Check aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.6} /> : null}
      {icon}
      <span>{children}</span>
      {count !== undefined ? (
        <span className="tabular-nums opacity-90">({count})</span>
      ) : null}
    </button>
  );
}
