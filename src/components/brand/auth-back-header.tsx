import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ConnectionStatusPill } from "@/components/connection-status-pill";

const backLinkClass =
  "-ml-2 inline-flex size-11 items-center justify-center rounded-full text-primary-container transition-colors hover:bg-surface-high/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container";

/**
 * Cabecera de las pantallas secundarias de auth: botón "volver" (44x44), marca
 * y píldora de conexión. Server Component.
 *
 * @param props.href - Destino del botón volver.
 * @param props.backLabel - Nombre accesible del botón (el ícono es `aria-hidden`).
 * @returns `<header>` en rejilla de tres columnas.
 *
 * @example
 * ```tsx
 * <AuthBackHeader href="/login" backLabel="Volver a iniciar sesión" />
 * ```
 */
export function AuthBackHeader({ href, backLabel }: { href: string; backLabel: string }) {
  return (
    <header className="grid h-11 grid-cols-[2.75rem_1fr_auto] items-center pt-3">
      <Link href={href} aria-label={backLabel} className={backLinkClass}>
        <ArrowLeft aria-hidden="true" className="size-5" strokeWidth={2} />
      </Link>
      <span className="text-center font-display text-xl font-medium tracking-tight text-primary-container italic">
        Despensa
      </span>
      <ConnectionStatusPill className="min-w-11 justify-end" />
    </header>
  );
}
