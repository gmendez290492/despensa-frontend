import { describe, expect, it } from "vitest";
import { formatRetryAfter, mapAuthError, rateLimitMessage } from "@/features/auth/form-errors";
import { parseRetryAfter, toProblemDetailError } from "@/lib/api/problem";

const rateLimited = (retryAfterHeader?: string, body: Record<string, unknown> = {}) =>
  toProblemDetailError(
    { type: "https://despensa.api/errors/rate-limit-exceeded", title: "Too Many Requests", status: 429, ...body },
    429,
    "corr-1",
    retryAfterHeader,
  );

describe("parseRetryAfter", () => {
  it("segundos enteros", () => {
    expect(parseRetryAfter("540")).toBe(540);
    expect(parseRetryAfter(" 0 ")).toBe(0);
  });

  it("fecha HTTP relativa a ahora (redondeo hacia arriba, nunca negativo)", () => {
    const now = Date.parse("2026-11-26T10:00:00Z");
    expect(parseRetryAfter("Thu, 26 Nov 2026 10:01:30 GMT", now)).toBe(90);
    expect(parseRetryAfter("Thu, 26 Nov 2026 09:00:00 GMT", now)).toBe(0);
  });

  it("undefined con valores ausentes o no válidos", () => {
    for (const value of [null, undefined, "", "-5", "1.5", "pronto"]) {
      expect(parseRetryAfter(value)).toBeUndefined();
    }
  });
});

describe("toProblemDetailError con Retry-After", () => {
  it("la cabecera tiene prioridad sobre el body y se serializa", () => {
    const error = rateLimited("60", { retry_after: 10 });
    expect(error.retry_after).toBe(60);
    expect(error.toJSON()).toMatchObject({ retry_after: 60 });
  });

  it("usa retry_after del body si no hay cabecera", () => {
    expect(rateLimited(undefined, { retry_after: 10 }).retry_after).toBe(10);
  });
});

describe("mensaje de rate limit", () => {
  it("formatea segundos, minutos y horas", () => {
    expect(formatRetryAfter(1)).toBe("1 segundo");
    expect(formatRetryAfter(45)).toBe("45 segundos");
    expect(formatRetryAfter(540)).toBe("9 minutos");
    expect(formatRetryAfter(3600)).toBe("60 minutos");
    expect(formatRetryAfter(7200)).toBe("2 horas");
  });

  it("mapAuthError incluye la espera cuando el backend la indica", () => {
    expect(mapAuthError(rateLimited("540"), ["email"]).banner?.message).toBe(
      rateLimitMessage(540),
    );
    expect(rateLimitMessage(540)).toContain("9 minutos");
    expect(rateLimitMessage(undefined)).toMatch(/Demasiados intentos/);
  });
});
