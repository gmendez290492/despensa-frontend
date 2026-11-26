import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("motion-safe:animate-pulse rounded-[4px] bg-surface-high", className)} />;
}

/** Placeholder con la geometría de la tarjeta de formulario (Suspense). */
export function AuthFormSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div role="status" aria-label="Cargando formulario">
      <div className="rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient">
        <div className="space-y-5">
          {Array.from({ length: fields }, (_, index) => (
            <div key={index} className="space-y-2">
              <Bar className="h-3.5 w-32" />
              <Bar className="h-12 w-full" />
            </div>
          ))}
          <Bar className="h-12 w-full bg-primary-container/30" />
        </div>
      </div>
      <Bar className="mx-auto mt-6 h-4 w-52" />
    </div>
  );
}
