import { CircleAlert } from "lucide-react";
import { Label as LabelPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Etiqueta visible (`<label>` de Radix) con la tipografía del sistema.
 *
 * @param props - Props de `Label.Root` de Radix; usa `htmlFor` con el `id` del control.
 * @returns Un `<label>` asociado al control.
 *
 * @example
 * ```tsx
 * <Label htmlFor="alert-days">Avisarme antes de caducar</Label>
 * <input id="alert-days" type="range" />
 * ```
 */
export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("block text-[13px] font-semibold text-foreground", className)}
      {...props}
    />
  );
}

/**
 * Clases base de los controles de texto (borde, foco, estado inválido).
 * Reutilízalas en controles nativos que no pasan por {@link Input}, como `<select>`.
 *
 * @remarks El estilo de error usa el variant `aria-invalid:` de Tailwind, que
 * solo coincide con `aria-invalid="true"`; por eso los campos pueden fijar
 * `aria-invalid="false"` sin cambiar su aspecto.
 *
 * @example
 * ```tsx
 * <select className={cn(inputBaseClass, "appearance-auto")}>…</select>
 * ```
 */
export const inputBaseClass = cn(
  "h-12 w-full rounded-[4px] border border-input-border bg-surface/70 px-3.5 font-sans text-[15px] text-foreground",
  "placeholder:text-input-placeholder transition-colors",
  "focus:bg-surface-lowest focus:border-primary-container focus:outline-none focus:ring-2 focus:ring-primary-container/20",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-invalid:border-terracotta aria-invalid:focus:ring-terracotta/25",
);

/** Props de {@link Input}: las del `<input>` nativo (incluye `ref` en React 19). */
export type InputProps = ComponentProps<"input">;

/**
 * `<input>` nativo con {@link inputBaseClass}. Úsalo directamente solo cuando
 * gestiones tú la etiqueta y los ids; en formularios prefiere {@link TextField}.
 *
 * @param props - {@link InputProps}.
 * @returns Un `<input>` estilizado.
 *
 * @example
 * ```tsx
 * <Input id="q" type="search" enterKeyHint="search" aria-label="Buscar productos" />
 * ```
 */
export function Input({ className, ...props }: InputProps) {
  return <input className={cn(inputBaseClass, className)} {...props} />;
}

/**
 * Texto de ayuda persistente de un campo. Dale el id de `fieldIds(id).hint`
 * para enlazarlo con `aria-describedby`.
 *
 * @param props - Props de `<p>`.
 * @returns Un `<p>` atenuado.
 *
 * @example
 * ```tsx
 * <FieldHint id={fieldIds("name").hint}>Entre 2 y 120 caracteres</FieldHint>
 * ```
 */
export function FieldHint({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...props} />;
}

/**
 * Mensaje de error de un campo con ícono (no solo color). No renderiza nada
 * si no hay `children`, de modo que el id solo existe mientras hay error.
 *
 * @remarks No es una región viva: el error se anuncia porque, tras un envío
 * fallido, React Hook Form mueve el foco al primer campo inválido y el
 * lector lee su `aria-describedby`.
 *
 * @param props - Props de `<div>`; `children` es el mensaje.
 * @returns El bloque de error o `null`.
 *
 * @example
 * ```tsx
 * <FieldError id={fieldIds("email").error}>{errors.email?.message}</FieldError>
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `required-field-feedback`.
 */
export function FieldError({ className, children, ...props }: ComponentProps<"div">) {
  if (!children) return null;
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded-[4px] border border-terracotta/25 bg-terracotta/8 p-2 text-xs leading-snug text-terracotta-strong",
        className,
      )}
      {...props}
    >
      <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" strokeWidth={2.2} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Ids derivados para enlazar `aria-describedby` de forma consistente.
 *
 * @param id - Id del control.
 * @returns `{ hint: "<id>-hint", error: "<id>-error" }`.
 *
 * @example
 * ```ts
 * fieldIds("login-email"); // { hint: "login-email-hint", error: "login-email-error" }
 * ```
 */
export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

/**
 * Compone el valor de `aria-describedby` ignorando ids vacíos, para enlazar
 * pistas y errores solo cuando existen.
 *
 * @param ids - Ids candidatos; los valores falsy se descartan.
 * @returns Los ids separados por espacios, o `undefined` si no queda ninguno
 *   (así React omite el atributo).
 *
 * @example
 * ```ts
 * describedBy("pwd-hint", error && "pwd-error"); // "pwd-hint" sin error
 * ```
 */
export function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const value = ids.filter(Boolean).join(" ");
  return value.length > 0 ? value : undefined;
}

/** Props de {@link TextField}; el resto se reenvía al `<input>`. */
export interface TextFieldProps extends Omit<InputProps, "id"> {
  /** Id estable del input (autofill y ids derivados de pista/error). */
  id: string;
  /** Etiqueta visible enlazada con `htmlFor`. */
  label: ReactNode;
  /** Acción a la derecha de la etiqueta (p. ej. "¿Olvidaste tu contraseña?"). */
  labelAction?: ReactNode;
  /** Pista persistente bajo el campo. */
  hint?: ReactNode;
  /** Mensaje de error; activa `aria-invalid="true"`. */
  error?: ReactNode;
  /** Ícono decorativo a la izquierda (`aria-hidden`). */
  leadingIcon?: ReactNode;
  /** Clases extra para la etiqueta. */
  labelClassName?: string;
}

/**
 * Campo de texto accesible: etiqueta visible, pista y error enlazados con
 * `aria-describedby`, `aria-invalid` cuando hay error. Compatible con
 * `register()` de React Hook Form (React 19: `ref` como prop).
 *
 * @remarks
 * - `aria-invalid` es `"false"` (no ausente) mientras no hay error, para que
 *   un campo `required` vacío no se anuncie como inválido antes de tocarlo.
 * - Pasa los atributos nativos de la guía: `type`, `autoComplete`,
 *   `inputMode`, `enterKeyHint`, `required` y `maxLength` alineados con el
 *   esquema Zod. Con `noValidate` en el `<form>`, Zod sigue siendo la fuente
 *   de los mensajes; `required` aporta la semántica para lectores de pantalla.
 *
 * @param props - {@link TextFieldProps}.
 * @returns Grupo etiqueta + input + pista/error.
 *
 * @example
 * ```tsx
 * <TextField
 *   id="login-email"
 *   label="Correo electrónico"
 *   type="email"
 *   autoComplete="username"
 *   enterKeyHint="next"
 *   required
 *   error={errors.email?.message}
 *   {...register("email")}
 * />
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `forms` y `required-field-feedback`.
 */
export function TextField({
  id,
  label,
  labelAction,
  hint,
  error,
  leadingIcon,
  labelClassName,
  className,
  ...inputProps
}: TextFieldProps) {
  const ids = fieldIds(id);
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <Label htmlFor={id} className={labelClassName}>
          {label}
        </Label>
        {labelAction}
      </div>
      <div className="relative flex items-center">
        {leadingIcon ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 flex items-center text-outline"
          >
            {leadingIcon}
          </span>
        ) : null}
        <Input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(hint ? ids.hint : null, error ? ids.error : null)}
          className={cn(leadingIcon && "pl-10", className)}
          {...inputProps}
        />
      </div>
      {hint ? <FieldHint id={ids.hint}>{hint}</FieldHint> : null}
      <FieldError id={ids.error}>{error}</FieldError>
    </div>
  );
}
