import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { HomeDashboard } from "@/features/pantry/components/home-dashboard";
import { PantrySkeleton, SkeletonBlock } from "@/features/pantry/components/pantry-states";

/** Metadatos de la página de inicio. */
export const metadata: Metadata = { title: "Inicio" };

async function Greeting() {
  const user = await getCurrentUser();

  if (!user) {
    // `proxy.ts` ya redirige sin cookies; esto cubre un access token que el
    // backend rechaza. `/login` rebotaría a `/` (hay cookie), así que se pasa
    // por el refresh GET: rota la sesión o limpia cookies y lleva a /login.
    // Navegación completa (<a>, no <Link>): es un Route Handler con redirect.
    return (
      <p className="text-sm text-muted-foreground">
        Tu sesión expiró.{" "}
        <a
          href="/api/bff/auth/refresh?next=%2F"
          className="font-semibold text-primary-container underline underline-offset-4"
        >
          Inicia sesión de nuevo
        </a>
      </p>
    );
  }

  const firstName = user.full_name.trim().split(/\s+/)[0] ?? user.full_name;
  return <p className="text-sm text-muted-foreground">Hola, {firstName}</p>;
}

/**
 * Inicio autenticado (Stitch "Home Dashboard"). RSC: el titular es estático
 * (prerenderizado); el saludo (sesión por petición) y el panel (TanStack Query
 * + `nuqs`) van en límites `<Suspense>` separados por `cacheComponents`.
 *
 * @returns La página de inicio.
 */
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col gap-5">
      <header className="pt-2">
        <p className="text-[0.6875rem] font-bold tracking-widest text-muted-foreground uppercase">
          Registro de provisiones
        </p>
        <h1 className="font-display text-[1.75rem] leading-9 font-medium tracking-tight text-primary">
          Tu despensa
        </h1>
        <Suspense fallback={<SkeletonBlock className="mt-1 h-5 w-32" />}>
          <Greeting />
        </Suspense>
      </header>
      <Suspense fallback={<PantrySkeleton label="Cargando el panel" />}>
        <HomeDashboard />
      </Suspense>
    </main>
  );
}
