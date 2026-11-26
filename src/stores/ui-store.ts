import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

export type ConnectionStatus = "online" | "offline" | "syncing";

export interface ScannedDraftItem {
  tempId: string;
  barcode: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  unitCode: "g" | "kg" | "ml" | "l" | "pza";
  expirationDate: string;
}

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
    { name: "DespensaUIStore" },
  ),
);
