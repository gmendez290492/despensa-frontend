import { CircleCheck, Clock, OctagonAlert, type LucideIcon, CircleX } from "lucide-react";
import type { Semaforo } from "@/features/pantry/api";

/**
 * Presentación del semáforo FEFO (iconos, clases de token y slugs de URL).
 * Separado de `fefo.ts` (reglas puras de dominio) para no mezclar UI y dominio.
 */

/** Estilos por estado. Solo tokens de `globals.css`; el color nunca va solo. */
export interface SemaforoTone {
  /** Icono `lucide-react` (siempre `aria-hidden`; el texto da el significado). */
  icon: LucideIcon;
  /** Tinte de fondo + borde + tinta (>= 4.5:1) para badges y chips. */
  badge: string;
  /** Relleno sólido para barras y puntos decorativos. */
  fill: string;
  /** Solo la tinta (texto/ícono) para leyendas. */
  ink: string;
}

/** Tonos por estado del semáforo. */
export const SEMAFORO_TONE: Record<Semaforo, SemaforoTone> = {
  ÓPTIMO: {
    icon: CircleCheck,
    badge: "border-semaforo-optimo/30 bg-semaforo-optimo/12 text-semaforo-optimo-ink",
    fill: "bg-semaforo-optimo",
    ink: "text-semaforo-optimo-ink",
  },
  PRECAUCIÓN: {
    icon: Clock,
    badge: "border-semaforo-precaucion/40 bg-semaforo-precaucion/12 text-semaforo-precaucion-ink",
    fill: "bg-semaforo-precaucion",
    ink: "text-semaforo-precaucion-ink",
  },
  CRÍTICO: {
    icon: OctagonAlert,
    badge: "border-semaforo-critico/30 bg-semaforo-critico/12 text-semaforo-critico-ink",
    fill: "bg-semaforo-critico",
    ink: "text-semaforo-critico-ink",
  },
  VENCIDO: {
    icon: CircleX,
    badge: "border-semaforo-vencido/30 bg-semaforo-vencido/12 text-semaforo-vencido-ink",
    fill: "bg-semaforo-vencido",
    ink: "text-semaforo-vencido-ink",
  },
};

/**
 * Slugs ASCII para `?semaforo=` (la URL compartible no lleva tildes
 * codificadas: `?semaforo=critico` en vez de `?semaforo=CR%C3%8DTICO`).
 */
export const SEMAFORO_SLUGS = ["vencido", "critico", "precaucion", "optimo"] as const;

/** Unión de {@link SEMAFORO_SLUGS}. */
export type SemaforoSlug = (typeof SEMAFORO_SLUGS)[number];

const SLUG_TO_SEMAFORO: Record<SemaforoSlug, Semaforo> = {
  vencido: "VENCIDO",
  critico: "CRÍTICO",
  precaucion: "PRECAUCIÓN",
  optimo: "ÓPTIMO",
};

/**
 * Convierte el slug de la URL en el valor del backend.
 *
 * @param slug - Slug de `?semaforo=` o `null`.
 * @returns El {@link Semaforo} o `null` si no hay filtro.
 */
export function semaforoFromSlug(slug: SemaforoSlug | null): Semaforo | null {
  return slug ? SLUG_TO_SEMAFORO[slug] : null;
}

/**
 * Convierte un valor del backend en su slug de URL.
 *
 * @param semaforo - Estado FEFO.
 * @returns Slug ASCII.
 */
export function semaforoToSlug(semaforo: Semaforo): SemaforoSlug {
  return (Object.keys(SLUG_TO_SEMAFORO) as SemaforoSlug[]).find(
    (slug) => SLUG_TO_SEMAFORO[slug] === semaforo,
  )!;
}
