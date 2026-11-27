import { describe, expect, it } from "vitest";
import type { FoodBatchResponse } from "@/features/pantry/api";
import {
  applyOptimisticConsume,
  ageBatches,
  applyPendingConsumes,
  computeSemaforo,
  computeStats,
  elapsedCalendarDays,
  expiryLabel,
  filterBatches,
  groupByProduct,
  inStock,
  matchesWindow,
  OptimisticInsufficientStockError,
  localDayKey,
  remainingPercent,
} from "@/features/pantry/fefo";

const MILK = "aaaaaaaa-0000-4000-8000-000000000001";
const RICE = "aaaaaaaa-0000-4000-8000-000000000002";

let seq = 0;
function batch(overrides: Partial<FoodBatchResponse> = {}): FoodBatchResponse {
  seq += 1;
  const days = overrides.dias_para_vencer ?? 10;
  return {
    id: `batch-${seq}`,
    location_id: "loc-fridge",
    product_id: MILK,
    product_name: "Leche",
    unit_code: "l",
    initial_quantity: "2",
    current_quantity: "2",
    expiration_date: "2026-12-10",
    purchase_date: "2026-11-20",
    unit_cost: null,
    status: "available",
    dias_para_vencer: days,
    semaforo: computeSemaforo(days),
    ...overrides,
  } as FoodBatchResponse;
}

describe("applyOptimisticConsume (réplica de consume_product_fefo)", () => {
  it("descuenta primero del lote que vence antes, sin importar el orden de la lista", () => {
    const late = batch({ id: "late", expiration_date: "2026-12-20", current_quantity: "1" });
    const early = batch({ id: "early", expiration_date: "2026-12-01", current_quantity: "1" });
    const result = applyOptimisticConsume([late, early], MILK, "0.4");
    expect(result.find((b) => b.id === "early")!.current_quantity).toBe("0.6");
    expect(result.find((b) => b.id === "late")!.current_quantity).toBe("1");
  });

  it("multi-lote: agota el primero (desaparece, como `consumed`) y sigue con el siguiente", () => {
    const a = batch({ id: "a", expiration_date: "2026-12-01", current_quantity: "0.5" });
    const b = batch({ id: "b", expiration_date: "2026-12-05", current_quantity: "1" });
    const c = batch({ id: "c", expiration_date: "2026-12-09", current_quantity: "3" });
    const rice = batch({ id: "r", product_id: RICE, expiration_date: "2026-11-01", current_quantity: "5" });

    const result = applyOptimisticConsume([rice, c, b, a], MILK, "1.2");

    expect(result.map((x) => [x.id, x.current_quantity])).toEqual([
      ["r", "5"],
      ["c", "3"],
      ["b", "0.3"],
    ]);
  });

  it("consumir exactamente el total deja el producto sin lotes", () => {
    const a = batch({ current_quantity: "0.1" });
    const b = batch({ current_quantity: "0.2", expiration_date: "2026-12-11" });
    expect(applyOptimisticConsume([a, b], MILK, "0.3")).toEqual([]);
  });

  it("incluye lotes ya vencidos (FEFO no los salta)", () => {
    const expired = batch({ id: "exp", expiration_date: "2026-11-20", dias_para_vencer: -6, current_quantity: "1" });
    const fresh = batch({ id: "fresh", expiration_date: "2026-12-20", current_quantity: "1" });
    const result = applyOptimisticConsume([fresh, expired], MILK, "1");
    expect(result.map((x) => x.id)).toEqual(["fresh"]);
  });

  it("insuficiente lanza OptimisticInsufficientStockError con el disponible y no muta la entrada", () => {
    const a = batch({ current_quantity: "0.1" });
    const b = batch({ current_quantity: "0.2" });
    const input = [a, b];
    const snapshot = structuredClone(input);
    expect(() => applyOptimisticConsume(input, MILK, "0.301")).toThrow(OptimisticInsufficientStockError);
    try {
      applyOptimisticConsume(input, MILK, "0.301");
    } catch (error) {
      expect((error as OptimisticInsufficientStockError).available).toBe("0.3");
    }
    expect(input).toEqual(snapshot);
  });

  it("producto sin lotes lanza con disponible 0", () => {
    expect(() => applyOptimisticConsume([batch()], RICE, "1")).toThrow(/disponible: 0/);
  });
});

describe("applyPendingConsumes (rebase de la outbox sobre datos del servidor)", () => {
  it("re-aplica los consumos pendientes en orden FIFO", () => {
    const a = batch({ id: "a", expiration_date: "2026-12-01", current_quantity: "1" });
    const b = batch({ id: "b", expiration_date: "2026-12-05", current_quantity: "1" });
    const result = applyPendingConsumes([a, b], [
      { productId: MILK, quantity: "0.5" },
      { productId: MILK, quantity: "0.7" },
    ]);
    expect(result.map((x) => [x.id, x.current_quantity])).toEqual([["b", "0.8"]]);
  });

  it("omite los que ya no caben (serán conflicto al drenar) y aplica los siguientes", () => {
    const a = batch({ id: "a", current_quantity: "1" });
    const result = applyPendingConsumes([a], [
      { productId: MILK, quantity: "5" },
      { productId: MILK, quantity: "0.25" },
    ]);
    expect(result[0]!.current_quantity).toBe("0.75");
  });
});

