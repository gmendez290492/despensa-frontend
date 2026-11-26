import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRUSTED_PROXY_HOPS,
  normalizeIp,
  parseTrustedProxyHops,
  resolveClientIp,
} from "@/lib/api/client-ip";

const xff = (value: string) => new Headers({ "x-forwarded-for": value });

describe("parseTrustedProxyHops", () => {
  it("usa 1 por defecto y con valores no válidos", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    for (const value of ["", "abc", "-1", "1.5"]) {
      expect(parseTrustedProxyHops(value)).toBe(DEFAULT_TRUSTED_PROXY_HOPS);
    }
  });

  it("acepta enteros positivos", () => {
    expect(parseTrustedProxyHops("2")).toBe(2);
  });
});

describe("normalizeIp", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["203.0.113.7:51234", "203.0.113.7"],
    ["2001:db8::1", "2001:db8::1"],
    ["[2001:db8::1]:443", "2001:db8::1"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeIp(raw)).toBe(expected);
  });

  it.each(["", "<script>", "unknown", "999.1.1.1", "evil.com"])("rechaza %s", (raw) => {
    expect(normalizeIp(raw)).toBeNull();
  });
});

describe("resolveClientIp", () => {
  it("con 1 salto toma la última entrada (la que añadió el proxy de confianza)", () => {
    expect(resolveClientIp(xff("6.6.6.6, 203.0.113.7"), 1)).toBe("203.0.113.7");
  });

  it("con 2 saltos toma la penúltima, ignorando lo que inventa el cliente", () => {
    expect(resolveClientIp(xff("6.6.6.6, 203.0.113.7, 10.0.0.2"), 2)).toBe("203.0.113.7");
  });

  it("null si faltan entradas, no hay cabecera o la IP no es válida", () => {
    expect(resolveClientIp(xff("203.0.113.7"), 2)).toBeNull();
    expect(resolveClientIp(new Headers(), 1)).toBeNull();
    expect(resolveClientIp(xff("1.1.1.1, nope"), 1)).toBeNull();
  });
});
