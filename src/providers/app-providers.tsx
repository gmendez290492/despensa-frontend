"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useEffect, useState } from "react";
import { subscribeToConnectionStatus } from "@/lib/offline/connection";
import { useUiStore } from "@/stores/ui-store";

/**
 * Providers de cliente: `nuqs` (estado en URL), TanStack Query (`offlineFirst`),
 * suscripción al estado de conexión y registro del Service Worker en producción.
 *
 * @remarks La suscripción y el registro ocurren en `useEffect` para que SSR y el
 * primer render cliente coincidan (sin mismatch de hidratación).
 *
 * @param props.children - Árbol de la app.
 * @returns Los providers envolviendo `children`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            gcTime: 24 * 60 * 60 * 1000,
            retry: 1,
            networkMode: "offlineFirst",
          },
          mutations: {
            networkMode: "offlineFirst",
          },
        },
      }),
  );

  useEffect(() => {
    // Tras el montaje: SSR y el primer render cliente usan "online" (sin mismatch).
    const unsubscribe = subscribeToConnectionStatus(
      () => useUiStore.getState().connectionStatus,
      (status) => useUiStore.getState().setConnectionStatus(status),
    );

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      // `updateViaCache: "none"`: el navegador nunca usa la caché HTTP para sw.js.
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((error: unknown) => console.warn("[sw] registro fallido", error));
    }

    return unsubscribe;
  }, []);

  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
