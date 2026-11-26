// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

const APP = "http://localhost:3000";

function run(path: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return proxy(
    new NextRequest(`${APP}${path}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } }),
  );
}

const ACCESS = { despensa_access_token: "at" };
const REFRESH = { despensa_refresh_token: "rt" };
const isPassThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

describe("proxy.ts", () => {
  it("sin cookies, / redirige a /login sin next", () => {
    const response = run("/");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${APP}/login`);
  });

  it("sin cookies, una ruta protegida conserva ruta + query en next", () => {
    const response = run("/despensa/123?semaforo=CRITICO");
    expect(response.headers.get("location")).toBe(
      `${APP}/login?next=%2Fdespensa%2F123%3Fsemaforo%3DCRITICO`,
    );
  });

  it("solo refresh_token: redirige al refresh GET con next", () => {
    const response = run("/despensa?x=1", REFRESH);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${APP}/api/bff/auth/refresh?next=%2Fdespensa%3Fx%3D1`,
    );
  });

  it("con access token, las rutas protegidas pasan y propagan X-Correlation-ID", () => {
    const response = run("/", ACCESS, { "x-correlation-id": "corr-proxy-0001" });
    expect(isPassThrough(response)).toBe(true);
    expect(response.headers.get("x-correlation-id")).toBe("corr-proxy-0001");
  });

  it("genera un correlation ID si el entrante no es seguro", () => {
    const response = run("/", ACCESS, { "x-correlation-id": "bad id\twith spaces" });
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("/login sin sesión es público", () => {
    expect(isPassThrough(run("/login"))).toBe(true);
    expect(isPassThrough(run("/registro?next=%2Fdespensa"))).toBe(true);
  });

  it("/login con access token redirige a next validado", () => {
    expect(run("/login?next=%2Fdespensa", ACCESS).headers.get("location")).toBe(`${APP}/despensa`);
    expect(run("/registro?next=%2F%2Fevil.com", ACCESS).headers.get("location")).toBe(`${APP}/`);
    expect(run("/login?next=https%3A%2F%2Fevil.com", ACCESS).headers.get("location")).toBe(`${APP}/`);
  });

  it("/login con solo refresh_token muestra el formulario (evita bucle cross-site)", () => {
    expect(isPassThrough(run("/login", REFRESH))).toBe(true);
  });

  it("/offline es público con o sin sesión", () => {
    expect(isPassThrough(run("/offline"))).toBe(true);
    expect(isPassThrough(run("/offline", REFRESH))).toBe(true);
  });
});
