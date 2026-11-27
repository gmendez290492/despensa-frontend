"use client";

import { House, Package } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: House },
  { href: "/despensa", label: "Despensa", icon: Package },
] as const;

/**
 * `true` si `href` es la sección activa (`/despensa` también cubre subrutas).
 *
 * @param pathname - Ruta actual.
 * @param href - Destino del enlace.
 * @returns Si el enlace corresponde a la página actual.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Barra de navegación inferior del shell autenticado (Stitch: Home / Pantry).
 * Solo enlaza secciones existentes: "Recetas" y "Ajustes" del diseño se
 * omiten hasta que tengan ruta (nada de enlaces muertos).
 *
 * @remarks
 * - Un único `<nav aria-label>` con enlaces nativos en el orden de `Tab`
 *   (navegación, no menú de aplicación: sin `role="menubar"` ni flechas).
 * - La página actual lleva `aria-current="page"` y se distingue sin depender
 *   del color: texto en negrita y barra superior (contraste >= 3:1).
 * - Objetivos táctiles >= 44 px y `padding` con `safe-area-inset-bottom`;
 *   `globals.css` añade `scroll-padding-bottom` para que el foco no quede
 *   tapado por la barra (WCAG 2.4.11).
 * - `usePathname` no necesita `<Suspense>` aquí: las rutas del shell son
 *   estáticas y se resuelven en el prerender (`cacheComponents`).
 *
 * @returns El `<nav>` fijo inferior.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `navbar` y `form-factor-adaptation`.
 */
export function AppBottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Principal"
      className="app-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-border-sand bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur"
    >
      <ul className="mx-auto flex h-16 max-w-[26.875rem] items-stretch justify-around px-4 md:max-w-2xl">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isNavItemActive(pathname, href);
          return (
            <li key={href} className="flex flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] tracking-wide transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-primary-container",
                  "before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-[2px] before:bg-transparent",
                  "aria-[current=page]:font-bold aria-[current=page]:text-primary aria-[current=page]:before:bg-primary-container",
                  !active && "font-medium text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-6" strokeWidth={active ? 2.2 : 1.75} />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
