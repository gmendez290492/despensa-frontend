"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { Button } from "@/components/ui/button";

/**
 * Límite de error raíz (p. ej. backend caído al renderizar la home). Los 401
 * no llegan aquí: `getCurrentUser()` los convierte en `null`.
 *
 * Next 16.3+ expone `retry()` (re-fetch + re-render del segmento), preferible
 * a `reset()` porque vuelve a ejecutar los Server Components que fallaron.
 */
export default function RootError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <main className="mx-auto flex w-full max-w-[430px] flex-1 flex-col px-5 py-6 md:max-w-md">
      <header className="pb-10">
        <BrandMark />
      </header>
      <section
        role="alert"
        className="rounded-[4px] border border-border-sand bg-surface-lowest p-6 shadow-ambient"
      >
        <div className="mb-5 flex size-11 items-center justify-center rounded-[4px] border border-error/25 bg-error-container text-error">
          <AlertTriangle aria-hidden="true" className="size-5" strokeWidth={1.8} />
        </div>
        <h1 className="font-display text-[2rem] leading-[1.18] font-normal tracking-tight text-foreground">
          Algo salió mal
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          No pudimos cargar esta página. Es posible que el servicio no esté disponible en este
          momento. Inténtalo de nuevo en unos segundos.
        </p>
        {digest ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Código de referencia: <span className="font-mono">{digest}</span>
          </p>
        ) : null}
        <div className="mt-6">
          <Button fullWidth onClick={() => retry()}>
            <RotateCw aria-hidden="true" className="size-4" />
            Reintentar
          </Button>
        </div>
      </section>
    </main>
  );
}
