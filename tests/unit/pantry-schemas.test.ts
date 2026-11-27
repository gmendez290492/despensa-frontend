import { describe, expect, it } from "vitest";
import {
  consumeSchema,
  createBatchSchema,
  createProductSchema,
  joinPantrySchema,
  productSearchSchema,
  quantitySchema,
} from "@/lib/pantry/schemas";

describe("quantitySchema (Numeric(10,3) como string)", () => {
  it.each([
    ["1,5", "1.5"],
    ["001.50", "1.5"],
    ["  2  ", "2"],
    ["0.5", "0.5"],
    ["0,001", "0.001"],
    ["10.000", "10"],
    ["9999999.999", "9999999.999"],
    [1.25, "1.25"],
    [3, "3"],
  ])("%s → %s", (input, expected) => {
    expect(quantitySchema.parse(input)).toBe(expected);
  });

  it.each([
    ["0"],
    ["0.000"],
    [0],
    ["-1"],
    [-1],
    ["1.2345"],
    ["12345678"],
    ["1e3"],
    ["abc"],
    [""],
    ["1,5,3"],
    ["١٢"],
  ])("rechaza %s", (input) => {
    expect(quantitySchema.safeParse(input).success).toBe(false);
  });
});

describe("consumeSchema", () => {
  it("normaliza la cantidad y descarta campos desconocidos (FastAPI usa extra=forbid)", () => {
    const parsed = consumeSchema.parse({
      product_id: "33333333-3333-4333-8333-333333333333",
      quantity: "001,50",
      pantry_id: "otro",
    });
    expect(parsed).toEqual({ product_id: "33333333-3333-4333-8333-333333333333", quantity: "1.5" });
  });

  it("notas > 255 caracteres → error", () => {
    expect(
      consumeSchema.safeParse({
        product_id: "33333333-3333-4333-8333-333333333333",
        quantity: "1",
        notes: "x".repeat(256),
      }).success,
    ).toBe(false);
  });
});

describe("createBatchSchema", () => {
  const base = {
    location_id: "44444444-4444-4444-8444-444444444444",
    product_id: "33333333-3333-4333-8333-333333333333",
    unit_code: "kg",
    quantity: "2",
    expiration_date: "2026-12-10",
  };

  it("acepta coste con coma decimal (Numeric(10,2))", () => {
    expect(createBatchSchema.parse({ ...base, unit_cost: "12,50" }).unit_cost).toBe("12.50");
  });

  it("rechaza coste con 3 decimales y unidades fuera del catálogo", () => {
    expect(createBatchSchema.safeParse({ ...base, unit_cost: "1.234" }).success).toBe(false);
    expect(createBatchSchema.safeParse({ ...base, unit_code: "lb" }).success).toBe(false);
  });

  it("rechaza caducidad anterior a la compra", () => {
    const result = createBatchSchema.safeParse({ ...base, purchase_date: "2026-12-11" });
    expect(result.success).toBe(false);
  });
});

describe("otros esquemas", () => {
  it("joinPantrySchema admite DESP-XXXX y rechaza caracteres raros", () => {
    expect(joinPantrySchema.parse({ invite_code: " DESP-ABCD1234 " }).invite_code).toBe("DESP-ABCD1234");
    expect(joinPantrySchema.safeParse({ invite_code: "DESP ABCD" }).success).toBe(false);
  });

  it("productSearchSchema omite q vacío", () => {
    expect(productSearchSchema.parse({ q: "   " })).toEqual({});
  });

  it("createProductSchema convierte barcode vacío en null", () => {
    const parsed = createProductSchema.parse({
      category_id: "55555555-5555-4555-8555-555555555555",
      name: "Leche",
      barcode: " ",
      base_unit_code: "l",
    });
    expect(parsed.barcode).toBeNull();
    expect(parsed.estimated_shelf_life_days).toBe(7);
  });
});
