import Link from "next/link";
import type { ReactNode } from "react";
import { JarIcon } from "@/components/brand/brand-mark";
import { AppBottomNav } from "@/components/app-shell/bottom-nav";
import { ConnectionStatusPill } from "@/components/connection-status-pill";
import { StatusAnnouncerProvider } from "@/components/status-announcer";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { ConsumeDialogProvider } from "@/features/pantry/components/consume-dialog-provider";
import { OutboxBanner, OutboxSync } from "@/features/pantry/components/outbox-banner";

/**
 * Shell autenticado (RSC): cabecera con marca, estado de conexión y cierre
 * de sesión; aviso de la outbox; contenido de la página y navegación
 * inferior. Las hojas interactivas (outbox, diálogo de consumo, región de
 * estado, navegación) son Client Components; el contenedor se prerenderiza.
 *
 * @remarks `OutboxSync` envuelve el shell para que `LogoutButton` pueda
 * forzar la sincronización antes de cerrar sesión con cambios pendientes.
 *
 * Orden de fuente: cabecera → `<main>` (cada página) → `<nav>`. La
 * navegación va al final del DOM aunque se vea fija abajo, así el teclado
 * llega antes al contenido y no hace falta *skip link* (la cabecera solo
 * tiene dos controles).
 *
 * @param props.children - Página activa (`/`, `/despensa`).
 * @returns El shell mobile-first (columna de ~430 px que crece en tablet).
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `accessibility` (landmarks y skip links).
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <StatusAnnouncerProvider>
      <ConsumeDialogProvider>
        <OutboxSync>
          <div className="flex flex-1 justify-center bg-background">
            <div className="flex min-h-dvh w-full max-w-[26.875rem] flex-col px-4 pb-28 md:max-w-2xl md:px-6">
              <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                <Link
                  href="/"
                  className="inline-flex min-h-11 items-center gap-2 rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
                >
                  <span className="flex size-8 items-center justify-center rounded-[4px] bg-primary-container text-primary-foreground">
                    <JarIcon className="size-4" />
                  </span>
                  <span className="font-display text-xl leading-none font-semibold tracking-tight text-primary-container">
                    Despensa
                  </span>
                </Link>
                <div className="flex items-center gap-2">
                  <ConnectionStatusPill />
                  <LogoutButton />
                </div>
              </header>
              <OutboxBanner />
              {children}
            </div>
          </div>
          <AppBottomNav />
        </OutboxSync>
      </ConsumeDialogProvider>
    </StatusAnnouncerProvider>
  );
}
