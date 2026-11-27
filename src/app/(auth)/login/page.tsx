import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { ConnectionStatusPill } from "@/components/connection-status-pill";
import { AuthFormSkeleton } from "@/features/auth/components/auth-form-skeleton";
import { LoginForm } from "@/features/auth/components/login-form";

/** Metadatos de `/login`: el título se compone con la plantilla `%s | Despensa` del layout raíz. */
export const metadata: Metadata = {
  title: "Iniciar sesión",
};

/** Stitch "Despensa - Inicio de Sesión" (screen 4d4e6b2187214e199d780ad47bc707ae). */
export default function LoginPage() {
  return (
    <>
      <header className="flex items-center justify-between gap-3 pt-6 pb-4">
        <BrandMark />
        <ConnectionStatusPill />
      </header>

      <main className="flex flex-1 flex-col justify-center py-6">
        <div className="mb-6">
          <h1 className="font-display text-[2rem] leading-[1.18] font-normal tracking-tight text-foreground">
            Bienvenido de vuelta a tu despensa
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
            Inicia sesión para revisar tus lotes, alertas de caducidad y recetas anti-desperdicio.
          </p>
        </div>

        <Suspense fallback={<AuthFormSkeleton fields={2} />}>
          <LoginForm />
        </Suspense>
      </main>

      <footer className="border-t border-border-sand/70 pt-4 pb-6 text-center">
        <p className="inline-flex items-center justify-center gap-1.5 text-[0.625rem] font-semibold tracking-wider text-muted-foreground uppercase">
          <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0 text-primary-container" strokeWidth={1.8} />
          Sesión protegida · Tus datos no se guardan en el navegador
        </p>
      </footer>
    </>
  );
}
