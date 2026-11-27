import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Variantes `cva` del botón del sistema Stitch (`variant`, `size`, `fullWidth`).
 * Exportadas para dar aspecto de botón a otros elementos (p. ej. un `<Link>`).
 *
 * @example
 * ```tsx
 * <Link href="/login" className={buttonVariants({ variant: "secondary", size: "md" })}>
 *   Volver
 * </Link>
 * ```
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-[4px] font-sans font-semibold",
    "transition-colors select-none",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    "aria-busy:cursor-progress",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary-container text-primary-foreground shadow-sm hover:bg-primary active:bg-primary",
        secondary:
          "border border-outline-variant bg-surface-lowest text-primary-container hover:bg-surface-low",
        tertiary:
          "bg-transparent text-primary-container underline-offset-4 hover:underline",
      },
      size: {
        md: "min-h-11 px-4 text-sm",
        lg: "min-h-12 px-5 text-[0.9375rem] tracking-wide",
        icon: "size-11",
      },
      fullWidth: {
        true: "w-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "lg",
    },
  },
);

/** Props de {@link Button}: atributos nativos de `<button>` + variantes de {@link buttonVariants}. */
export interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  /** Muestra un spinner, marca `aria-busy` y deshabilita el botón. */
  loading?: boolean;
  /** Texto alternativo mientras `loading` es `true`. */
  loadingText?: string;
}

/**
 * Botón accesible del sistema de diseño (objetivo táctil ≥ 44 px).
 *
 * @remarks
 * - `type` es `"button"` por defecto para no enviar formularios por accidente;
 *   pasa `type="submit"` explícitamente en el botón principal.
 * - Con `loading` se deshabilita tras un envío válido (evita dobles envíos)
 *   sin deshabilitarlo para bloquear la validación.
 * - El spinner solo gira con `prefers-reduced-motion: no-preference`
 *   (`motion-safe:`); el texto `loadingText` comunica el estado en todo caso.
 * - `aria-disabled="true"` se ve igual que `disabled` pero no bloquea nada:
 *   úsalo cuando el botón deba seguir enfocable para anunciar su
 *   `aria-describedby`, y bloquea la acción en el handler.
 * - Tamaños de texto en `rem` para respetar la escala de texto del sistema.
 *
 * @param props - {@link ButtonProps}.
 * @returns Un `<button>` estilizado.
 *
 * @example
 * ```tsx
 * <Button type="submit" fullWidth loading={isPending} loadingText="Guardando…">
 *   Guardar cambios
 * </Button>
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `forms`, `motion`, `custom-button-actions` y `respect-os-text-scale`.
 */
export function Button({
  className,
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size, fullWidth }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
