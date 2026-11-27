# CLAUDE.md — `despensa-frontend`

Las reglas de arquitectura son compartidas con otros agentes (Antigravity) y viven en `AGENTS.md`. Se importan aquí:

@AGENTS.md

## Notas específicas de Claude Code

- **Subagentes** (`.claude/agents/`): `stitch-ui-builder`, `bff-state-architect`, `pwa-offline-specialist`, `qa-frontend-auditor`. Son espejo de `.agents/agents/`; si cambias uno, sincroniza el otro.
- **Skills** (`.claude/skills/`): `implement-stitch-screen`, `offline-outbox-mutation`, `backend-integration-suites`, `gitflow-pr-delivery` (esta última solo se invoca manualmente con `/gitflow-pr-delivery`). Espejo de `.agents/skills/`.
- **Modern Web Guidance:** la skill `modern-web-guidance` (Google Chrome, Firefox y Edge) está versionada en `.agents/skills/modern-web-guidance/` (ver `skills-lock.json`). La usan `stitch-ui-builder` y `qa-frontend-auditor`. Como `core.symlinks=false`, el enlace `.claude/skills/modern-web-guidance` es local e ignorado por git; tras clonar, recréalo con `npx modern-web-guidance@latest install` (o `update`). Docs: https://developer.chrome.com/docs/modern-web-guidance
- **Contexto entre sesiones:** al retomar ("continuemos donde nos quedamos"), lee primero `docs/FRONTEND_CONTEXT.md`; al terminar, actualízalo (estado, puertas de calidad, hallazgos y próximos pasos).
- **MCP:** usa el servidor `stitch` para pantallas de Google Stitch (Project ID `1951021510829166998`) y `gh` / MCP `github` para PRs y check runs.
- **Gitflow:** las ramas salen de `develop` y los PR van a `develop` (a `main` solo en `release`). Nunca hagas merge sin confirmación explícita del usuario.
- **Entorno:** Windows + pnpm. Ejecuta las puertas de calidad (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) antes de cualquier push.
- **Next.js 16:** antes de escribir código de Next, consulta la guía correspondiente en `node_modules/next/dist/docs/` (ver bloque al inicio de `AGENTS.md`).