describe("semáforo (umbrales de calcular_semaforo)", () => {
  it.each([
    [-30, "VENCIDO"],
    [-1, "VENCIDO"],
    [0, "VENCIDO"],
    [1, "CRÍTICO"],
    [3, "CRÍTICO"],
    [4, "PRECAUCIÓN"],
    [7, "PRECAUCIÓN"],
    [8, "ÓPTIMO"],
    [365, "ÓPTIMO"],
  ])("%d días → %s", (days, expected) => {
    expect(computeSemaforo(days)).toBe(expected);
  });

  it("localDayKey y elapsedCalendarDays usan la fecha local, inmunes a la hora y al cambio de horario", () => {
    expect(localDayKey(new Date(2026, 10, 26, 0, 1))).toBe("2026-11-26");
    expect(localDayKey(new Date(2026, 10, 26, 23, 59))).toBe("2026-11-26");
    expect(elapsedCalendarDays("2026-11-26", "2026-11-29")).toBe(3);
    expect(elapsedCalendarDays("2026-11-26", "2026-11-20")).toBe(-6);
    // Cruza el cambio de horario de marzo (Europa) sin desfase.
    expect(elapsedCalendarDays("2027-03-20", "2027-04-01")).toBe(12);
  });

  it("ageBatches no toca datos de hoy y envejece los de días anteriores", () => {
    const fetchedAt = new Date(2026, 10, 20, 22).getTime();
    const cached = [batch({ dias_para_vencer: 10 }), batch({ dias_para_vencer: 2 })];
    expect(ageBatches(cached, fetchedAt, "2026-11-20")).toBe(cached);

    const aged = ageBatches(cached, fetchedAt, "2026-11-26");
    expect(aged.map((item) => [item.dias_para_vencer, item.semaforo])).toEqual([
      [4, "PRECAUCIÓN"],
      [-4, "VENCIDO"],
    ]);
    expect(cached[0]!.dias_para_vencer).toBe(10); // no muta la caché
  });
});

describe("ventanas de prioridad", () => {
  it.each([
    [-2, { todos: true, vencidos: true, "48h": false, semana: false }],
    [0, { todos: true, vencidos: true, "48h": false, semana: false }],
    [1, { todos: true, vencidos: false, "48h": true, semana: true }],
    [2, { todos: true, vencidos: false, "48h": true, semana: true }],
    [3, { todos: true, vencidos: false, "48h": false, semana: true }],
    [7, { todos: true, vencidos: false, "48h": false, semana: true }],
    [8, { todos: false, vencidos: false, "48h": false, semana: false }],
  ] as const)("%d días", (days, expected) => {
    for (const [window, value] of Object.entries(expected)) {
      expect(matchesWindow({ dias_para_vencer: days }, window as keyof typeof expected)).toBe(value);
    }
  });

  it("'todos' coincide con lo no ÓPTIMO del semáforo", () => {
    for (let days = -5; days <= 15; days++) {
      expect(matchesWindow({ dias_para_vencer: days }, "todos")).toBe(computeSemaforo(days) !== "ÓPTIMO");
    }
  });
});

describe("stats, agrupación y filtros", () => {
  const batches = [
    batch({ id: "v", dias_para_vencer: -1, current_quantity: "1" }),
    batch({ id: "c", dias_para_vencer: 2, current_quantity: "1", expiration_date: "2026-11-28" }),
    batch({ id: "p", dias_para_vencer: 5, product_id: RICE, product_name: "Arroz", unit_code: "kg", location_id: "loc-pantry" }),
    batch({ id: "o", dias_para_vencer: 30, product_id: RICE, product_name: "Arroz", unit_code: "kg", location_id: "loc-pantry" }),
    batch({ id: "zero", dias_para_vencer: 30, current_quantity: "0" }),
  ];

  it("computeStats ignora lotes sin stock y cuenta acción requerida (VENCIDO + CRÍTICO)", () => {
    expect(computeStats(batches)).toEqual({
      total: 4,
      bySemaforo: { VENCIDO: 1, CRÍTICO: 1, PRECAUCIÓN: 1, ÓPTIMO: 1 },
      actionRequired: 2,
      optimalPercent: 25,
    });
    expect(computeStats([]).optimalPercent).toBe(0);
  });

  it("inStock filtra ceros", () => {
    expect(inStock(batches).map((b) => b.id)).not.toContain("zero");
  });

  it("groupByProduct suma con decimales exactos y elige el lote más urgente", () => {
    const groups = groupByProduct([
      batch({ id: "m1", current_quantity: "0.1", expiration_date: "2026-12-09" }),
      batch({ id: "m2", current_quantity: "0.2", expiration_date: "2026-12-01" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ available: "0.3", batchCount: 2 });
    expect(groups[0]!.firstBatch.id).toBe("m2");
  });

  it("filterBatches por texto sin acentos, ubicación y semáforo", () => {
    const locations = [{ id: "loc-pantry", name: "Alacena" }] as never;
    expect(filterBatches(batches, { q: "ARROZ" }).map((b) => b.id)).toEqual(["p", "o"]);
    expect(filterBatches(batches, { q: "alacena" }, locations).map((b) => b.id)).toEqual(["p", "o"]);
    expect(filterBatches(batches, { locationId: "loc-fridge" }).map((b) => b.id)).toEqual(["v", "c"]);
    expect(filterBatches(batches, { semaforo: "CRÍTICO" }).map((b) => b.id)).toEqual(["c"]);
  });

  it("remainingPercent y expiryLabel", () => {
    expect(remainingPercent({ initial_quantity: "2", current_quantity: "0.5" })).toBe(25);
    expect(remainingPercent({ initial_quantity: "0", current_quantity: "1" })).toBe(0);
    expect(expiryLabel(-3)).toBe("Venció hace 3 días");
    expect(expiryLabel(-1)).toBe("Venció ayer");
    expect(expiryLabel(0)).toBe("Vence hoy");
    expect(expiryLabel(1)).toBe("Vence mañana");
    expect(expiryLabel(5)).toBe("Vence en 5 días");
  });
});
