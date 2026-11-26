# Despensa Frontend (Next.js 16 + React 19 + PWA Offline-First)

Aplicación web y PWA *mobile-first* para el control inteligente de despensa del hogar, conectada con **Despensa Backend (FastAPI)** y basada en el sistema de diseño de **Google Stitch**.

## Stack Tecnológico

- **Núcleo & BFF:** Next.js 16 (App Router + Turbopack), React 19, TypeScript (`strict`).
- **Contratos Tipados:** `openapi-typescript` + `openapi-fetch` sincronizados con `docs/openapi.json`.
- **Gestión de Estado en 5 Capas:**
  1. *Server Render State:* React Server Components + `<Suspense>`.
  2. *Server Async Cache:* TanStack Query v5 (`offlineFirst`).
  3. *URL State:* `nuqs`.
  4. *Global Client UI State:* **Zustand** (`devtools` + `persist`).
  5. *Form State & Máquinas Finitas:* React Hook Form + Zod + XState v5 (escáner de cámara).
- **UI & Estilos:** Tailwind CSS v4 + primitivas accesibles Radix UI + Lucide Icons + tokens Google Stitch (`Newsreader` & `Manrope`).
- **PWA & Offline-First:** **Serwist** (Service Worker) + **Dexie.js** (IndexedDB + Client Outbox Queue).
- **Calidad:** ESLint 9, Vitest + Testing Library, Playwright E2E y GitHub Actions CI.

## Comandos Principales

```bash
pnpm install        # Instala dependencias
pnpm generate:api   # Genera tipos TypeScript desde docs/openapi.json
pnpm dev            # Servidor de desarrollo en http://localhost:3000
pnpm lint           # Revisión estática con ESLint
pnpm typecheck      # Verificación estricta de TypeScript (App + Service Worker)
pnpm test           # Pruebas unitarias con Vitest
pnpm build          # Compila producción Next.js + genera Service Worker (public/sw.js)
pnpm test:e2e       # Ejecuta pruebas E2E con Playwright
```
