"use client";

import { CloudUpload, TriangleAlert } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { discardOutboxRecord, useOutboxRecords, useOutboxSync } from "@/features/pantry/hooks";

type SyncNow = () => Promise<void>;

const OutboxSyncContext = createContext<SyncNow | null>(null);
const NOOP_SYNC: SyncNow = async () => undefined;

/**
 * Drena la outbox offline (al montar, al volver la red y al volver la
 * pestaña) y expone `syncNow` a su subárbol ({@link useOutboxSyncNow}).
 * Montar **una sola vez** en el layout autenticado, envolviendo el shell.
 *
 * @remarks Un solo `useOutboxSync()` por pestaña: llamarlo en cada consumidor
 * duplicaría los *listeners* `online`/`visibilitychange` y los temporizadores
 * de reintento.
 *
 * @param props.children - Shell autenticado (opcional).
 * @returns El proveedor de `syncNow`.
 */
export function OutboxSync({ children }: { children?: ReactNode }) {
  const { syncNow } = useOutboxSync();
  return <OutboxSyncContext.Provider value={syncNow}>{children}</OutboxSyncContext.Provider>;
}

/**
 * Fuerza un drenado de la outbox desde cualquier hoja del shell (p. ej.
 * "Sincronizar ahora" antes de cerrar sesión).
 *
 * @returns `syncNow` del {@link OutboxSync} más cercano; fuera de él, una
 *   función que no hace nada.
 */
export function useOutboxSyncNow(): SyncNow {
  return useContext(OutboxSyncContext) ?? NOOP_SYNC;
}

/**
 * Aviso de cambios sin sincronizar y conflictos de la outbox (patrón Client
 * Outbox). Muestra "N cambios pendientes" y, por cada conflicto (FastAPI
 * respondió un error de negocio al reintentar, p. ej. `insufficient-stock`),
 * su descripción, el `detail` del servidor y un botón "Descartar".
 *
 * @remarks
 * - El recuento va en una región `role="status"` (cortés): se anuncia al
 *   cambiar sin mover el foco.
 * - Los conflictos son contenido normal (no `role="alert"`): ya ocurrieron en
 *   segundo plano y el usuario decide cuándo revisarlos; su existencia se
 *   anuncia en la misma región de estado.
 * - "Descartar" nombra el cambio en su nombre accesible ("Descartar Leche · 1 l").
 *
 * @returns El banner o una región de estado vacía si no hay nada pendiente.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `accessibility` (mensajes de estado, WCAG 4.1.3).
 */
export function OutboxBanner() {
  const records = useOutboxRecords();
  const [discarding, setDiscarding] = useState<number | null>(null);

  const pending = records.filter((record) => record.status !== "conflict");
  const conflicts = records.filter((record) => record.status === "conflict");

  const summary = [
    pending.length > 0
      ? `${pending.length} ${pending.length === 1 ? "cambio pendiente" : "cambios pendientes"} de sincronizar.`
      : null,
    conflicts.length > 0
      ? `${conflicts.length} ${conflicts.length === 1 ? "cambio no se pudo aplicar" : "cambios no se pudieron aplicar"}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const onDiscard = async (id: number) => {
    setDiscarding(id);
    try {
      await discardOutboxRecord(id);
    } finally {
      setDiscarding(null);
    }
  };

  return (
    <div className="space-y-2">
      <p
        role="status"
        className={
          summary
            ? "flex items-start gap-2 rounded-[4px] border border-amber-status/25 bg-amber-status/10 p-3 text-[0.8125rem] font-semibold text-amber-status"
            : "sr-only"
        }
      >
        {summary ? <CloudUpload aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
        <span>{summary}</span>
      </p>

      {conflicts.length > 0 ? (
        <section
          aria-labelledby="outbox-conflicts-title"
          className="rounded-[4px] border border-terracotta/25 bg-terracotta/8 p-3 text-terracotta-strong"
        >
          <h2 id="outbox-conflicts-title" className="flex items-center gap-2 text-[0.8125rem] font-bold">
            <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
            Cambios con conflicto
          </h2>
          <ul className="mt-2 space-y-2">
            {conflicts.map((record) => (
              <li
                key={record.id ?? record.clientMutationId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] bg-surface-lowest p-2.5"
              >
                <div className="min-w-0 text-[0.8125rem]">
                  <p className="font-semibold text-foreground">{record.label ?? "Cambio sin sincronizar"}</p>
                  <p className="text-terracotta-strong">
                    {record.lastError?.detail ?? record.lastError?.title ?? "El servidor rechazó este cambio."}
                  </p>
                </div>
                {record.id !== undefined ? (
                  <Button
                    variant="secondary"
                    size="md"
                    loading={discarding === record.id}
                    loadingText="Descartando…"
                    onClick={() => void onDiscard(record.id!)}
                  >
                    Descartar
                    <span className="sr-only"> {record.label ?? "cambio"}</span>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
