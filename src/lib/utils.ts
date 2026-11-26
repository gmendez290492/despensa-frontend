import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina clases condicionales (`clsx`) y resuelve conflictos de Tailwind (`tailwind-merge`).
 *
 * @param inputs - Clases, objetos condicionales o arrays.
 * @returns Cadena de clases sin duplicados en conflicto.
 *
 * @example
 * ```ts
 * cn("px-4", isActive && "bg-primary", className); // "px-4 bg-primary …"
 * ```
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
