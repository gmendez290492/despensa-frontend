<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reglas de Arquitectura y Agentes — `despensa-frontend`

Aplicación web y PWA *Offline-First* construida sobre **Next.js 16 (App Router + Turbopack + Cache Components)** y **React 19**, conectada al backend orientado a eventos **Despensa API (FastAPI)** y al sistema de diseño de **Google Stitch** (`Project ID: 1951021510829166998`).

## 1. Principios Innegociables de Arquitectura

1. **Patrón BFF y Seguridad de Tokens (`HttpOnly`):**
   - El navegador **jamás** almacena `access_token` ni `refresh_token` en `localStorage`, `sessionStorage` ni variables `NEXT_PUBLIC_*`.
   - La autenticación pasa por Route Handlers / Server Actions de Next.js (`/api/bff/...`), que guardan los tokens en cookies `HttpOnly; Secure; SameSite=Lax`.
   - El refresco (`POST /api/v1/auth/refresh`) **debe usar exclusión mutua (mutex)** para encolar peticiones `401` concurrentes y evitar disparar la detección de robo/reuso de tokens de FastAPI.
2. **Frontera Server Components (RSC) vs Client Components (`"use client"`):**
   - Por defecto todo componente es **Server Component**. Solo añade `"use client"` en las hojas interactivas que usen hooks de navegador, hardware (`navigator.mediaDevices`), TanStack Query, Zustand o XState.
   - Con `cacheComponents: true` activo en `next.config.ts`, envuelve accesos dinámicos o `useSearchParams` (`nuqs`) dentro de límites `<Suspense>`.
3. **Gestión de Estado Estricta en 5 Capas:**
   - **Capa 1 — Server Render State:** React Server Components + `<Suspense>` (SEO, recetas públicas, hidratación inicial).
   - **Capa 2 — Server Async Cache:** **TanStack Query v5** (`networkMode: "offlineFirst"`) para lotes FEFO, productos, alertas y mutaciones optimistas.
   - **Capa 3 — URL State:** **`nuqs`** para filtros compartibles (`?location=...&semaforo=...&q=...`), búsqueda y paginación.
   - **Capa 4 — Global Client UI State:** **Zustand** (`src/stores/`) con `devtools` y `persist` únicamente para estado global de UI (`activePantryId`, estado de conexión, cola temporal de escaneo continuo). Prohibido duplicar respuestas crudas del backend en Zustand.
   - **Capa 5 — Form & Finite State:** **React Hook Form + Zod v4** para formularios; **XState v5** para flujos con transiciones críticas como permisos de cámara y lector de códigos de barras.
4. **Contratos Tipados y Trazabilidad:**
   - Nunca escribas interfaces manuales para payloads de FastAPI: usa los tipos generados en `src/lib/api/schema.d.ts` (`pnpm generate:api` desde `docs/openapi.json`). Consulta `docs/BACKEND_API_CONTEXT.md` para reglas de dominio, semillas y códigos de error.
   - Propaga `X-Correlation-ID` y parsea errores bajo el estándar **RFC 7807 (`application/problem+json`)**.
5. **Resiliencia PWA *Offline-First*:**
   - Service Worker gestionado con **Serwist** en `src/sw.ts` (tipado aislado en `tsconfig.sw.json`).
   - Las mutaciones realizadas sin conexión se registran en **Dexie (`src/lib/db/offline-db.ts`)** siguiendo el patrón *Client Outbox* y marcan estado `"conflict"` si al reconectar FastAPI responde un error de negocio (ej. `400 insufficient-stock`).
6. **Sistema de Diseño Google Stitch:**
   - Usa exclusivamente los tokens semánticos definidos en `src/app/globals.css` (`bg-surface`, `bg-primary-container`, `--semaforo-*`, tipografías `font-display` *Newsreader* y `font-sans` *Manrope*) y primitivas accesibles de `radix-ui`.
