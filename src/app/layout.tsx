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

export const metadata: Metadata = {
  title: {
    default: "Despensa — Control Inteligente de Alimentos",
    template: "%s | Despensa",
  },
  description:
    "Aplicación inteligente de inventario del hogar con semáforo FEFO, recetas anti-desperdicio y modo offline.",
};

export const viewport: Viewport = {
  themeColor: "#2e473b",
  width: "device-width",
  initialScale: 1,
};

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
