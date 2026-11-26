"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  describedBy,
  FieldError,
  FieldHint,
  fieldIds,
  Input,
  Label,
  type InputProps,
} from "@/components/ui/text-field";
import { cn } from "@/lib/utils";

/** Props de {@link PasswordField}; el resto se reenvía al `<input>`. */
export interface PasswordFieldProps extends Omit<InputProps, "id" | "type"> {
  /** Id estable del input (necesario para autofill y para derivar ids de pista/error). */
  id: string;
  /** Etiqueta visible enlazada con `htmlFor`. */
  label: ReactNode;
  /** Acción a la derecha de la etiqueta (p. ej. enlace "¿Olvidaste tu contraseña?"). */
  labelAction?: ReactNode;
  /** Pista persistente bajo el campo. */
  hint?: ReactNode;
  /** Mensaje de error; activa `aria-invalid="true"` y se enlaza por `aria-describedby`. */
  error?: ReactNode;
  /** Ícono decorativo a la izquierda (se oculta a lectores de pantalla). */
  leadingIcon?: ReactNode;
  /** Clases extra para la etiqueta. */
  labelClassName?: string;
  /** Ids adicionales para `aria-describedby` (p. ej. medidor de fortaleza). */
  describedByIds?: string[];
  /** Contenido bajo el campo (p. ej. `PasswordStrengthMeter`). */
  children?: ReactNode;
}

/**
 * Campo de contraseña con botón mostrar/ocultar (44x44, `aria-pressed`).
 * El valor nunca sale del input: no se guarda en estado propio.
 *
 * @remarks
 * - Pasa siempre `autoComplete="current-password"` (login) o
 *   `"new-password"` (registro) para que el gestor de contraseñas sugiera o
 *   rellene la correcta. Nunca bloquees el pegado.
 * - `aria-invalid` vale `"false"` mientras no hay error (no se omite):
 *   Firefox y Safari exponen como inválido un campo `required` vacío desde la
 *   carga si el atributo falta.
 * - El error solo entra en `aria-describedby` mientras existe, para que no se
 *   lea antes de interactuar.
 *
 * @param props - {@link PasswordFieldProps}.
 * @returns Grupo etiqueta + input + toggle + pista/error.
 *
 * @example
 * ```tsx
 * <PasswordField
 *   id="login-password"
 *   label="Contraseña"
 *   autoComplete="current-password"
 *   required
 *   error={errors.password?.message}
 *   {...register("password")}
 * />
 * ```
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `autofill-sign-in-form` y `accessible-error-announcement`.
 */
export function PasswordField({
  id,
  label,
  labelAction,
  hint,
  error,
  leadingIcon,
  labelClassName,
  describedByIds = [],
  children,
  className,
  ...inputProps
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
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
          type={visible ? "text" : "password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy(hint ? ids.hint : null, error ? ids.error : null, ...describedByIds)}
          className={cn("pr-12", leadingIcon && "pl-10", className)}
          {...inputProps}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label="Mostrar contraseña"
          aria-pressed={visible}
          aria-controls={id}
          className={cn(
            "absolute inset-y-0 right-0 my-auto flex size-11 items-center justify-center rounded-[4px] text-muted-foreground",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-container",
          )}
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4" strokeWidth={1.8} />
          ) : (
            <Eye aria-hidden="true" className="size-4" strokeWidth={1.8} />
          )}
        </button>
      </div>
      {children}
      {hint ? <FieldHint id={ids.hint}>{hint}</FieldHint> : null}
      <FieldError id={ids.error}>{error}</FieldError>
    </div>
  );
}
