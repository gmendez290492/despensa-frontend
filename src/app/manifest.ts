import type { MetadataRoute } from "next";

/**
 * Web App Manifest servido en `/manifest.webmanifest` (instalación de la PWA).
 *
 * @returns Manifest con `display: "standalone"`, colores del sistema Stitch y `start_url: "/"`.
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `install-web-app`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Despensa — Control Inteligente de Alimentos",
    short_name: "Despensa",
    description:
      "Gestión de inventario del hogar con semáforo FEFO, recetas anti-desperdicio y soporte offline.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f4",
    theme_color: "#2e473b",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
