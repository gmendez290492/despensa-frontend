"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BFF_AUTH_ROUTES } from "@/features/auth/api";
import { useLogoutMutation } from "@/features/auth/client";

/**
 * Cierra la sesión (BFF revoca la sesión y limpia cookies HttpOnly) y vuelve a `/login`.
 *
 * @remarks Si el `POST` falla, el estado local ya se limpió pero las cookies
 * `HttpOnly` seguirían vivas y `proxy.ts` devolvería al usuario a `/`. En ese
 * caso se hace una navegación completa a `GET /api/bff/auth/logout`, que las
 * borra y redirige a `/login`.
 *
 * @returns Botón secundario "Cerrar sesión".
 */
export function LogoutButton() {
  const router = useRouter();
  const logout = useLogoutMutation();

  return (
    <Button
      variant="secondary"
      size="md"
      loading={logout.isPending}
      loadingText="Cerrando sesión…"
      onClick={() =>
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
        })
      }
    >
      <LogOut aria-hidden="true" className="size-4" />
      Cerrar sesión
    </Button>
  );
}
