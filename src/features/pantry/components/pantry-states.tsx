"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RotateCw, ShieldAlert, TriangleAlert, WifiOff } from "lucide-react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { pantryKeys, type PantryResponse } from "@/features/pantry/api";
import { useActivePantry, type ActivePantryState } from "@/features/pantry/hooks";
import { PantryOnboarding } from "@/features/pantry/components/pantry-onboarding";
import { PROBLEM_TYPES, type ProblemDetailError } from "@/lib/api/problem";
import { BFF_REFRESH_REDIRECT_PATH } from "@/lib/auth/constants";
import { cn } from "@/lib/utils";

/**
 * Bloque gris animado (solo con `prefers-reduced-motion: no-preference`).
 *
 * @param props.className - Tamaño y forma.
 * @returns Un `<div>` decorativo.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `motion`.
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("rounded-[4px] bg-surface-high motion-safe:animate-pulse", className)} />;
}

/**
 * Esqueleto de una lista de tarjetas de lote, con la misma altura aproximada
 * que el contenido real para no provocar *layout shift*.
 *
 * @param props.label - Texto para lectores de pantalla ("Cargando inventario").
 * @param props.cards - Número de tarjetas simuladas.
 * @returns Región `role="status"` con el esqueleto.
 */
export function PantrySkeleton({ label, cards = 3 }: { label: string; cards?: number }) {
  return (
    <div role="status" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <SkeletonBlock className="h-24" />
        <SkeletonBlock className="h-24" />
      </div>
      {Array.from({ length: cards }, (_, index) => (
        <SkeletonBlock key={index} className="h-36" />
      ))}
    </div>
  );
}

/** Props de {@link PantryErrorState}. */
export interface PantryErrorStateProps {
  error: ProblemDetailError;
  /** Reintenta la query que falló. */
  onRetry: () => void;
  className?: string;
}

/**
 * Estado de error de las queries del hogar (RFC 7807):
 * - `403 pantry-access-denied` → explica que se perdió el acceso y recarga los
 *   hogares (invalida todo el dominio `pantry`; `useActivePantry` elige otro).
 * - `401` → enlace a `GET /api/bff/auth/refresh?next=` (rota o lleva a login).
 * - Error de red → aviso de conexión.
 * - Resto → mensaje genérico con "Código de soporte" (`correlation_id`).
 *
 * @param props - {@link PantryErrorStateProps}.
 * @returns Un bloque `role="alert"`.
 */
export function PantryErrorState({ error, onRetry, className }: PantryErrorStateProps) {
  const queryClient = useQueryClient();
  const pathname = usePathname();

  const accessDenied = error.is(PROBLEM_TYPES.pantryAccessDenied);
  const sessionExpired = error.status === 401;
  const network = error.status === 0 || error.is(PROBLEM_TYPES.networkError);

  const Icon = accessDenied ? ShieldAlert : network ? WifiOff : TriangleAlert;
  const title = accessDenied
    ? "Ya no tienes acceso a este hogar"
    : sessionExpired
      ? "Tu sesión expiró"
      : network
        ? "Sin conexión con el servidor"
        : "No pudimos cargar tu despensa";
  const message = accessDenied
    ? "Puede que te hayan quitado del hogar. Recarga tus hogares para continuar con otro."
    : sessionExpired
      ? "Vuelve a iniciar sesión para seguir."
      : network
        ? "Revisa tu conexión e inténtalo de nuevo."
        : "Inténtalo de nuevo en unos segundos; si persiste, contacta a soporte.";

  return (
    <div
      role="alert"
      className={cn("rounded-[4px] border border-terracotta/25 bg-terracotta/8 p-4 text-terracotta-strong", className)}
    >
      <p className="flex items-center gap-2 text-sm font-bold">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {title}
      </p>
      <p className="mt-1 text-[0.8125rem]">{message}</p>
      {!accessDenied && !sessionExpired && !network && error.correlation_id ? (
        <p className="mt-1 text-[0.6875rem] break-all opacity-90">Código de soporte: {error.correlation_id}</p>
      ) : null}
      <div className="mt-3">
        {sessionExpired ? (
          // Navegación completa: es un Route Handler que redirige.
          <a
            href={`${BFF_REFRESH_REDIRECT_PATH}?next=${encodeURIComponent(pathname)}`}
            className="inline-flex min-h-11 items-center font-semibold text-primary-container underline underline-offset-4"
          >
            Inicia sesión de nuevo
          </a>
        ) : accessDenied ? (
          <Button
            variant="secondary"
            size="md"
            onClick={() => void queryClient.invalidateQueries({ queryKey: pantryKeys.all })}
          >
            <RotateCw aria-hidden="true" className="size-4" />
            Recargar hogares
          </Button>
        ) : (
          <Button variant="secondary" size="md" onClick={onRetry}>
            <RotateCw aria-hidden="true" className="size-4" />
            Reintentar
          </Button>
        )}
      </div>
    </div>
  );
}

/** Estado del hogar activo garantizado por {@link PantryGate}. */
export type ReadyPantryState = ActivePantryState & { pantry: PantryResponse };

/** Props de {@link PantryGate}. */
export interface PantryGateProps {
  /** Esqueleto mientras cargan los hogares. */
  fallback: ReactNode;
  /** Contenido con un hogar activo. */
  children: (state: ReadyPantryState) => ReactNode;
}

/**
 * Resuelve el hogar activo: esqueleto mientras carga, error RFC 7807,
 * onboarding (crear / unirse) si el usuario no tiene hogares, o `children`.
 *
 * @param props - {@link PantryGateProps}.
 * @returns El estado correspondiente.
 */
export function PantryGate({ fallback, children }: PantryGateProps) {
  const active = useActivePantry();
  if (active.isLoading) return <>{fallback}</>;
  if (active.error) return <PantryErrorState error={active.error} onRetry={active.refetch} />;
  if (!active.pantry) return <PantryOnboarding />;
  return <>{children({ ...active, pantry: active.pantry })}</>;
}
