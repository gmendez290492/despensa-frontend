import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "public/sw.js",
    "public/swe-worker-*.js",
    "src/lib/api/schema.d.ts",
    "next-env.d.ts",
    // Scripts k6 (runtime propio, no Node ni navegador) y sus informes.
    "tests/stress/**",
  ]),
]);

export default eslintConfig;
