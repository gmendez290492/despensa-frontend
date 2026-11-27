import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryView } from "@/features/pantry/components/inventory-view";
import { PantrySkeleton } from "@/features/pantry/components/pantry-states";

/** Metadatos del inventario. */
export const metadata: Metadata = { title: "Despensa" };

/**
 * Inventario del hogar (Stitch "Pantry Inventory"). RSC con el titular
 * estático; la vista filtrable (`nuqs` + TanStack Query) va en `<Suspense>`
 * por `cacheComponents`.
 *
 * @returns La página `/despensa`.
 */
export default function InventoryPage() {
  return (
    <main className="flex flex-1 flex-col gap-4">
      <header className="pt-2">
        <h1 className="font-display text-[1.75rem] leading-9 font-medium tracking-tight text-primary">
          Despensa y almacenamiento
        </h1>
      </header>
      <Suspense fallback={<PantrySkeleton label="Cargando inventario" cards={4} />}>
        <InventoryView />
      </Suspense>
    </main>
  );
}
