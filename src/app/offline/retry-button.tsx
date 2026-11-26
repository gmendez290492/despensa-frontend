"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Recarga la URL actual. Cuando el SW sirve `/offline` como fallback, la barra
 * de direcciones conserva la ruta original, así que recargar la reintenta.
 */
export function RetryButton() {
  return (
    <Button fullWidth onClick={() => window.location.reload()}>
      <RotateCw aria-hidden="true" className="size-4" />
      Reintentar
    </Button>
  );
}
