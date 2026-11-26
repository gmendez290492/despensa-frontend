import type { ConnectionStatus } from "@/stores/ui-store";

interface ConnectionEnvironment {
  navigator: Pick<Navigator, "onLine">;
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

/**
 * Sincroniza el estado de red con `navigator.onLine` + eventos
 * `online`/`offline`. Solo debe llamarse tras el montaje (en `useEffect`):
 * el servidor y el primer render cliente usan siempre `"online"` (valor
 * inicial del store, no persistido) para evitar errores de hidratación.
 *
 * No pisa `"syncing"` con `"online"` (la outbox gestiona ese estado); sí lo
 * pasa a `"offline"` si se pierde la red.
 *
 * @returns función de limpieza que elimina los listeners.
 */
export function subscribeToConnectionStatus(
  getStatus: () => ConnectionStatus,
  setStatus: (status: ConnectionStatus) => void,
  env: ConnectionEnvironment = { navigator, target: window },
): () => void {
  const sync = () => {
    const next: ConnectionStatus = env.navigator.onLine ? "online" : "offline";
    const current = getStatus();
    if (current === next || (current === "syncing" && next === "online")) return;
    setStatus(next);
  };

  sync();
  env.target.addEventListener("online", sync);
  env.target.addEventListener("offline", sync);
  return () => {
    env.target.removeEventListener("online", sync);
    env.target.removeEventListener("offline", sync);
  };
}
