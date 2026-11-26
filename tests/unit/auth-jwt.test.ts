import { describe, expect, it } from "vitest";
import { decodeJwtExp, refreshTokenMaxAge } from "@/lib/auth/jwt";
import { REFRESH_TOKEN_MAX_AGE_SECONDS } from "@/lib/auth/constants";

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.firma`;
}

describe("refreshTokenMaxAge", () => {
  const now = 1_795_672_328_000;

  it("usa exp - now del JWT", () => {
    const token = fakeJwt({ exp: now / 1000 + 604_800 });
    expect(decodeJwtExp(token)).toBe(now / 1000 + 604_800);
    expect(refreshTokenMaxAge(token, now)).toBe(604_800);
  });

  it("acota a 30 días como máximo", () => {
    expect(refreshTokenMaxAge(fakeJwt({ exp: now / 1000 + 90 * 86_400 }), now)).toBe(
      30 * 86_400,
    );
  });

  it("usa el respaldo si el token no es decodificable o no trae exp", () => {
    expect(refreshTokenMaxAge("no-es-un-jwt", now)).toBe(REFRESH_TOKEN_MAX_AGE_SECONDS);
    expect(refreshTokenMaxAge(fakeJwt({ sub: "x" }), now)).toBe(REFRESH_TOKEN_MAX_AGE_SECONDS);
  });
});
