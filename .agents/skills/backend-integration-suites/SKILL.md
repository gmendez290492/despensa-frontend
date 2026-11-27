---
name: backend-integration-suites
description: Ejecuta las suites E2E, de seguridad (Playwright) y de estrés (k6) contra FastAPI local con rate limits relajados, y restaura el entorno al terminar.
---

# Suites de integración contra el backend (E2E, seguridad y estrés)

Ejecútala antes de un PR que toque BFF, sesión, outbox o seguridad, y cuando el usuario pida pruebas "contra el backend". Necesita Docker y el repo del backend en `..\Despnsa project` (`docker compose`, servicio `api`).

## Paso 1: Backend con límites relajados

El rate limit por defecto (registro 5/h, login 10/min, refresh 30/min) bloquea las suites con 429. En `..\Despnsa project`:

```bash
AUTH_RATE_LIMIT_MAX_ATTEMPTS=1000 REGISTER_RATE_LIMIT_MAX_ATTEMPTS=1000 \
AUTH_EMAIL_RATE_LIMIT_MAX_ATTEMPTS=1000 REFRESH_RATE_LIMIT_MAX_ATTEMPTS=1000 \
docker compose up -d --no-deps api      # añade --build si cambió el código del backend
```

Comprueba que `http://localhost:8000/docs` responde 200 y que `docker compose exec -T api alembic current` está en `head`. Si hay otra sesión de agente trabajando en el backend, avísale antes de recrear el contenedor y después de restaurarlo.

## Paso 2: Build y servidor de producción

1. Comprueba que el puerto 3000 está libre (Windows: `Get-NetTCPConnection -LocalPort 3000 -State Listen`). Si un `next start` anterior sigue vivo, detén su proceso: serviría un build viejo.
2. `pnpm build`
3. `AUTH_COOKIE_SECURE=false APP_ORIGIN=http://localhost:3000 BACKEND_API_URL=http://localhost:8000 PWA_E2E=1 pnpm start` (en segundo plano). Espera a que `/login` responda 200.

## Paso 3: Suites

- **E2E + seguridad:** `PWA_E2E=1 BACKEND_API_URL=http://localhost:8000 pnpm exec playwright test` (Desktop y Mobile Chrome). Solo seguridad: `pnpm test:security`.
- **Estrés (k6 en Docker, `grafana/k6:0.54.0`):** `SCENARIO=<smoke|consume_contention|refresh_storm|idempotent_replay|load|spike|soak> pnpm test:stress`. En Git Bash antepone `MSYS_NO_PATHCONV=1`.
  - Los cuatro primeros son de aceptación funcional y deben pasar.
  - `load`, `spike` y `soak` miden latencia. Si fallan por umbral, compara contra FastAPI directo antes de culpar al BFF (despensa-backend#16).
  - Notas de k6: `noCookiesReset: true`; en `setup()` no existen `__VU`/`__ITER`; en Docker/Rancher Desktop no uses `--add-host=host-gateway` (solo Linux).

## Paso 4: Restaurar y reportar

1. Detén el servidor de Next (y su proceso hijo en el puerto 3000).
2. Restaura el backend: `docker compose up -d --no-deps api` en `..\Despnsa project`.
3. Registra los resultados en `docs/FRONTEND_CONTEXT.md` (tabla de puertas). Si encuentras un fallo del backend, reúne la evidencia (status, `correlation_id`, métricas) y abre un issue en `gmendez290492/despensa-backend`.
