import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { OfflineCopy } from "./offline-copy";
import { OfflineMessage } from "./offline-message";
import { RetryButton } from "./retry-button";

/** Metadatos del fallback offline: `noindex` porque no es contenido navegable para buscadores. */
export const metadata: Metadata = {
  title: "Sin conexión",
  robots: { index: false, follow: false },
};

/**
 * Fallback de navegación offline (precacheado por Serwist). Página estática:
 * sin datos de usuario ni accesos dinámicos, para que sea segura de servir a
 * cualquier persona en el dispositivo.
 *
 * @remarks
 * El texto depende de `?motivo=` (`limite` tras un `429` del refresh), pero la
 * página **no** lee `searchParams`: con `cacheComponents` eso la haría
 * dinámica y dejaría de prerenderizarse para el precache de Serwist. La hoja
 * cliente `OfflineMessage` lo lee dentro de `<Suspense>`, cuyo fallback es el
 * texto por defecto ("Sin conexión") y queda en el HTML estático.
 */
export default function OfflinePage() {
  return (
    <div className="flex flex-1 justify-center bg-background">
      <div className="flex min-h-dvh w-full max-w-[430px] flex-col px-5 sm:border-x sm:border-border-sand/60 md:max-w-md md:px-8">
        <header className="pt-6 pb-4">
          <BrandMark />
        </header>

        <main className="flex flex-1 flex-col justify-center py-6">
          <section className="rounded-[4px] border border-border-sand bg-surface-lowest p-6 shadow-ambient">
            <Suspense fallback={<OfflineCopy reason="red" />}>
              <OfflineMessage />
            </Suspense>

            <div className="mt-6">
              <RetryButton />
            </div>
          </section>
        </main>

        <footer className="border-t border-border-sand/70 pt-4 pb-6 text-center">
          <p className="text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
            Despensa · Modo sin conexión
          </p>
        </footer>
      </div>
    </div>
  );
}
