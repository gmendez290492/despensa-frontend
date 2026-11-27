import { WifiOff } from "lucide-react";

/**
 * Motivo por el que se muestra `/offline`:
 * - `"red"`: el dispositivo no tiene conexión (fallback del Service Worker o
 *   backend caído). Es el texto por defecto y el del HTML precacheado.
 * - `"limite"`: hay red, pero el refresh de sesión recibió un `429`
 *   (`/offline?motivo=limite`).
 */
export type OfflineReason = "red" | "limite";

/** Props de {@link OfflineCopy}. */
export interface OfflineCopyProps {
  /** Variante del texto. */
  reason: OfflineReason;
}

/**
 * Icono, título y explicación de `/offline`. No es un Client Component: lo
 * usan tanto el fallback de `<Suspense>` (HTML estático precacheado) como la
 * hoja cliente `OfflineMessage`, así las dos versiones tienen el mismo marcado.
 *
 * @remarks
 * Con `"limite"` no se muestra el icono de wifi tachado: el problema no es la
 * red y el icono contradiría el texto.
 *
 * @param props - {@link OfflineCopyProps}.
 * @returns El encabezado `<h1>` y los párrafos explicativos.
 */
export function OfflineCopy({ reason }: OfflineCopyProps) {
  if (reason === "limite") {
    return (
      <>
        <h1 className="font-display text-[2rem] leading-[1.18] font-normal tracking-tight text-foreground">
          Demasiados intentos
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          Hicimos demasiadas solicitudes seguidas para verificar tu sesión. Espera unos segundos y
          vuelve a intentarlo.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Tu sesión sigue activa: no necesitas volver a iniciar sesión.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="mb-5 flex size-11 items-center justify-center rounded-[4px] border border-amber-status/25 bg-amber-status/10 text-amber-status">
        <WifiOff aria-hidden="true" className="size-5" strokeWidth={1.8} />
      </div>
      <h1 className="font-display text-[2rem] leading-[1.18] font-normal tracking-tight text-foreground">
        Sin conexión
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
        No pudimos cargar esta página porque tu dispositivo no tiene conexión a internet. Revisa
        tu red o acércate a una zona con mejor señal y vuelve a intentarlo.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Por tu seguridad, los datos de tu despensa no se muestran sin conexión hasta que
        verifiquemos tu sesión.
      </p>
    </>
  );
}
