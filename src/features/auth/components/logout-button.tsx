"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLogoutMutation } from "@/features/auth/client";

/** Cierra la sesión (BFF limpia cookies HttpOnly) y vuelve a `/login`. */
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
          // Incluso si falla la llamada, el estado local ya se limpió (onSettled).
          onSettled: () => {
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
