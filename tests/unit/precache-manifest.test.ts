import { describe, expect, it } from "vitest";
import { filterPrecacheHtml, prerenderedHtmlRoute } from "@/lib/offline/precache-manifest.mjs";

describe("prerenderedHtmlRoute", () => {
  it.each([
    [".next/server/app/index.html", "/"],
    [".next/server/app/offline.html", "/offline"],
    [".next/server/app/login.html", "/login"],
    [".next/server/app/despensa/index.html", "/despensa"],
    [".next\\server\\app\\registro.html", "/registro"],
    [".next/static/chunks/app.js", null],
    ["public/file.svg", null],
  ])("%s -> %s", (raw, route) => {
    expect(prerenderedHtmlRoute(raw)).toBe(route);
  });
});

describe("filterPrecacheHtml", () => {
  it("solo deja HTML de la allowlist y conserva assets", () => {
    const entries = [
      { url: ".next/server/app/index.html", revision: "1" },
      { url: ".next/server/app/login.html", revision: "1" },
      { url: ".next/server/app/registro.html", revision: "1" },
      { url: ".next/server/app/offline.html", revision: "1" },
      { url: ".next/static/chunks/app.js", revision: null },
      { url: "public/file.svg", revision: "1" },
    ];
    const { manifest } = filterPrecacheHtml(entries);
    expect(manifest.map((entry) => entry.url)).toEqual([
      ".next/server/app/offline.html",
      ".next/static/chunks/app.js",
      "public/file.svg",
    ]);
  });
});
