import { describe, expect, it } from "vitest";
import { compareDecimals, fromMilli, sumDecimals, toMilli } from "@/features/pantry/decimal";
import { quantitySchema } from "@/lib/pantry/schemas";

describe("decimal (milésimas enteras)", () => {
  it("0.1 + 0.2 = 0.3 exacto", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(compareDecimals(sumDecimals(["0.1", "0.2"]), "0.3")).toBe(0);
  });

  it.each([
    ["1.5", 1500],
    ["250", 250_000],
    ["0.125", 125],
    ["0.001", 1],
    ["1,5", 1500],
    ["-0.5", -500],
    [" 2 ", 2000],
    [3, 3000],
  ])("toMilli(%o) = %d", (input, expected) => {
    expect(toMilli(input)).toBe(expected);
  });

  it.each(["", "abc", "1.2.3", ".5", "1e3", "NaN"])("toMilli(%o) inválido → 0", (input) => {
    expect(toMilli(input)).toBe(0);
  });

  it.each([
    [1500, "1.5"],
    [1000, "1"],
    [1, "0.001"],
    [120, "0.12"],
    [0, "0"],
    [-500, "-0.5"],
  ])("fromMilli(%d) = %s", (input, expected) => {
    expect(fromMilli(input)).toBe(expected);
  });

  it("límites Numeric(10,3): 9999999.999 ida y vuelta sin pérdida", () => {
    const max = "9999999.999";
    expect(toMilli(max)).toBe(9_999_999_999);
    expect(Number.isSafeInteger(toMilli(max))).toBe(true);
    expect(fromMilli(toMilli(max))).toBe(max);
    expect(sumDecimals([max, "0.001"])).toBe("10000000");
  });

  it("quantitySchema acepta hasta 7 enteros y 3 decimales, y normaliza", () => {
    expect(quantitySchema.parse("9999999.999")).toBe("9999999.999");
    expect(quantitySchema.parse("001.500")).toBe("1.5");
    expect(quantitySchema.parse("0,25")).toBe("0.25");
    expect(quantitySchema.safeParse("10000000").success).toBe(false);
    expect(quantitySchema.safeParse("1.2345").success).toBe(false);
    expect(quantitySchema.safeParse("0").success).toBe(false);
    expect(quantitySchema.safeParse("-1").success).toBe(false);
  });

  it("sumas largas de décimas no acumulan error", () => {
    expect(sumDecimals(Array.from({ length: 1000 }, () => "0.1"))).toBe("100");
  });
});
