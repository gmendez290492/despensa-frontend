import { Suspense } from "react";
import { BrandMark } from "@/components/brand/brand-mark";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { getCurrentUser } from "@/lib/auth/session";

/*
 * TEMPORAL: placeholder autenticado hasta implementar el Home Dashboard de
 * Stitch. Solo saluda al usuario y permite cerrar sesión.
 */

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

  return (
    <>
      <h1 className="font-display text-4xl font-normal tracking-tight text-foreground">
        Hola, {user.full_name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tu panel de despensa estará disponible muy pronto.
      </p>
      <div className="mt-8">
        <LogoutButton />
      </div>
    </>
  );
}

function GreetingSkeleton() {
  return (
    <div role="status" aria-label="Cargando tu sesión" className="space-y-3">
      <div className="h-10 w-3/4 motion-safe:animate-pulse rounded-[4px] bg-surface-high" />
      <div className="h-4 w-1/2 motion-safe:animate-pulse rounded-[4px] bg-surface-high" />
    </div>
  );
}

/**
 * Home autenticada (placeholder temporal). La parte dinámica (`Greeting`) va en
 * `<Suspense>` para que el shell se prerenderice con `cacheComponents`.
 *
 * @returns La página principal.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-[430px] flex-1 flex-col px-5 py-6 md:max-w-2xl">
      <header className="pb-10">
        <BrandMark />
      </header>
      <section className="rounded-[4px] border border-border-sand bg-surface-lowest p-6 shadow-ambient">
        <Suspense fallback={<GreetingSkeleton />}>
          <Greeting />
        </Suspense>
      </section>
    </main>
  );
}
