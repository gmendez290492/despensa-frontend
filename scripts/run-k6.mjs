#!/usr/bin/env node
/**
 * Lanza los escenarios k6 de `tests/stress/` en Docker (`grafana/k6`), sin
 * instalar k6 localmente. Funciona en Windows, macOS y Linux.
 *
 *   SCENARIO=load node scripts/run-k6.mjs
 *   pnpm test:stress                # SCENARIO=smoke
 *
 * Variables reenviadas a k6 (`-e`, disponibles en `__ENV`): SCENARIO, BASE_URL, APP_ORIGIN,
 * POOL_SIZE, SOAK_DURATION. Si k6 está instalado y `K6_LOCAL=1`, se usa el
 * binario local.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const stressDir = path.join(root, "tests", "stress");
const reportsDir = path.join(stressDir, "reports");
mkdirSync(reportsDir, { recursive: true });

const scenario = process.env.SCENARIO ?? "smoke";
const forwarded = ["SCENARIO", "BASE_URL", "APP_ORIGIN", "POOL_SIZE", "SOAK_DURATION"];
const env = { ...process.env, SCENARIO: scenario };
// Con k6 local se ataca localhost; en Docker, lib.js usa host.docker.internal.
if (process.env.K6_LOCAL === "1") env.BASE_URL ??= "http://localhost:3000";
const summary = `reports/${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
// Se pasan como `-e` de k6 (llegan a `__ENV` también en Docker).
const k6Env = forwarded.flatMap((name) => (env[name] !== undefined ? ["-e", `${name}=${env[name]}`] : []));

let result;
if (process.env.K6_LOCAL === "1") {
  result = spawnSync("k6", ["run", ...k6Env, "--summary-export", summary, "pantry-bff.js"], {
    cwd: stressDir,
    env,
    stdio: "inherit",
  });
} else {
  const args = [
    "run",
    "--rm",
    "-i",
    // Docker Desktop / Rancher Desktop (Windows, macOS) ya resuelven
    // host.docker.internal al host; `host-gateway` allí apunta a la VM. Solo
    // Docker Engine nativo en Linux necesita el alias.
    ...(process.platform === "linux" ? ["--add-host=host.docker.internal:host-gateway"] : []),
    "-v",
    `${stressDir}:/scripts`,
    "-w",
    "/scripts",
  ];
  // Imagen fijada (no `latest`) para resultados reproducibles.
  args.push("grafana/k6:0.54.0", "run", ...k6Env, "--summary-export", summary, "pantry-bff.js");
  result = spawnSync("docker", args, { env, stdio: "inherit" });
}

if (result.error) {
  console.error(`[k6] no se pudo lanzar: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
