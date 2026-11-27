"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OFFLINE_PATH } from "@/lib/auth/constants";
import { safeRedirectPath } from "@/lib/auth/redirect";

/**
 * Reintenta la navegación que llevó a `/offline`.
 *
 * - Fallback del Service Worker: la barra de direcciones conserva la ruta
 *   original, así que basta con recargar.
 * - Redirección del BFF (`303` a `/offline?motivo=limite&next=…`): recargar
 *   volvería a mostrar este mismo aviso, así que se navega a `next` (saneado
 *   contra Open Redirect; `/` si falta).
 *
 * La URL se lee al pulsar, no con `useSearchParams`, para no necesitar otro
 * límite `<Suspense>`.
 *
 * @returns El botón "Reintentar".
 */
export function RetryButton() {
  const retry = () => {
    const { pathname, search } = window.location;
    if (pathname === OFFLINE_PATH) {
      window.location.assign(safeRedirectPath(new URLSearchParams(search).get("next")));
      return;
    }
    window.location.reload();
  };

  return (
    <Button fullWidth onClick={retry}>
      <RotateCw aria-hidden="true" className="size-4" />
      Reintentar
    </Button>
  );
}
