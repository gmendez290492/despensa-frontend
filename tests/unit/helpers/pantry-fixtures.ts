import type { FoodBatchResponse, LocationResponse } from "@/features/pantry/api";

/** UUIDs válidos (los esquemas Zod usan `z.guid()`). */
export const IDS = {
  pantry: "11111111-1111-4111-8111-111111111111",
  fridge: "22222222-2222-4222-8222-222222222222",
  larder: "33333333-3333-4333-8333-333333333333",
  milk: "44444444-4444-4444-8444-444444444444",
  rice: "55555555-5555-4555-8555-555555555555",
  yogurt: "66666666-6666-4666-8666-666666666666",
} as const;

let seq = 0;

/** Lote de prueba con valores por defecto razonables. */
export function makeBatch(overrides: Partial<FoodBatchResponse> = {}): FoodBatchResponse {
  seq += 1;
  return {
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(seq).padStart(12, "0")}`,
    location_id: IDS.fridge,
    product_id: IDS.milk,
    product_name: "Leche",
    unit_code: "l",
    initial_quantity: "2",
    current_quantity: "1.5",
    expiration_date: "2026-11-27",
    purchase_date: "2026-11-20",
    unit_cost: null,
    status: "available",
    dias_para_vencer: 1,
    semaforo: "CRÍTICO",
    ...overrides,
  };
}

/** Ubicaciones de prueba. */
export const LOCATIONS: LocationResponse[] = [
  { id: IDS.fridge, pantry_id: IDS.pantry, name: "Nevera", description: null, created_at: "2026-01-01T00:00:00Z" },
  { id: IDS.larder, pantry_id: IDS.pantry, name: "Alacena", description: null, created_at: "2026-01-01T00:00:00Z" },
];
