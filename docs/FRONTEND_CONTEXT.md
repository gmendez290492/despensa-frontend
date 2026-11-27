# Contexto vivo del Frontend — `despensa-frontend`

> Documento de traspaso entre sesiones y agentes (Claude Code y Antigravity).
> Recoge **el estado actual, las decisiones tomadas y lo pendiente**. Las reglas
> de arquitectura siguen viviendo en [`AGENTS.md`](../AGENTS.md) y el dominio del
> backend en [`BACKEND_API_CONTEXT.md`](./BACKEND_API_CONTEXT.md).
> Actualízalo al cerrar cada bloque de trabajo.

**Última actualización:** 2026-11-27 · **Rama activa:** `feature/pantry-followups` (desde `develop` `8cfac90`) · En `develop`: Etapa 2 (PR #7) e issues #5/#6 (PR #8)

---

## 0. Traspaso (para retomar en Claude Code o Antigravity)

**Dónde quedó el trabajo:**
- `develop` tiene la Etapa 2 completa y los issues frontend #5 y #6 cerrados.
- La rama `feature/pantry-followups` (PR hacia `develop`, ver §6) añade:
  - `Idempotency-Key` en las mutaciones online (crear hogar, unirse, ubicación, producto) y la documentación JSDoc completa de `features/pantry/{api,hooks}.ts`;
  - `/offline?motivo=limite` ante un 429 del refresh;
  - los hallazgos MWG 3, 4 y 5 (rem, contraste del slider, `aria-disabled` en auth);
  - la skill `backend-integration-suites` y las lecciones de la Etapa 2 en los agentes;
  - **issue #10**: el panel usa `GET /api/bff/pantries/{id}/dashboard` (1 petición en la primera carga con hogar guardado, 2 sin él) y siembra `list/locations/batches/unreadNotifications`; fallback a las 4 llamadas ante `404` (ver `BACKEND_API_CONTEXT.md` §2.2).

**Cómo retomar:**
1. Lee `AGENTS.md` y este documento (§1 estado, §2b Etapa 2, §6 próximos pasos).
2. `gh issue list` en `gmendez290492/despensa-frontend` y en `gmendez290492/despensa-backend`.
3. `git checkout develop && git pull`; si el PR de `feature/pantry-followups` sigue abierto, revísalo y espera la confirmación del usuario para el merge.
4. Para validar contra el backend, usa la skill `backend-integration-suites` (Antigravity: `.agents/skills/`; Claude Code: `.claude/skills/`).

**Issues abiertos relevantes:**
- Backend:
  - despensa-backend#13: validador de `purchase_date`, `ilike` sin escapar, búsqueda por código de barras, paginación. Bloquea el escáner.
  - despensa-backend#16 (rendimiento): **resuelto**. PR #19 optimiza el coste por petición y añade `docker-compose.prod-like.yml` (4 workers). PR #20 añade `GET /pantries/{id}/dashboard`. Resultados k6 vía BFF en prod-like:
    - `load` 50 VUs, p95 del panel: 4,8 s (dev, 1 proceso) → 112 ms (4 llamadas) → **32 ms** (dashboard).
    - `spike` 200 VUs, p95: 9,7 s → 3,65 s → **50 ms**, 0 % de fallos, 64 paneles/s.
  - despensa-backend#17: resuelto en PR #18 (enum de `type` problem+json por status). `openapi.json` sincronizado; todos los slugs existen en `PROBLEM_TYPES`.
  - despensa-backend#21 → **PR backend #22** (CI verde, pendiente de merge): 401 documentado en todas las rutas con Bearer y el 422 pasa a ser `application/problem+json` también en el comportamiento (`validation-error`, `errors: [{loc,msg,type}]`, sin `input`). Compatible: `toFieldErrors` ya lo cubre y ningún tipo importa `HTTPValidationError`. Tras el merge: sincronizar `openapi.json`, `pnpm generate:api` y, cuando no queden backends antiguos, quitar la rama `Array.isArray(body.detail)` de `src/lib/api/problem.ts`.
- Frontend: #10 (dashboard agregado) implementado en `feature/pantry-followups` (PR #9). Se cierra a mano al fusionar en `develop`.

**Pendiente de esta sesión:** las pruebas manuales en Chrome (extensión Claude in Chrome) no se pudieron ejecutar porque las herramientas del navegador no estaban activas. Se retoma con `claude --chrome --resume` (Claude Code) o con el navegador de Antigravity. Recorrido sugerido:
1. Registro y onboarding: crear hogar e invitar.
2. Panel e inventario: filtros y semáforo.
3. "Registrar consumo".
4. Sin conexión (DevTools → Network → Offline): consumir, ver "N cambio(s) pendiente(s)" y reconectar.
5. Conflicto `insufficient-stock` con dos cuentas.
6. "Cerrar sesión" con cambios pendientes (diálogo).
7. `/offline?motivo=limite`.
8. En Application: cookies `HttpOnly` y ningún token en storage ni en IndexedDB.

---

## 1. Estado de las entregas

| Bloque | Estado | Notas |
|---|---|---|
| Scaffold (Next 16, Zustand, TanStack Query, Serwist, OpenAPI) | ✅ En `develop` | commit `fc8c7a0` |
| Arquitectura `.agents/` + subagentes y skills | ✅ En `develop` | PR #1, PR #2 |
| Integración de **Modern Web Guidance** en reglas y agentes (Claude Code **y Antigravity** sincronizados) | ✅ En PR #3 | `AGENTS.md §7`, `stitch-ui-builder`, `qa-frontend-auditor`, `implement-stitch-screen` |
| **Auth: login, registro, logout y BFF** | ✅ En PR #3 | Ver §2 |
| **Issue #4** (adaptación a backend PR #10: rate limit, `sid`, binding, recuperación de contraseña) | ✅ En PR #3 | Ver §2 "Issue #4" |
| Auditoría MWG del código de auth | ✅ Aplicada | Ver §3 |
| Documentación **JSDoc** de exports | ✅ 200/200 exports en `src/` | Ver §4 |
| Entrega por PR a `develop` (auth) | ✅ PR #3 fusionado | — |
| **Etapa 2 · pantry** (Home Dashboard, Inventario, consumo FEFO, outbox offline) | 🟡 Implementada en `feature/etapa-2-pantry`, sin commit/PR | Ver §2b |
| Pruebas de **seguridad** (Playwright) y **estrés** (k6) | ✅ Escritas y en verde contra FastAPI local | Ver §2b "Seguridad y estrés" |

### Puertas de calidad (última ejecución: 2026-11-27, `feature/pantry-followups`)

| Puerta | Resultado |
|---|---|
| `pnpm lint` | ✅ 0 errores |
| `pnpm typecheck` | ✅ App + SW |
| `pnpm test` | ✅ 574/574 (35 archivos) |
| `pnpm build` | ✅ `/offline` estática; `public/sw.js` precachea 35 URLs (1.18 MB) |
| Playwright E2E (`pnpm exec playwright test`, incluye `security/`) | ✅ 46/46 (Desktop + Mobile Chrome) con FastAPI local y rate limits relajados |
| k6 (`pnpm test:stress`): smoke, consume_contention, refresh_storm, idempotent_replay | ✅ 4/4 |
| k6 `load` / `spike` en prod-like, `DASHBOARD_MODE=aggregate` | ✅ p95 32 ms / 50 ms, 0 errores (`split`: 112 ms / 3,65 s) |
| Pruebas manuales en Chrome | ⏳ Pendientes (ver §0) |

---

## 2. Lo implementado en `feature/auth-login-register`

### Pantallas (Stitch Project `1951021510829166998`)

| Ruta | Pantalla Stitch | Componente |
|---|---|---|
| `/login` | "Despensa - Inicio de Sesión" · `4d4e6b2187214e199d780ad47bc707ae` | `src/features/auth/components/login-form.tsx` |
| `/registro` | "Despensa - Crear Cuenta (Registro)" · `4a85f9a297184c228178ec3982dec9ed` | `src/features/auth/components/register-form.tsx` |
| `/recuperar-contrasena` | "Despensa - Recuperar Contraseña" · `84802b86c1ae44ea83665e1b0e03b10b` | `src/features/auth/components/forgot-password-form.tsx` |
| `/reset-password` | "Despensa - Restablecer Contraseña" · `ad43b46c2dbb4794b1b4660b02272223` (ruta fijada por el correo del backend) | `src/features/auth/components/reset-password-form.tsx` |
| `/offline` | — (fallback del SW) | `src/app/offline/page.tsx` |
| `/` | — (placeholder autenticado) | `src/app/page.tsx` |

Primitivas UI reutilizables en `src/components/ui/`: `Alert`, `Button`, `TextField` (+ `Label`, `Input`, `FieldHint`, `FieldError`), `PasswordField`, `PasswordStrengthMeter`. Además `ConnectionStatusPill` y `BrandMark`.

### BFF y sesión (`HttpOnly`)

- Route Handlers: `src/app/api/bff/auth/{login,register,refresh,logout,me}/route.ts`.
- Cookies `despensa_access_token` / `despensa_refresh_token` (`HttpOnly; SameSite=Lax; Secure` en prod; `AUTH_COOKIE_SECURE` para forzarlo).
- **Mutex de refresh** (`src/lib/auth/refresh-mutex.ts`): una sola llamada real por refresh_token (clave SHA-256) + ventana de gracia de 5 s para peticiones que salieron con la cookie vieja. Limitación conocida: en memoria del proceso; con varias instancias haría falta Redis.
- Cliente: `bffFetch` reintenta una vez tras `401` compartiendo una promesa de refresh en vuelo.
- CSRF: `assertSameOrigin` (Origin / `Sec-Fetch-Site`, contra `APP_ORIGIN`) + `Content-Type: application/json` obligatorio en mutaciones (415 si no).
- `src/proxy.ts` (sustituye a `middleware.ts` en Next 16): protección optimista por presencia de cookie; con solo refresh_token redirige a `GET /api/bff/auth/refresh?next=`.
- `safeRedirectPath` bloquea open redirects (`//`, absolutas, `\`, control chars, `/api/*`, rutas de auth).
- Errores RFC 7807 en todo el stack (`ProblemDetailError`) y `X-Correlation-ID` de punta a punta; el banner de error muestra "Código de soporte".

### Issue #4 (backend #9 / PR #10)

1. **IP del cliente:** middleware `forwardClientIp` (`src/lib/api/server-client.ts`) reenvía a FastAPI `X-Forwarded-For` con la IP que añadió el proxy de confianza (`src/lib/api/client-ip.ts`, `TRUSTED_PROXY_HOPS`, defecto 1). Nunca reenvía lo que envía el navegador. En FastAPI, `FORWARDED_ALLOW_IPS` debe incluir la IP del servidor Next.
2. **429:** `parseRetryAfter` (segundos o IMF-fixdate) → `ProblemDetailError.retry_after`; el BFF reenvía `Retry-After` y el formulario muestra cuánto esperar.
3. **`sid`:** un access antiguo recibe 401 `invalid-token` → `authenticatedRequest` refresca y reintenta (cubierto en `session.test.ts`).
4. **Logout S5:** `GET /api/bff/auth/logout` (solo `Sec-Fetch-Site: same-origin|none`) borra cookies y 303 a `/login`; `LogoutButton` navega a él si el POST falla.
5. **Recuperación:** `/api/bff/auth/password/{forgot,reset}`. Reset borra cookies (FastAPI revoca todas las sesiones), quita el token de la URL con `history.replaceState` y la ruta se sirve con `Referrer-Policy: no-referrer` + `Cache-Control: no-store`.
6. **`X-Client-Binding`:** 32 bytes base64url por sesión en cookie `HttpOnly` `despensa_client_binding`, enviado en login y refresh. Sesiones con binding: mutex sin ventana de gracia (la gestiona FastAPI, 10 s); sesiones legacy: gracia de 5 s.
7. **E2E / seguridad / k6:** el rate limit del backend bloquea las suites. En `..\Despnsa project`: `AUTH_RATE_LIMIT_MAX_ATTEMPTS=1000 REGISTER_RATE_LIMIT_MAX_ATTEMPTS=1000 AUTH_EMAIL_RATE_LIMIT_MAX_ATTEMPTS=1000 REFRESH_RATE_LIMIT_MAX_ATTEMPTS=1000 docker compose up -d --no-deps --build api`; al terminar, `docker compose up -d --no-deps api` restaura los valores por defecto.

### Offline / PWA

- `src/lib/offline/sw-routes.ts`: reglas puras del SW (testeadas). Nunca se cachea `/api/*`, RSC ni métodos no-GET; solo `/login` y `/registro` (HTML anónimo) son NetworkFirst; el resto de navegaciones → NetworkOnly con fallback `/offline`.
- Logout limpia Zustand, caché de TanStack Query, todas las tablas Dexie y las cachés runtime no preservadas (`clearUserOfflineData`).
- Login/registro deshabilitan el envío sin conexión (`useIsOffline`) con aviso textual.

### Dependencias nuevas

- `server-only` (marca módulos de servidor: `session.ts`, `refresh.ts`, `server-client.ts`, `bff/http.ts`).

---

## 2b. Etapa 2 · pantry (`feature/etapa-2-pantry`)

Pantallas Stitch: Home Dashboard `7888102e6f53468e9258286b534611ae` → `src/app/(app)/page.tsx`; Pantry Inventory `bcc49240c9a6408e8d2a1583fe082fd0` → `src/app/(app)/despensa/page.tsx`. Componentes en `src/features/pantry/components/`, shell en `src/components/app-shell/`, avisos en `src/components/status-announcer.tsx`.

- **BFF:** `src/lib/bff/authenticated-route.ts` (`handleAuthenticated`: CSRF → UUID → Idempotency-Key → body una vez → refresh con mutex). Rutas `pantries`, `pantries/join`, `pantries/[pantryId]/{locations,batches,consume}`, `categories`, `products`, `notifications`.
- **Dominio:** `decimal.ts` (milésimas enteras), `fefo.ts` (semáforo VENCIDO ≤0 / CRÍTICO 1–3 / PRECAUCIÓN 4–7 / ÓPTIMO >7, consumo optimista espejo de `consume_product_fefo`, `ageBatches` recalcula el semáforo de una caché de días anteriores).
- **Outbox (Dexie v2):** filas con `userId` (índice). `drainOutbox` exige `userId`, **borra** filas de otros usuarios o sin dueño (privacidad), drena FIFO bajo Web Lock, pausa en 401 (sin bucle), backoff + `Retry-After`. Se encola ante red, 5xx, 408, 429 y `idempotency-request-in-progress`, **reutilizando la misma Idempotency-Key** (`useActionMutationId`). Allowlist por `kind`, sin `//`, `redirect: "manual"`. Consumos encolados sin red no guardan `notes`.
- **Logout:** si hay cambios sin sincronizar, `<dialog>` "Tienes N cambio(s) sin sincronizar" (Sincronizar ahora / Cancelar / Cerrar sesión igualmente).
- **Backend:** idempotencia fusionada en `despensa-backend` PR #14 (issue [#11](https://github.com/gmendez290492/despensa-backend/issues/11) **sigue abierto**: el PR no lo cerró; `idempotent_replay` confirma 1 descuento por clave). Abierto [#13](https://github.com/gmendez290492/despensa-backend/issues/13) (validador de `purchase_date`, `ilike` sin escapar, búsqueda por código de barras, paginación). `docs/openapi.json` sincronizado con `develop` del backend.
- **Issue #5 (idempotencia, rama `feature/idempotency-ttl-refresh-429`):**
  - TTL: `drainOutbox` no reenvía filas con más de `OUTBOX_MAX_REPLAY_AGE_MS` (6 d 20 h; FastAPI olvida las claves a las 168 h). Las pasa a `conflict` con `outbox-entry-expired`. El banner ofrece "Reenviar" (`retryExpiredOutboxRecord`, que usa una **clave nueva**: es una operación nueva y consciente).
  - Errores de clave: `400 invalid-idempotency-key` y `422 idempotency-key-reused` nunca se reintentan y se registran con `console.warn` (`correlation_id`).
  - BFF: reenvía `Idempotent-Replayed` (middleware `onResponse` en `handleAuthenticated` con `idempotent: true`) y acepta `Idempotency-Key` también en `pantries`, `join`, `locations` y `products`.
  - Las mutaciones online (crear hogar, unirse, ubicación, producto) envían `Idempotency-Key` con `useActionMutationId` y `retry: false` (`feature/pantry-followups`). Siguen siendo solo online: no se encolan en la outbox.
- **Issue #6 (rate limit de refresh/logout):**
  - `bffFetch` ante un refresh con 429 espera `Retry-After` (tope `RATE_LIMIT_RETRY_CAP_SECONDS` = 5 s, `src/lib/api/rate-limit.ts`) y reintenta una vez. Si persiste lanza el 429, no el 401. Solo un 401/403 real del refresh significa sesión caducada.
  - `GET /api/bff/auth/refresh` con 429 → 303 a `/offline` con `Retry-After`, conservando la sesión.
  - El logout ante un 429 reintenta una vez; si vuelve a fallar, `console.warn` con `correlation_id`. Siempre 204/303 con las cookies borradas.

### Seguridad y estrés

- `pnpm test:security` → `tests/e2e/security/pantry-security.spec.ts`: IDOR (lectura, escritura, UI), 401/redirect, CSRF, UUID/traversal, Idempotency-Key, mass assignment, cantidades hostiles, XSS almacenado, tokens fuera de storage/IDB, logout limpia IDB y revoca, cabeceras, errores sin fugas, open redirect. Helpers en `tests/e2e/support/seed.ts`.
- `pnpm test:stress` (`SCENARIO=smoke|load|spike|soak|consume_contention|refresh_storm|idempotent_replay`) → `tests/stress/pantry-bff.js` en Docker (`grafana/k6:0.54.0`, `scripts/run-k6.mjs`; `K6_LOCAL=1` usa binario local). Necesita `pnpm build && pnpm start` con `AUTH_COOKIE_SECURE=false`. Lecciones: `noCookiesReset: true` (k6 vacía cookies por iteración), en `setup()` no existen `__VU`/`__ITER`, y en Docker/Rancher Desktop no usar `host-gateway` (solo Linux).
- Resultados 2026-11-26: smoke p95 dashboard 57 ms; contención 200×1 sobre stock 100 → 100 OK / 100 `insufficient-stock` / stock final 0; refresh_storm 100 VUs con el mismo refresh → 100 % OK y sesión viva; replay 5× por clave → 0 descuentos extra.

---

## 3. Auditoría Modern Web Guidance (Baseline Widely available)

Guías consultadas (copia local en `.agents/skills/modern-web-guidance/guides/`): `autofill-sign-in-form`, `autofill-sign-up-form`, `forms`, `required-field-feedback`, `accessible-error-announcement`, `validate-input-after-interaction`, `slider`, `motion`, `respect-os-text-scale`.

### Cambios aplicados

| Cambio | Archivos | Guía |
|---|---|---|
| Correo con `autoComplete="username"` (antes `email`) | login + registro | `autofill-sign-in-form` / `autofill-sign-up-form` |
| `required`, `maxLength` (y `minLength=8` en la contraseña nueva) alineados con Zod | login + registro | `forms`, `autofill-*` |
| `enterKeyHint` (`next` / `done`) | login + registro | `forms` §3 |
| `aria-invalid="false"` explícito mientras no hay error (antes se omitía) | `TextField`, `PasswordField`, `TimeZoneField`, slider | `accessible-error-announcement` |
| Spinner y skeletons solo animan con `motion-safe:` | `Button`, `AuthFormSkeleton`, `page.tsx` | `motion` |
| Foco del slider con `outline` en el input (sobrevive a alto contraste) | `globals.css` | `slider` |
| Tests que fijan los atributos de autofill/validación | `tests/unit/{login,register}-form.test.tsx` | — |

Ya cumplía antes: `<form>` + `<label for>`, `type="email"`, toggle "mostrar contraseña", pegado permitido, errores con ícono + texto, foco al primer campo inválido (RHF), error enlazado en `aria-describedby` solo mientras existe, `<input type="range">` nativo con `aria-valuetext`, `<select>` nativo para zona horaria, `lang="es"`, sin bloqueo de zoom.

### Hallazgos abiertos (requieren decisión)

1. **Doble campo de contraseña** (`confirm_password`): la guía de registro desaconseja pedirla dos veces. Se mantiene porque lo pide el diseño Stitch. *Decisión de producto pendiente.*
2. ~~"¿Olvidaste tu contraseña?"~~ ✅ Resuelto con el issue #4; pantallas diseñadas en Stitch.
3. ~~**Tamaños en `px`**~~ ✅ Resuelto (`feature/pantry-followups`): los `text-[Npx]` de auth, `/offline`, `error.tsx`, `Button` `lg`, `Alert`, `TextField` y `BrandMark` pasan a `rem` (`respect-os-text-scale`). Radios, bordes y `max-w-[430px]` siguen en px.
4. ~~**Contraste del track del slider**~~ ✅ Resuelto: `--surface-high` daba 1.16:1 sobre `--background` (1.23:1 sobre blanco); el tramo sin rellenar usa ahora `--input-border`, con 3.77:1 y 3.97:1 (WCAG 1.4.11; `slider`, `color`). El relleno (`--primary-container`) frente al tramo vacío da 2.54:1; el valor se comunica también con la posición del thumb y el chip de texto.
5. ~~Botón de envío `disabled` sin conexión~~ ✅ Resuelto: login, registro, recuperación y reset usan `aria-disabled="true"` (sigue enfocable y anuncia la pista `aria-describedby`); `blockSubmitWhileOffline` (`src/features/auth/offline-submit.ts`) corta el envío antes de validar, incluido el envío implícito con Enter. E2E `offline.spec.ts` comprueba `aria-disabled`.
6. `/offline` tras un `429` del refresh GET: el BFF redirige a `/offline?motivo=limite&next=…`; la hoja cliente `OfflineMessage` (en `<Suspense>`, la página sigue estática y precacheada) muestra "Demasiados intentos", y "Reintentar" navega a `next` en lugar de recargar `/offline`. Pendiente menor: el `<title>` y el pie ("Modo sin conexión") siguen siendo los genéricos.

---

## 4. Documentación JSDoc

- Regla: `AGENTS.md §1.7`. Todo componente, hook y función exportada lleva JSDoc con propósito, `@param`, `@returns`, `@throws` cuando aplica, `@example` en `src/components/ui/` y `@see` a la guía MWG aplicada.
- Cobertura actual: **200/200 exports** en `src/` (incluye tipos, constantes y props).
- Medición: script ad-hoc que localiza cada `export` de nivel superior y comprueba que lo precede un bloque `/** … */` (sin contar comentarios de módulo). Si se quiere automatizar, valorar `eslint-plugin-jsdoc` con `require-jsdoc` solo para exports.
- Limpieza hecha de paso: `src/lib/db/offline-db.ts` tenía una interfaz manual `ProblemDetailError` duplicada; ahora usa `ProblemDetail` de `@/lib/api/problem`.

---

## 5. Entorno y herramientas

- Windows + pnpm. `core.symlinks=false`: el enlace `.claude/skills/modern-web-guidance` es local; tras clonar, `npx modern-web-guidance@latest install`.
- La CLI `npx modern-web-guidance` necesita red; sin ella, leer las guías locales (ver arriba).
- Aviso no bloqueante de Vite en `vitest.config.mts`: usar `import.meta.dirname` en lugar de `__dirname`.
- Variables (ver `.env.example`): `BACKEND_API_URL`, `APP_ORIGIN`, `AUTH_COOKIE_SECURE` (opcional), `TRUSTED_PROXY_HOPS` (opcional), `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`.

---

## 6. Próximos pasos

1. PR `feature/pantry-followups` → `develop` (merge con confirmación explícita).
2. Pruebas manuales en Chrome (recorrido en §0) y registrar los hallazgos.
3. Cuando se fusione el PR backend #22: sincronizar `openapi.json`, regenerar `schema.d.ts` y pasar las puertas.
4. Siguiente etapa: escáner de códigos de barras (XState v5 + `BarcodeDetector` con fallback), que depende de la búsqueda por código de despensa-backend#13. Pantalla en Stitch con `implement-stitch-screen`.
5. Pantallas que ya tienen hooks y aún no tienen UI: alta de lote y de producto (`useCreateProductMutation`, `useCreateLocationMutation`).
6. Detalle menor: `/offline?motivo=limite` mantiene el `<title>` y el pie genéricos.
7. Decisión de producto: doble campo de contraseña en el registro (§3.1).
