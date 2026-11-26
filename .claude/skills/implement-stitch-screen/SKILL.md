---
name: implement-stitch-screen
description: Procedimiento paso a paso para extraer una pantalla de Google Stitch vía MCP y convertirla en una ruta de Next.js 16 conectada al contrato OpenAPI de Despensa API.
---

# Implementar Pantalla desde Google Stitch

Sigue este procedimiento cada vez que se integre o actualice una vista proveniente del proyecto de **Google Stitch** (`Project ID: 1951021510829166998`).

## Paso 1: Inspección en Stitch y Contrato API

1. Localiza el `Screen ID` y los endpoints asociados en `docs/BACKEND_API_CONTEXT.md` (Sección 4).
2. Usa el servidor MCP `stitch` (`get_screen` / `download_file`) para inspeccionar el código HTML de referencia y la captura visual de la pantalla.
3. Revisa en `src/lib/api/schema.d.ts` los tipos exactos de entrada y salida de los endpoints requeridos.

## Paso 2: Diseño de Fronteras (RSC vs Client)

1. Crea el archivo `page.tsx` como **React Server Component** para resolver metadatos, sesión inicial o carga paralela con `<Suspense>`.
2. Extrae en componentes hoja con `"use client"` únicamente las partes interactivas (filtros con `nuqs`, acciones con TanStack Query, selectores de hogar en Zustand o cámara con XState).
3. Si algún subcomponente usa `nuqs` (`useQueryState` / `useSearchParams`), asegúrate de que esté envuelto en un `<Suspense fallback={<Skeleton />}>` para cumplir con `cacheComponents: true` en Next.js 16.

## Paso 3: Adaptación de Estilos y Accesibilidad

1. Reemplaza colores arbitrarios del HTML exportado por los tokens semánticos de `src/app/globals.css` (`bg-surface`, `bg-surface-lowest`, `bg-primary-container`, `--semaforo-*`).
2. Sustituye modales, popovers o tabs planos por primitivas accesibles de `radix-ui`.
3. Verifica que todo indicador del semáforo FEFO incluya texto legible e ícono además del color.

## Paso 4: Verificación

1. Añade prueba unitaria en `tests/unit/` o prueba E2E en `tests/e2e/`.
2. Ejecuta `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`.
