import type { ReactNode } from "react";

/**
 * Contenedor de las pantallas de autenticación (RSC). Mobile-first: columna
 * de ~430px que ocupa todo el alto en móvil y se centra en tablet/escritorio.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center bg-background">
      <div className="flex min-h-dvh w-full max-w-[430px] flex-col px-5 sm:border-x sm:border-border-sand/60 md:max-w-md md:px-8">
        {children}
      </div>
    </div>
  );
}
