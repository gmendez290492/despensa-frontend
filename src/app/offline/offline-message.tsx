"use client";

import { useSearchParams } from "next/navigation";
import { OFFLINE_REASON_PARAM, OFFLINE_REASON_RATE_LIMIT } from "@/lib/auth/constants";
import { OfflineCopy } from "./offline-copy";

/**
 * Hoja cliente de `/offline` que elige el texto según `?motivo=`. Con
 * `motivo=limite` (refresh con `429`) explica que hay que esperar; con
 * cualquier otro valor, o sin él, muestra el texto de "Sin conexión".
 *
 * @remarks
 * Lee `searchParams` aquí y no en el Server Component para que `/offline`
 * siga siendo estática y Serwist pueda precachearla: con `cacheComponents`,
 * leerlos en la página la volvería dinámica. Usa `useSearchParams`, así que
 * debe ir dentro de `<Suspense>` con `<OfflineCopy reason="red" />` como
 * fallback, que es lo que queda en el HTML prerenderizado.
 *
 * @returns {@link OfflineCopy} con la variante que corresponde a la URL.
 */
export function OfflineMessage() {
  const searchParams = useSearchParams();
  const reason =
    searchParams.get(OFFLINE_REASON_PARAM) === OFFLINE_REASON_RATE_LIMIT ? "limite" : "red";
  return <OfflineCopy reason={reason} />;
}