7. **Plataforma Web Moderna y Documentación:**
   - This project's Baseline target is Baseline Widely available.
   - Sigue [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) ([guías para humanos](https://web.dev/explore/mwg-for-humans)) para patrones de plataforma: formularios, foco, diálogos, rendimiento y seguridad. Cualquier función fuera del objetivo Baseline requiere *feature detection* y *fallback*.
   - Documenta con **JSDoc** todo componente, hook y función exportada: propósito, `@param`, `@returns`, `@example` en `src/components/ui/` y `@see` hacia la guía aplicada.

## 2. Subagentes y Skills del Proyecto (`.agents/`)

- **Subagentes especializados (`.agents/agents/`):**
  - `stitch-ui-builder`: Traducción de pantallas de Google Stitch a componentes React 19 + Tailwind v4 + Radix UI, aplicando Modern Web Guidance y documentando con JSDoc.
  - `bff-state-architect`: Implementación de BFF `HttpOnly`, contratos OpenAPI, TanStack Query, Zustand y `nuqs`.
  - `pwa-offline-specialist`: Service Worker Serwist, colas Offline Outbox en Dexie, reconciliación RFC 7807 y máquinas XState de escáner.
  - `qa-frontend-auditor`: Auditoría de seguridad cliente, fronteras RSC, accesibilidad WCAG, cobertura JSDoc, cumplimiento de Modern Web Guidance y pruebas en Vitest / Playwright (incluyendo modo offline).
- **Skills procedimentales (`.agents/skills/`):**
  - `implement-stitch-screen`: Flujo completo desde Stitch MCP hasta ruta Next.js integrada (incluye Modern Web Guidance y JSDoc).
  - `offline-outbox-mutation`: Receta estándar para mutaciones optimistas con soporte sin red y resolución de conflictos.
  - `gitflow-pr-delivery`: Flujo de ramas, puertas de calidad y entrega por Pull Request con CI en verde (solo a petición del usuario; merge con confirmación explícita).
  - `modern-web-guidance`: Skill externa de buenas prácticas de plataforma web (ver abajo).

- **Contexto vivo:** antes de empezar, lee `docs/FRONTEND_CONTEXT.md` (estado de las entregas, decisiones, hallazgos abiertos y próximos pasos) y actualízalo al cerrar cada bloque de trabajo.
- **Skill externa `modern-web-guidance`** (Google Chrome, Firefox y Edge): copia versionada en `.agents/skills/modern-web-guidance/` (hash en `skills-lock.json`). La usan `stitch-ui-builder` y `qa-frontend-auditor`. Actualízala con `npx modern-web-guidance@latest update`; sin red, lee las guías locales en `guides/<área>/*.md`.
- **Espejo `.agents/` ⇄ `.claude/`:** los subagentes y skills existen para Antigravity (`.agents/`) y Claude Code (`.claude/`) con el **mismo cuerpo**; solo cambian el frontmatter (nombres de herramientas, `subagent`/`mainAgent` en Antigravity; `skills`/`disable-model-invocation` en Claude) y las rutas de skills (cada uno apunta a su carpeta). Si cambias uno, sincroniza el otro en el mismo commit.

### Reglas operativas comunes (todos los agentes)

- **Gitflow:** las ramas salen de `develop` y los PR van a `develop` (a `main` solo en `release`). `gitflow-pr-delivery` se ejecuta solo a petición del usuario y **nunca se hace merge sin su confirmación explícita**.
- **Entorno:** Windows + pnpm. Ejecuta las puertas de calidad de §3 antes de cualquier push.
- **Next.js 16:** antes de escribir código de Next, consulta la guía en `node_modules/next/dist/docs/` (ver bloque al inicio).
- **MCP:** servidor `stitch` para pantallas de Google Stitch (Project ID `1951021510829166998`) y `gh` / MCP `github` para PRs y check runs.

## 3. Puertas de Calidad y Gitflow

Antes de abrir o actualizar cualquier Pull Request hacia `develop`:
1. `pnpm lint` (0 errores en ESLint 9)
2. `pnpm typecheck` (`next typegen` + `tsc` en App y Service Worker con 0 errores)
3. `pnpm test` (100% de tests unitarios pasando en Vitest)
4. `pnpm build` (Build de producción Turbopack + generación de `public/sw.js` con Serwist)
