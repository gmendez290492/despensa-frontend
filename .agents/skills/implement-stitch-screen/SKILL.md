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

0. Antes de escribir código de UI, ejecuta la skill **`modern-web-guidance`** (`search` → `retrieve`, o las guías locales en `.agents/skills/modern-web-guidance/guides/`) para cada patrón de plataforma que aparezca en la pantalla: formularios, validación, autofill, diálogos, foco, tablas, imágenes o fechas. Respeta el objetivo Baseline de `AGENTS.md`.

1. Reemplaza colores arbitrarios del HTML exportado por los tokens semánticos de `src/app/globals.css` (`bg-surface`, `bg-surface-lowest`, `bg-primary-container`, `--semaforo-*`).
2. Sustituye modales, popovers o tabs planos por la primitiva nativa que recomiende Modern Web Guidance (`<dialog>`, `popover`) cuando sea Baseline; usa `radix-ui` para patrones complejos sin equivalente nativo accesible (combobox, menús, tabs con roving focus).
3. Verifica que todo indicador del semáforo FEFO incluya texto legible e ícono además del color.

## Paso 4: Verificación

1. Documenta con **JSDoc** todo componente, hook y función exportada (propósito, `@param`, `@returns`, `@example` en `src/components/ui/`, `@see` a la guía aplicada).
2. Añade prueba unitaria en `tests/unit/` o prueba E2E en `tests/e2e/`.
3. Ejecuta `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`.
