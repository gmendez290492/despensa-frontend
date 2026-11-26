# Contexto vivo del Frontend — `despensa-frontend`

> Documento de traspaso entre sesiones y agentes (Claude Code y Antigravity).
> Recoge **el estado actual, las decisiones tomadas y lo pendiente**. Las reglas
> de arquitectura siguen viviendo en [`AGENTS.md`](../AGENTS.md) y el dominio del
> backend en [`BACKEND_API_CONTEXT.md`](./BACKEND_API_CONTEXT.md).
> Actualízalo al cerrar cada bloque de trabajo.

**Última actualización:** 2026-11-26 · **Rama activa:** `feature/auth-login-register` → PR [#3](https://github.com/gmendez290492/despensa-frontend/pull/3) hacia `develop`

---

## 1. Estado de las entregas

| Bloque | Estado | Notas |
|---|---|---|
| Scaffold (Next 16, Zustand, TanStack Query, Serwist, OpenAPI) | ✅ En `develop` | commit `fc8c7a0` |
| Arquitectura `.agents/` + subagentes y skills | ✅ En `develop` | PR #1, PR #2 |
| Integración de **Modern Web Guidance** en reglas y agentes | ✅ En PR #3 | `AGENTS.md §7`, `stitch-ui-builder`, `qa-frontend-auditor`, `implement-stitch-screen` |
| **Auth: login, registro, logout y BFF** | ✅ En PR #3 | Ver §2 |
| Auditoría MWG del código de auth | ✅ Aplicada | Ver §3 |
| Documentación **JSDoc** de exports | ✅ 200/200 exports en `src/` | Ver §4 |
| Entrega por PR a `develop` | 🟡 PR #3 abierto, CI en verde | Merge solo con confirmación explícita del usuario |
| Home Dashboard (Stitch) | ⏳ Siguiente | `src/app/page.tsx` es un placeholder temporal |

### Puertas de calidad (última ejecución: 2026-11-26)

| Puerta | Resultado |
|---|---|
| `pnpm lint` | ✅ 0 errores |
| `pnpm typecheck` | ✅ App + SW |
| `pnpm test` | ✅ 187/187 (16 archivos) |
| `pnpm build` | ✅ 13 rutas · `public/sw.js` precachea 29 URLs (1.02 MB) |
| Playwright E2E | ⚠️ No ejecutado en esta sesión (requiere FastAPI local) |

---

## 2. Lo implementado en `feature/auth-login-register`

### Pantallas (Stitch Project `1951021510829166998`)

| Ruta | Pantalla Stitch | Componente |
|---|---|---|
| `/login` | "Despensa - Inicio de Sesión" · `4d4e6b2187214e199d780ad47bc707ae` | `src/features/auth/components/login-form.tsx` |
| `/registro` | "Despensa - Crear Cuenta (Registro)" · `4a85f9a297184c228178ec3982dec9ed` | `src/features/auth/components/register-form.tsx` |
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

### Offline / PWA

- `src/lib/offline/sw-routes.ts`: reglas puras del SW (testeadas). Nunca se cachea `/api/*`, RSC ni métodos no-GET; solo `/login` y `/registro` (HTML anónimo) son NetworkFirst; el resto de navegaciones → NetworkOnly con fallback `/offline`.
- Logout limpia Zustand, caché de TanStack Query, todas las tablas Dexie y las cachés runtime no preservadas (`clearUserOfflineData`).
- Login/registro deshabilitan el envío sin conexión (`useIsOffline`) con aviso textual.

### Dependencias nuevas

- `server-only` (marca módulos de servidor: `session.ts`, `refresh.ts`, `server-client.ts`, `bff/http.ts`).

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
2. **"¿Olvidaste tu contraseña?"**: la guía de login lo recomienda, pero el OpenAPI no expone endpoint de recuperación (`/api/v1/auth/*` solo tiene login, register, refresh, logout). Pendiente del backend.
3. **Tamaños en `px`** (`text-[13px]`, `text-[15px]`…) heredados del export de Stitch: `respect-os-text-scale` recomienda unidades relativas. El root font-size no se fija (correcto). Migrar a `rem` en una pasada de tokens tipográficos.
4. **Contraste del track del slider** (`--surface-high` vs fondo): verificar ≥ 3:1.
5. Botón de envío `disabled` cuando no hay conexión: su `aria-describedby` no se lee porque un botón deshabilitado no recibe foco. El texto visible lo compensa; valorar `aria-disabled`.

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
- Variables (ver `.env.example`): `BACKEND_API_URL`, `APP_ORIGIN`, `AUTH_COOKIE_SECURE` (opcional), `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`.

---

## 6. Próximos pasos

1. Ejecutar E2E de Playwright con FastAPI local (`auth.spec.ts`, `offline.spec.ts`, `smoke.spec.ts`).
2. Revisar y fusionar el PR #3 en `develop` (solo con confirmación explícita), borrar la rama y sincronizar `develop` en local.
3. Resolver los hallazgos abiertos de §3.
4. Siguiente pantalla Stitch: Home Dashboard (lotes FEFO, semáforo, alertas) con `implement-stitch-screen`.
5. Outbox real (Dexie + `offline-outbox-mutation`) y diálogo "tienes N cambios sin sincronizar" antes del logout (TODO en `clear-user-data.ts`).
