import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/", "/"],
    ["/despensa", "/despensa"],
    ["/despensa/123?semaforo=CRITICO&q=leche#top", "/despensa/123?semaforo=CRITICO&q=leche#top"],
    ["/a/../b", "/b"],
  ])("acepta la ruta interna %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "despensa",
    "https://evil.com",
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "/%0d%0aSet-Cookie:x",
    "/%2F%2Fevil.com",
    "/%5Cevil.com",
    "/ruta con espacio",
    "/\t/evil.com",
    "javascript:alert(1)",
    "/api/bff/auth/logout",
    "/api",
    "/login",
    "/registro?next=/x",
    "/x/../login",
    `/${"a".repeat(3000)}`,
  ])("rechaza %s y usa el fallback", (input) => {
    expect(safeRedirectPath(input)).toBe("/");
  });

  it("permite personalizar el fallback", () => {
    expect(safeRedirectPath("https://evil.com", "/inicio")).toBe("/inicio");
  });

  it("no confunde rutas que solo empiezan como /login", () => {
    expect(safeRedirectPath("/loginhelp")).toBe("/loginhelp");
  });
});
