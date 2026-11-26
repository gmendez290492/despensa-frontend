import { cn } from "@/lib/utils";

/** Nivel de fortaleza: `0` vacía, `1` débil … `4` fuerte. */
export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

const LABELS: Record<Exclude<PasswordStrength, 0>, string> = {
  1: "Débil",
  2: "Aceptable",
  3: "Buena",
  4: "Fuerte",
};

const ACTIVE_SEGMENT: Record<Exclude<PasswordStrength, 0>, string> = {
  1: "bg-terracotta",
  2: "bg-semaforo-precaucion",
  3: "bg-primary-container",
  4: "bg-primary-container",
};

/**
 * Heurística local (no sustituye la validación del backend): 0 = vacía,
 * 1 = débil (< 8 caracteres), 2-4 según longitud y variedad de caracteres.
 *
 * @param password - Contraseña en claro (no se almacena ni se registra).
 * @returns Nivel {@link PasswordStrength}.
 */
export function scorePassword(password: string): PasswordStrength {
  if (password.length === 0) return 0;
  if (password.length < 8) return 1;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = 2;
  if (variety >= 3) score += 1;
  if (password.length >= 12 && variety >= 2) score += 1;
  return Math.min(score, 4) as PasswordStrength;
}

/** Props de {@link PasswordStrengthMeter}. */
export interface PasswordStrengthMeterProps {
  /** Id del texto de nivel; añádelo a `aria-describedby` del input de contraseña. */
  id: string;
  /** Valor actual de la contraseña a evaluar. */
  password: string;
  /** Clases extra del contenedor. */
  className?: string;
}

/**
 * Medidor de 4 segmentos con texto ("Débil"…"Fuerte"): nunca solo color.
 *
 * @remarks Los segmentos son `aria-hidden`; el nivel se expone como texto en
 * una región `aria-live="polite"` que solo cambia al cruzar un umbral (no en
 * cada pulsación), así no satura al lector de pantalla mientras se escribe.
 *
 * @param props - {@link PasswordStrengthMeterProps}.
 * @returns Barra de segmentos + texto "Seguridad: …".
 *
 * @example
 * ```tsx
 * <PasswordField id="pwd" label="Contraseña" describedByIds={["pwd-strength"]} {...register("password")}>
 *   <PasswordStrengthMeter id="pwd-strength" password={password} />
 * </PasswordField>
 * ```
 */
export function PasswordStrengthMeter({ id, password, className }: PasswordStrengthMeterProps) {
  const score = scorePassword(password);
  const label = score === 0 ? null : LABELS[score];

  return (
    <div className={cn("pt-1", className)}>
      <div aria-hidden="true" className="mb-1.5 grid h-1.5 grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={cn(
              "rounded-[1px]",
              score !== 0 && segment <= score ? ACTIVE_SEGMENT[score] : "bg-surface-high",
            )}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Mínimo 8 caracteres</span>
        <span id={id} aria-live="polite" className="font-semibold text-primary-container">
          {label ? `Seguridad: ${label}` : ""}
        </span>
      </div>
    </div>
  );
}
