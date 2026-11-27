"use client";

import { CloudUpload, LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BFF_AUTH_ROUTES } from "@/features/auth/api";
import { useLogoutMutation } from "@/features/auth/client";
import { useOutboxSyncNow } from "@/features/pantry/components/outbox-banner";
import { useOutboxRecords } from "@/features/pantry/hooks";
import { countUnsyncedOutboxRecords } from "@/lib/offline/clear-user-data";

function changesLabel(count: number): string {
  return `${count} ${count === 1 ? "cambio" : "cambios"}`;
}

/**
 * Cierra la sesión (BFF revoca la sesión y limpia cookies HttpOnly) y vuelve a `/login`.
 * Si la outbox offline tiene cambios sin sincronizar, antes pide confirmación
 * en un `<dialog>` modal: "Sincronizar ahora", "Cancelar" o "Cerrar sesión
 * igualmente" (el logout borra la outbox de este dispositivo).
 *
 * @remarks
 * - Si el `POST` falla, el estado local ya se limpió pero las cookies
 *   `HttpOnly` seguirían vivas y `proxy.ts` devolvería al usuario a `/`. En ese
 *   caso se hace una navegación completa a `GET /api/bff/auth/logout`, que las
 *   borra y redirige a `/login`.
 * - El recuento se lee de IndexedDB al pulsar (no del `useLiveQuery`, que
 *   puede no haber cargado aún); el título usa el recuento en vivo.
 * - `<dialog>` nativo con `showModal()` (como `ConsumeDialog`): página inerte,
 *   contención de foco, `Esc` y devolución del foco al botón. Foco inicial en
 *   la acción segura ("Cancelar"); la destructiva va al final, donde no se
 *   desplaza bajo el puntero al aparecer el mensaje de sincronización (su
 *   espacio está reservado con `min-h`).
 * - "Sincronizar ahora" usa `aria-disabled` mientras sincroniza (no
 *   `disabled`): conserva el foco dentro del modal. Si tras sincronizar no
 *   queda nada, cierra sesión; si queda algo (sin red o conflictos), lo
 *   explica en una región `role="status"` del diálogo.
 *
 * @returns Botón secundario "Cerrar sesión" y su diálogo de confirmación.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `dialog` (confirmación destructiva, `autofocus` en la acción segura) y `custom-button-actions` (`aria-disabled`).
 */
export function LogoutButton() {
  const router = useRouter();
  const logout = useLogoutMutation();
  const syncNow = useOutboxSyncNow();
  const records = useOutboxRecords();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = `${uid}-description`;
  const [openCount, setOpenCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [checking, setChecking] = useState(false);

  const count = records.length > 0 ? records.length : openCount;

  const doLogout = () =>
    logout.mutate(undefined, {
      // El estado local ya se limpió en el hook (onSettled), haya error o no.
      onSettled: (_data, error) => {
        if (error) {
          window.location.assign(BFF_AUTH_ROUTES.logout);
          return;
        }
        router.replace("/login");
        router.refresh();
      },
    });

  const onLogoutClick = async () => {
    if (checking || logout.isPending) return;
    setChecking(true);
    const unsynced = await countUnsyncedOutboxRecords();
    setChecking(false);
    if (unsynced === 0) {
      doLogout();
      return;
    }
    setOpenCount(unsynced);
    setSyncMessage("");
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    // React no serializa `autofocus` en nodos creados en cliente.
    cancelRef.current?.focus();
  };

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage("");
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
    const remaining = await countUnsyncedOutboxRecords();
    const dialog = dialogRef.current;
    // El usuario pudo cancelar (Esc) mientras se sincronizaba.
    if (!dialog?.open) return;
    if (remaining === 0) {
      dialog.close();
      doLogout();
      return;
    }
    setOpenCount(remaining);
    setSyncMessage(
      typeof navigator !== "undefined" && navigator.onLine === false
        ? `Sin conexión: no se pudo sincronizar. Quedan ${changesLabel(remaining)} en este dispositivo.`
        : `Quedan ${changesLabel(remaining)} sin sincronizar (con conflicto o pendientes de reintento). Revísalos en el aviso de la despensa o cierra sesión igualmente.`,
    );
  };

  const onForceLogout = () => {
    dialogRef.current?.close();
    doLogout();
  };

  return (
    <>
      <Button
        variant="secondary"
        size="md"
        loading={logout.isPending}
        loadingText="Cerrando sesión…"
        aria-busy={checking || logout.isPending || undefined}
        onClick={() => void onLogoutClick()}
      >
        <LogOut aria-hidden="true" className="size-4" />
        Cerrar sesión
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => setSyncMessage("")}
        className="app-dialog m-auto w-[calc(100%-2rem)] max-w-[24.875rem] rounded-[4px] border border-border-sand bg-surface-lowest p-0 text-foreground shadow-ambient"
      >
        <div className="space-y-4 px-5 py-5">
          <div className="space-y-2">
            <p className="text-[0.6875rem] font-bold tracking-widest text-muted-foreground uppercase">
              Cerrar sesión
            </p>
            <h1 id={titleId} className="font-display text-2xl leading-8 font-medium tracking-tight">
              Tienes {changesLabel(count)} sin sincronizar
            </h1>
            <p id={descriptionId} className="text-sm text-muted-foreground">
              Si cierras sesión ahora, se borrarán de este dispositivo y no llegarán a tu despensa.
            </p>
          </div>

          <p role="status" className="min-h-10 text-[0.8125rem] font-semibold text-amber-status">
            {syncMessage}
          </p>

          <div className="flex flex-col gap-2">
            <Button
              size="md"
              fullWidth
              aria-disabled={syncing || undefined}
              aria-busy={syncing || undefined}
              className="aria-disabled:cursor-progress"
              onClick={() => void onSync()}
            >
              {syncing ? (
                <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
              ) : (
                <CloudUpload aria-hidden="true" className="size-4" />
              )}
              {syncing ? "Sincronizando…" : "Sincronizar ahora"}
            </Button>
            <Button ref={cancelRef} variant="secondary" size="md" fullWidth onClick={() => dialogRef.current?.close()}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              size="md"
              fullWidth
              className="border-terracotta text-terracotta-strong hover:bg-terracotta/8"
              onClick={onForceLogout}
            >
              <LogOut aria-hidden="true" className="size-4" />
              Cerrar sesión igualmente
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
