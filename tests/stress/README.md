# Pruebas de estrés y seguridad — `despensa-frontend`

## Estrés (k6 sobre el BFF)

Escenarios en `pantry-bff.js` y helpers en `lib.js`. Corren en Docker (`grafana/k6:0.54.0`), así que no hace falta instalar k6.

```powershell
pnpm build
$env:AUTH_COOKIE_SECURE="false"; $env:APP_ORIGIN="http://localhost:3000"; pnpm start   # terminal 1
$env:SCENARIO="smoke"; pnpm test:stress                                                  # terminal 2
```

| `SCENARIO` | Carga | Qué demuestra | Umbrales |
|---|---|---|---|
| `smoke` | 1 VU · 30 s | Que el script y el entorno funcionan | `http_req_failed < 1 %`, p95 batches < 800 ms |
| `load` | 0→50 VUs · 6 min | Lectura concurrente del panel (4 peticiones por vista) | p95 batches < 800 ms, p99 < 1,5 s, `dashboard_roundtrip` p95 < 1,5 s |
| `spike` | 0→200 VUs en 10 s | Pico súbito sin errores de servidor | fallos < 5 %, p95 < 3 s |
| `soak` | 20 VUs · 30 min (`SOAK_DURATION`) | Fugas o degradación del proceso Next y del mutex | Los mismos que `load` |
| `consume_contention` | 200 consumos de 1 pza en paralelo contra un stock de 100 | Sin sobreventa: exactamente 100 OK y 100 `insufficient-stock`, stock final 0, ningún 5xx | `consume_ok==100`, `consume_unexpected==0` |
| `refresh_storm` | 100 VUs con el **mismo** refresh token y sin access token | El mutex del BFF hace una sola rotación y FastAPI no revoca la familia | `refresh_ok > 99 %`, la sesión sigue viva |
| `idempotent_replay` | 20 claves × 5 reenvíos | Que una `Idempotency-Key` repetida descuenta **una** sola vez | `replay_extra_deductions==0`. Pasa desde despensa-backend#14 (cierra [#11](https://github.com/gmendez290492/despensa-backend/issues/11)) |

- El `setup()` registra un usuario por VU y los une al mismo hogar con el `invite_code`.
- FastAPI debe arrancar con los rate limits relajados (`docs/FRONTEND_CONTEXT.md` §5).
- Los informes JSON se guardan en `tests/stress/reports/` (ignorado por git).
- El mutex de refresh vive en memoria del proceso: con varias réplicas de Next, `refresh_storm` fallaría. Ese es el aviso para migrarlo a Redis.

## Seguridad (Playwright contra el backend real)

`tests/e2e/security/pantry-security.spec.ts`. Se ejecuta con `pnpm test:security`.

| Amenaza (OWASP) | Escenario |
|---|---|
| A01 · IDOR | Otro usuario no puede leer, consumir ni crear lotes o ubicaciones del hogar ajeno (403, sin fugas). Un `activePantryId` ajeno manipulado en `localStorage` no muestra datos. Control positivo: unirse con el código sí da acceso (y repetir → 409). |
| A01 · CSRF | `Origin` ajeno → 403; `Sec-Fetch-Site: cross-site` → 403; `text/plain` → 415; el stock no cambia. |
| A03 · Inyección y validación | UUID inválido o *path traversal* → 400/404; `Idempotency-Key` abusiva → 400; cantidades hostiles (`-1`, `1e9`, `NaN`…) → 400; campos extra descartados (*mass assignment*). |
| A03 · XSS almacenado | Un nombre de producto con `<img onerror>` o `<script>` se renderiza como texto en `/` y `/despensa`. |
| A02/A07 · Secretos | Los tokens nunca aparecen en Web Storage, IndexedDB ni `document.cookie`; las cookies son `HttpOnly` + `SameSite=Lax`. |
| Sesión | Sin sesión: el BFF responde 401 problem+json y las páginas redirigen a `/login?next=`. El logout vacía la outbox y el estado persistido, y revoca la sesión. |
| A05 · Configuración | Cabeceras `X-Frame-Options`, CSP `frame-ancestors`, `nosniff` y `Referrer-Policy`; el BFF responde con `no-store` y correlation ID; los errores no exponen stack, URL interna ni tokens. |
| Redirección abierta | Ningún `?next=` externo saca del origen. |
