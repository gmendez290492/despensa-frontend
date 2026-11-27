import { cn } from "@/lib/utils";

/** Icono de frasco botánico (marca Despensa). Decorativo. */
export function JarIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M9 3h6" />
      <path d="M10 3v3h4V3" />
      <rect x="5" y="6" width="14" height="15" rx="3" />
      <path d="M12 11c-1.5 1-2 2.5-2 4 1.5 0 3-.5 4-2" />
      <path d="M10 17c1-1.5 2.5-2 4-2" />
    </svg>
  );
}

/** Logotipo completo: frasco + "Despensa" + subtítulo. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="flex size-8 items-center justify-center rounded-[4px] bg-primary-container text-primary-foreground">
        <JarIcon className="size-4" />
      </div>
      <div className="flex flex-col">
        <span className="font-display text-xl leading-none font-medium tracking-tight text-primary-container">
          Despensa
        </span>
        <span className="mt-0.5 text-[0.625rem] font-semibold tracking-widest text-muted-foreground uppercase">
          Pantry &amp; Provisions
        </span>
      </div>
    </div>
  );
}
