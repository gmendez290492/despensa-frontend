"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useEffect, useState } from "react";
import { useUiStore } from "@/stores/ui-store";

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

  const setConnectionStatus = useUiStore((state) => state.setConnectionStatus);

  useEffect(() => {
    const syncNetworkState = () => {
      setConnectionStatus(navigator.onLine ? "online" : "offline");
    };

    syncNetworkState();
    window.addEventListener("online", syncNetworkState);
    window.addEventListener("offline", syncNetworkState);

    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js");
    }

    return () => {
      window.removeEventListener("online", syncNetworkState);
      window.removeEventListener("offline", syncNetworkState);
    };
  }, [setConnectionStatus]);

  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
