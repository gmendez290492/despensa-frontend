import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertTone = "error" | "info" | "success";

const toneStyles: Record<AlertTone, string> = {
  error: "border-terracotta/25 bg-terracotta/8 text-terracotta-strong",
  info: "border-primary-container/20 bg-primary-fixed/40 text-primary",
  success: "border-semaforo-optimo/25 bg-semaforo-optimo/8 text-primary",
};

const toneIcons = {
  error: CircleAlert,
  info: Info,
  success: CircleCheck,
} satisfies Record<AlertTone, unknown>;

/** Props de {@link Alert}; acepta además cualquier atributo de `<div>` salvo `title`. */
export interface AlertProps extends Omit<ComponentProps<"div">, "title"> {
  /** Tono semántico; decide color, ícono y rol ARIA. Por defecto `"error"`. */
  tone?: AlertTone;
  /** Encabezado opcional en negrita sobre el mensaje. */
  title?: ReactNode;
  /** Pie discreto (p. ej. ID de correlación para soporte). */
  footnote?: ReactNode;
}

/**
 * Banner de estado con ícono + texto (el estado nunca depende solo del color).
 *
 * @remarks `error` usa `role="alert"` (anunciado de inmediato, interrumpe);
 * `info`/`success` usan `role="status"` (anuncio cortés). Renderízalo solo
 * cuando haya mensaje: una región viva que aparece ya montada con su texto
 * no siempre se anuncia, por eso el contenido debe cambiar tras montarse o
 * el foco debe moverse al campo con error.
 *
 * @param props - {@link AlertProps}.
 * @returns El banner como `<div>` con el rol ARIA correspondiente.
 *
 * @example
 * ```tsx
 * <Alert footnote={`Código de soporte: ${correlationId}`}>
 *   No pudimos iniciar sesión. Inténtalo de nuevo.
 * </Alert>
 * <Alert tone="success">Tu cuenta fue creada.</Alert>
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `accessible-error-announcement`.
 */
export function Alert({
  tone = "error",
  title,
  footnote,
  className,
  children,
  ...props
}: AlertProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-[4px] border p-3.5 text-[13px] leading-snug",
        toneStyles[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.2} />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="font-medium">{children}</div> : null}
        {footnote ? (
          <p className="text-[11px] font-normal break-all opacity-90">{footnote}</p>
        ) : null}
      </div>
    </div>
  );
}
