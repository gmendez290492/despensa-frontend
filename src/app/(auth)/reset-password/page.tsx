import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthBackHeader } from "@/components/brand/auth-back-header";
import { AuthFormSkeleton } from "@/features/auth/components/auth-form-skeleton";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

/**
 * Metadatos de `/reset-password`: `noindex` (es el destino de un enlace con
 * token de un solo uso) y referrer desactivado también vía `<meta>`.
 */
export const metadata: Metadata = {
  title: "Restablecer contraseña",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Stitch "Despensa - Restablecer Contraseña" (screen
 * `ad43b46c2dbb4794b1b4660b02272223`). Se omiten del diseño la barra con botón
 * de perfil y la tarjeta "¿Necesitas asistencia?" (sin destino en el producto).
 *
 * Destino del correo de recuperación (`/reset-password?token=…`; el nombre de
 * la ruta lo fija `FRONTEND_BASE_URL` del backend).
 *
 * @remarks Además del `<meta name="referrer">`, `next.config.ts` envía
 * `Referrer-Policy: no-referrer` en esta ruta. La página no carga recursos de
 * terceros (las fuentes de `next/font` se sirven desde el propio origen).
 *
 * @returns La página de restablecimiento.
 */
export default function ResetPasswordPage() {
  return (
    <>
      <AuthBackHeader href="/login" backLabel="Ir a iniciar sesión" />
      <main className="flex-1 pt-7 pb-8">
        <section className="mb-6">
          <p className="mb-1.5 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground uppercase">
            Recuperar acceso
          </p>
          <h1 className="mb-2 font-display text-[1.75rem] leading-[1.2] font-normal tracking-tight text-foreground">
            Crea una contraseña nueva
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Al guardarla cerraremos la sesión en todos tus dispositivos.
          </p>
        </section>
        <Suspense fallback={<AuthFormSkeleton fields={1} />}>
          <ResetPasswordForm />
        </Suspense>
      </main>
    </>
  );
}
