"use client";

import { WifiOff } from "lucide-react";
import { useUiStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

/**
 * `true` sin conexión. El estado lo sincroniza `AppProviders` con
 * `navigator.onLine` + eventos `online`/`offline`.
 */
export function useIsOffline(): boolean {
  return useUiStore((state) => state.connectionStatus === "offline");
}

/** Pill ámbar "Sin conexión"; no renderiza nada con red. */
export function ConnectionStatusPill({ className }: { className?: string }) {
  const offline = useIsOffline();
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center", className)}>
      {offline ? (
        <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-amber-status/25 bg-amber-status/10 px-2.5 py-1 text-xs font-semibold text-amber-status">
          <WifiOff aria-hidden="true" className="size-3.5" strokeWidth={2} />
          Sin conexión
        </span>
      ) : null}
    </div>
  );
}
