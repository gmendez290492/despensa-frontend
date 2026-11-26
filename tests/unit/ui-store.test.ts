import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/stores/ui-store";

describe("useUiStore (Zustand)", () => {
  beforeEach(() => {
    useUiStore.setState({
      activePantryId: null,
      connectionStatus: "online",
      continuousScanQueue: [],
    });
  });

  it("actualiza la despensa activa y el estado de conexión", () => {
    useUiStore.getState().setActivePantryId("pantry-123");
    useUiStore.getState().setConnectionStatus("offline");

    expect(useUiStore.getState().activePantryId).toBe("pantry-123");
    expect(useUiStore.getState().connectionStatus).toBe("offline");
  });

  it("gestiona la cola del modo Escaneo Continuo por Lote", () => {
    useUiStore.getState().enqueueScannedItem({
      tempId: "tmp-1",
      barcode: "7501000123456",
      productId: null,
      productName: "Leche Entera 1L",
      quantity: 2,
      unitCode: "pza",
      expirationDate: "2026-12-05",
    });

    expect(useUiStore.getState().continuousScanQueue).toHaveLength(1);
    expect(useUiStore.getState().continuousScanQueue[0]?.productName).toBe(
      "Leche Entera 1L",
    );

    useUiStore.getState().removeScannedItem("tmp-1");
    expect(useUiStore.getState().continuousScanQueue).toHaveLength(0);
  });
});
