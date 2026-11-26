import type { MetadataRoute } from "next";

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
