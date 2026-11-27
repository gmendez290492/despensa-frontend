import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthBackHeader } from "@/components/brand/auth-back-header";
import { AuthFormSkeleton } from "@/features/auth/components/auth-form-skeleton";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

/** Metadatos de `/recuperar-contrasena`. */
export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

/**
 * "Olvidé mi contraseña": Stitch "Despensa - Recuperar Contraseña"
 * (screen `84802b86c1ae44ea83665e1b0e03b10b`). Del diseño se omiten la
 * segunda barra superior con botón de perfil (pantalla sin sesión).
 *
 * @returns La página de recuperación.
 */
export default function ForgotPasswordPage() {
  return (
    <>
      <AuthBackHeader href="/login" backLabel="Volver a iniciar sesión" />
      <main className="flex-1 pt-7 pb-8">
        <section className="mb-6">
          <p className="mb-1.5 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground uppercase">
            Recuperar acceso
          </p>
          <h1 className="mb-2 font-display text-[1.75rem] leading-[1.2] font-normal tracking-tight text-foreground">
            ¿Olvidaste tu contraseña?
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Escribe el correo de tu cuenta y te enviaremos un enlace para crear una nueva.
          </p>
        </section>
        <Suspense fallback={<AuthFormSkeleton fields={1} />}>
          <ForgotPasswordForm />
        </Suspense>
      </main>
    </>
  );
}
