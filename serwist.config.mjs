// @ts-check
import { serwist } from "@serwist/next/config";
import { filterPrecacheHtml } from "./src/lib/offline/precache-manifest.mjs";

export default serwist({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  // Recoge el HTML prerenderizado, pero `filterPrecacheHtml` solo deja pasar
  // la allowlist pública (`/offline`). Nunca `/` ni rutas protegidas.
  precachePrerendered: true,
  manifestTransforms: [async (entries) => filterPrecacheHtml(entries)],
});
