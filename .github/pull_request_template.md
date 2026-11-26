## Resumen del Cambio

- **Etapa / Módulo:** 
- **Pantallas de Stitch relacionadas (si aplica):** 

## Checklist de Arquitectura y Calidad

- [ ] Respeta la frontera **Server Components (RSC)** vs **`"use client"`** (incluyendo `<Suspense>` para datos dinámicos / `nuqs`).
- [ ] Respeta la separación de estado en 5 capas (**RSC / TanStack Query / `nuqs` / Zustand / RHF+Zod o XState**).
- [ ] Ningún token JWT (`access_token` / `refresh_token`) se expone en `localStorage` ni en cliente JS.
- [ ] Usa tipos autogenerados de `src/lib/api/schema.d.ts` y maneja errores **RFC 7807 (`application/problem+json`)**.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` pasan sin errores.
