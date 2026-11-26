import type { Metadata, Viewport } from "next";
import { Manrope, Newsreader } from "next/font/google";
import { Suspense } from "react";
import { AppProviders } from "@/providers/app-providers";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

/** Metadatos globales: título por defecto y plantilla `%s | Despensa` para las páginas hijas. */
export const metadata: Metadata = {
  title: {
    default: "Despensa — Control Inteligente de Alimentos",
    template: "%s | Despensa",
  },
  description:
    "Aplicación inteligente de inventario del hogar con semáforo FEFO, recetas anti-desperdicio y modo offline.",
};

/**
 * Viewport y `theme-color` (barra del navegador / PWA instalada).
 *
 * @remarks No fija `maximumScale` ni `userScalable`: bloquear el zoom rompe
 * WCAG 1.4.4 (cambio de tamaño del texto).
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `respect-os-text-scale`.
 */
export const viewport: Viewport = {
  themeColor: "#2e473b",
  width: "device-width",
  initialScale: 1,
};

/**
 * Layout raíz: `<html lang="es">`, fuentes Newsreader/Manrope como variables CSS y
 * {@link AppProviders} dentro de `<Suspense>` (requisito de `cacheComponents`, ya
 * que los providers leen `useSearchParams` vía `nuqs`).
 *
 * @param props.children - Árbol de la ruta activa.
 * @returns El documento HTML completo.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${newsreader.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Suspense fallback={null}>
          <AppProviders>{children}</AppProviders>
        </Suspense>
      </body>
    </html>
  );
}
