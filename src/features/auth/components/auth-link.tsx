"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { withNext } from "@/features/auth/form-errors";

/**
 * Link entre pantallas de auth que preserva `?next=` (saneado). Usa
 * `useSearchParams`: envolver en `<Suspense>` (ver `AuthLink` en el padre).
 */
export function PreserveNextLink({
  href,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const searchParams = useSearchParams();
  return <Link href={withNext(href, searchParams.get("next"))} {...props} />;
}
