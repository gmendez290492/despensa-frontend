---
name: gitflow-pr-delivery
description: Flujo de trabajo Gitflow obligatorio para despensa-frontend desde creación de rama en develop, validación local completa, Pull Request, espera de CI en verde y merge con limpieza de rama.
disable-model-invocation: true
---

# Flujo de Entrega Gitflow con Validación CI/CD

Sigue estrictamente estos pasos para entregar cualquier funcionalidad, corrección o mejora en `despensa-frontend`.

## Paso 1: Preparar Rama desde `develop`

1. Sincroniza `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   ```
2. Crea una rama descriptiva (`feature/<nombre>`, `fix/<nombre>` o `chore/<nombre>`):
   ```bash
   git checkout -b feature/<nombre-corto>
   ```

## Paso 2: Puertas de Calidad Locales

Antes de hacer commit o push, ejecuta las 4 verificaciones y corrige cualquier fallo:
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`

*(Si el contrato `docs/openapi.json` cambió, ejecuta primero `pnpm generate:api` e incluye `src/lib/api/schema.d.ts` en el commit).*

## Paso 3: Commit Convencional, Push y Pull Request

1. Crea commits atómicos siguiendo *Conventional Commits* (`feat(...)`, `fix(...)`, `chore(...)`, `test(...)`).
2. Publica la rama (`git push -u origin <rama>`) y abre un Pull Request hacia `develop` completando la plantilla `.github/pull_request_template.md` (o hacia `main` únicamente en cortes de versión `release`).

## Paso 4: Verificación de GitHub Actions y Limpieza

1. Inspecciona los *check runs* del Pull Request (`gh pr checks <n> --watch` o el MCP `github` con `pull_request_read` / `method: "get_check_runs"`) y espera a que el job `Lint, Typecheck, Unit Tests & Production Build` termine en **`success`**.
2. Una vez 100% en verde, **pide confirmación explícita al usuario** y solo entonces fusiona el Pull Request (`gh pr merge` o `merge_pull_request`), elimina la rama remota y local, y deja la copia local sincronizada en `develop`.
