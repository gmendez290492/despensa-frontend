import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConnectionStatusPill } from "@/components/connection-status-pill";
import { AuthFormSkeleton } from "@/features/auth/components/auth-form-skeleton";
import { PreserveNextLink } from "@/features/auth/components/auth-link";
import { RegisterForm } from "@/features/auth/components/register-form";

/** Metadatos de `/registro`: el título se compone con la plantilla `%s | Despensa` del layout raíz. */
export const metadata: Metadata = {
  title: "Crear cuenta",
};

const backLinkClass =
  "-ml-2 inline-flex size-11 items-center justify-center rounded-full text-primary-container transition-colors hover:bg-surface-high/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container";

function BackIcon() {
  return <ArrowLeft aria-hidden="true" className="size-5" strokeWidth={2} />;
}

/** Stitch "Despensa - Crear Cuenta (Registro)" (screen 4a85f9a297184c228178ec3982dec9ed). */
export default function RegisterPage() {
  return (
    <>
      <header className="grid h-11 grid-cols-[2.75rem_1fr_auto] items-center pt-3">
        <Suspense
          fallback={
            <Link href="/login" aria-label="Volver a iniciar sesión" className={backLinkClass}>
              <BackIcon />
            </Link>
          }
        >
          <PreserveNextLink href="/login" aria-label="Volver a iniciar sesión" className={backLinkClass}>
            <BackIcon />
          </PreserveNextLink>
        </Suspense>
        <span className="text-center font-display text-xl font-medium tracking-tight text-primary-container italic">
          Despensa
        </span>
        <ConnectionStatusPill className="min-w-11 justify-end" />
      </header>

      <main className="flex-1 pt-7 pb-8">
        <section className="mb-6">
          <p className="mb-1.5 text-[0.6875rem] font-bold tracking-[0.16em] text-muted-foreground uppercase">
            Registro
          </p>
          <h1 className="mb-2 font-display text-[1.75rem] leading-[1.2] font-normal tracking-tight text-foreground">
            Abre tu cuaderno de despensa
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Crea tu cuenta para registrar lotes, recibir alertas antes de que algo caduque y
            cocinar sin desperdicio.
          </p>
        </section>

        <Suspense fallback={<AuthFormSkeleton fields={4} />}>
          <RegisterForm />
        </Suspense>
      </main>

      <footer className="border-t border-border-sand py-4 text-center">
        <p className="text-[0.6875rem] leading-relaxed text-muted-foreground">
          Al crear tu cuenta aceptas los Términos y el Aviso de Privacidad de Despensa.
        </p>
      </footer>
    </>
  );
}
