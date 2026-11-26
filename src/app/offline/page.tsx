import { WifiOff } from "lucide-react";
import type { Metadata } from "next";
import { BrandMark } from "@/components/brand/brand-mark";
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
            <div className="mb-5 flex size-11 items-center justify-center rounded-[4px] border border-amber-status/25 bg-amber-status/10 text-amber-status">
              <WifiOff aria-hidden="true" className="size-5" strokeWidth={1.8} />
            </div>

            <h1 className="font-display text-[32px] leading-[1.18] font-normal tracking-tight text-foreground">
              Sin conexión
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
              No pudimos cargar esta página porque tu dispositivo no tiene conexión a internet.
              Revisa tu red o acércate a una zona con mejor señal y vuelve a intentarlo.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Por tu seguridad, los datos de tu despensa no se muestran sin conexión hasta que
              verifiquemos tu sesión.
            </p>

            <div className="mt-6">
              <RetryButton />
            </div>
          </section>
        </main>

        <footer className="border-t border-border-sand/70 pt-4 pb-6 text-center">
          <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Despensa · Modo sin conexión
          </p>
        </footer>
      </div>
    </div>
  );
}
