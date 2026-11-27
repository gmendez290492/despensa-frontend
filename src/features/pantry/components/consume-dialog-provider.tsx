"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useStatusAnnouncer } from "@/components/status-announcer";
import { groupByProduct } from "@/features/pantry/fefo";
import { useActivePantry, useBatches } from "@/features/pantry/hooks";
import { ConsumeDialog } from "@/features/pantry/components/consume-dialog";

/** API de {@link useConsumeDialog}. */
export interface ConsumeDialogApi {
  /**
   * Abre el diálogo de consumo. Llámalo desde el `onClick` de un `<button>`:
   * al cerrarse, el navegador devuelve el foco a ese botón.
   *
   * @param productId - Producto preseleccionado (opcional).
   */
  openConsume: (productId?: string) => void;
}

const ConsumeDialogContext = createContext<ConsumeDialogApi | null>(null);

/**
 * Monta un único {@link ConsumeDialog} para todo el shell autenticado (panel e
 * inventario) con los productos en stock del hogar activo, y anuncia el
 * resultado en la región de estado del shell.
 *
 * @param props.children - Páginas del shell.
 * @returns El proveedor y el diálogo.
 */
export function ConsumeDialogProvider({ children }: { children: ReactNode }) {
  const { pantry } = useActivePantry();
  const batches = useBatches(pantry?.id ?? null);
  const { announce } = useStatusAnnouncer();
  const [state, setState] = useState<{ open: boolean; productId: string | null }>({
    open: false,
    productId: null,
  });

  const products = useMemo(() => groupByProduct(batches.data ?? []), [batches.data]);
  const openConsume = useCallback(
    (productId?: string) => setState({ open: true, productId: productId ?? null }),
    [],
  );
  const value = useMemo(() => ({ openConsume }), [openConsume]);

  return (
    <ConsumeDialogContext.Provider value={value}>
      {children}
      {pantry ? (
        <ConsumeDialog
          open={state.open}
          onClose={() => setState((previous) => ({ ...previous, open: false }))}
          pantryId={pantry.id}
          products={products}
          defaultProductId={state.productId}
          onConsumed={announce}
        />
      ) : null}
    </ConsumeDialogContext.Provider>
  );
}

/**
 * Acceso al diálogo de consumo compartido.
 *
 * @returns {@link ConsumeDialogApi}.
 * @throws {Error} Fuera de {@link ConsumeDialogProvider}.
 */
export function useConsumeDialog(): ConsumeDialogApi {
  const context = useContext(ConsumeDialogContext);
  if (!context) throw new Error("useConsumeDialog debe usarse dentro de <ConsumeDialogProvider>.");
  return context;
}
