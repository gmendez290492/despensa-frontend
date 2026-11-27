import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

/** Estado de conexión mostrado en la UI (`syncing` mientras se vacía la outbox). */
export type ConnectionStatus = "online" | "offline" | "syncing";

/** Borrador local de un artículo escaneado en modo continuo (aún no enviado a FastAPI). */
export interface ScannedDraftItem {
  tempId: string;
  barcode: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  unitCode: "g" | "kg" | "ml" | "l" | "pza";
  expirationDate: string;
}

/** Estado global de UI (Capa 4). Prohibido guardar aquí respuestas crudas del backend. */
export interface UiState {
  activePantryId: string | null;
  connectionStatus: ConnectionStatus;
  continuousScanQueue: ScannedDraftItem[];
  setActivePantryId: (pantryId: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  enqueueScannedItem: (item: ScannedDraftItem) => void;
  removeScannedItem: (tempId: string) => void;
  clearContinuousScanQueue: () => void;
}

/**
 * Store Zustand de UI con `devtools` y `persist`. Solo se persisten
 * `activePantryId` y `continuousScanQueue`; `connectionStatus` se recalcula.
 *
 * @example
 * ```tsx
 * const pantryId = useUiStore((state) => state.activePantryId);
 * ```
 */
export const useUiStore = create<UiState>()(
  devtools(
    persist(
      (set) => ({
        activePantryId: null,
        connectionStatus: "online",
        continuousScanQueue: [],

        setActivePantryId: (pantryId) =>
          set({ activePantryId: pantryId }, false, "ui/setActivePantryId"),

        setConnectionStatus: (status) =>
          set({ connectionStatus: status }, false, "ui/setConnectionStatus"),

        enqueueScannedItem: (item) =>
          set(
            (state) => ({
              continuousScanQueue: [...state.continuousScanQueue, item],
            }),
            false,
            "ui/enqueueScannedItem",
          ),

        removeScannedItem: (tempId) =>
          set(
            (state) => ({
              continuousScanQueue: state.continuousScanQueue.filter(
                (entry) => entry.tempId !== tempId,
              ),
            }),
            false,
            "ui/removeScannedItem",
          ),

        clearContinuousScanQueue: () =>
          set({ continuousScanQueue: [] }, false, "ui/clearContinuousScanQueue"),
      }),
      {
        name: "despensa-ui-storage",
        partialize: (state) => ({
          activePantryId: state.activePantryId,
          continuousScanQueue: state.continuousScanQueue,
        }),
      },
    ),
    // Redux DevTools solo en desarrollo: en producción no se expone el estado
    // de UI (activePantryId, cola de escaneo) a extensiones del navegador.
    { name: "DespensaUIStore", enabled: process.env.NODE_ENV !== "production" },
  ),
);
