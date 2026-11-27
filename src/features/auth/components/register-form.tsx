"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";
import { describedBy, Label, TextField } from "@/components/ui/text-field";
import { useIsOffline } from "@/components/connection-status-pill";
import { blockSubmitWhileOffline } from "@/features/auth/offline-submit";
import { TimeZoneField, useDetectedTimeZone } from "@/features/auth/components/timezone-field";
import { mapAuthError, withNext, type AuthBanner } from "@/features/auth/form-errors";
import { useRegisterMutation } from "@/features/auth/client";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ALERT_DAYS_BEFORE,
  registerSchema,
  type RegisterFormInput,
  type RegisterFormValues,
} from "@/lib/auth/schemas";

const REGISTER_FIELDS = [
  "full_name",
  "email",
  "password",
  "confirm_password",
  "timezone",
  "alert_days_before",
] as const;

const OFFLINE_HINT_ID = "register-offline-hint";
const STRENGTH_ID = "register-password-strength";
const ALERT_HELP_ID = "register-alert-help";
const ALERT_MIN = 1;
const ALERT_MAX = 30;

function daysLabel(days: number): string {
  return days === 1 ? "1 día" : `${days} días`;
}

function FormSection({
  title,
  caption,
  children,
  className,
}: {
  title: string;
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={cn("min-w-0 space-y-4 p-4", className)}>
      <legend className="sr-only">{title}</legend>
      <div aria-hidden="true" className="flex items-center justify-between border-b border-border-sand pb-1">
        <span className="text-[0.6875rem] font-bold tracking-[0.15em] text-primary-container uppercase">
          {title}
        </span>
        {caption ? <span className="text-[0.6875rem] text-muted-foreground">{caption}</span> : null}
      </div>
      {children}
    </fieldset>
  );
}

/**
 * Formulario de registro (Stitch "Crear Cuenta"). Lee `?next=`: envolver en
 * `<Suspense>`.
 *
 * @remarks
 * - Correo con `autoComplete="username"` y contraseñas con `"new-password"`
 *   para que el navegador sugiera una contraseña fuerte; nombre en un solo
 *   campo con `autoComplete="name"`.
 * - `required`/`minLength`/`maxLength` replican el esquema Zod (semántica para
 *   lectores de pantalla); los mensajes los sigue dando Zod (`noValidate`).
 * - El slider usa `<input type="range">` nativo con `aria-valuetext`.
 * - Sin conexión el botón queda `aria-disabled` (enfocable, lee la pista
 *   `aria-describedby`) y `blockSubmitWhileOffline` bloquea el envío.
 * - Pendiente de decisión de producto: la guía desaconseja pedir la
 *   contraseña dos veces; se mantiene `confirm_password` por el diseño Stitch.
 *
 * @returns El formulario de registro.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `autofill-sign-up-form`, `slider` y `custom-button-actions`.
 */
export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");

  const offline = useIsOffline();
  const registerMutation = useRegisterMutation();
  const [banner, setBanner] = useState<AuthBanner | null>(null);
  const [timezoneManual, setTimezoneManual] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<RegisterFormInput, unknown, RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: "",
      email: "",
      password: "",
      confirm_password: "",
      // Se rellena en cliente tras montar (evita mismatch de hidratación).
      timezone: "",
      alert_days_before: DEFAULT_ALERT_DAYS_BEFORE,
    },
  });

  const detectedTimeZone = useDetectedTimeZone();
  useEffect(() => {
    if (detectedTimeZone && !getValues("timezone")) {
      setValue("timezone", detectedTimeZone, { shouldDirty: false });
    }
  }, [detectedTimeZone, getValues, setValue]);

  const password = useWatch({ control, name: "password" }) ?? "";
  const alertDaysRaw = useWatch({ control, name: "alert_days_before" });
  const alertDays = Number.isFinite(alertDaysRaw) ? Number(alertDaysRaw) : DEFAULT_ALERT_DAYS_BEFORE;
  const alertProgress = ((alertDays - ALERT_MIN) / (ALERT_MAX - ALERT_MIN)) * 100;

  const onSubmit = handleSubmit((values) => {
    if (offline) return;
    setBanner(null);
    registerMutation.mutate(values, {
      onSuccess: ({ authenticated }) => {
        if (!authenticated) {
          // Cuenta creada pero el login automático falló: que inicie sesión.
          const loginUrl = withNext("/login", next);
          router.replace(`${loginUrl}${loginUrl.includes("?") ? "&" : "?"}registered=1`);
          return;
        }
        router.replace(safeRedirectPath(next));
        router.refresh();
      },
      onError: (error) => {
        const mapped = mapAuthError(error, REGISTER_FIELDS);
        setBanner(mapped.banner);
        mapped.fieldErrors.forEach((fieldError, index) =>
          setError(
            fieldError.name,
            { type: fieldError.type, message: fieldError.message },
            { shouldFocus: index === 0 },
          ),
        );
      },
    });
  });

  const submitting = registerMutation.isPending || registerMutation.isSuccess;
  const emailError =
    errors.email?.type === "conflict" ? (
      <>
        {errors.email.message}{" "}
        <Link
          href={withNext("/login", next)}
          className="font-semibold underline underline-offset-2 hover:text-foreground"
        >
          ¿Quieres iniciar sesión?
        </Link>
      </>
    ) : (
      errors.email?.message
    );

  return (
    <form onSubmit={blockSubmitWhileOffline(offline, onSubmit)} noValidate aria-label="Crear cuenta">
      {banner ? (
        <Alert
          className="mb-4"
          footnote={banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined}
        >
          {banner.message}
        </Alert>
      ) : null}

      <div className="overflow-hidden rounded-[4px] border border-border-sand bg-surface-lowest shadow-ambient">
        <FormSection title="Tus datos">
          <TextField
            id="register-full-name"
            label="Nombre completo"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            required
            maxLength={120}
            placeholder="Ana García"
            hint="Entre 2 y 120 caracteres"
            className="h-11"
            error={errors.full_name?.message}
            {...register("full_name")}
          />
          <TextField
            id="register-email"
            label="Correo electrónico"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            required
            maxLength={254}
            placeholder="tu@correo.com"
            className="h-11"
            error={emailError}
            {...register("email")}
          />
        </FormSection>

        <div aria-hidden="true" className="h-px w-full bg-border-sand" />

        <FormSection title="Seguridad">
          <PasswordField
            id="register-password"
            label="Contraseña"
            autoComplete="new-password"
            enterKeyHint="next"
            required
            minLength={8}
            maxLength={128}
            className="h-11"
            describedByIds={[STRENGTH_ID]}
            error={errors.password?.message}
            {...register("password")}
          >
            <PasswordStrengthMeter id={STRENGTH_ID} password={password} />
          </PasswordField>
          <PasswordField
            id="register-confirm-password"
            label="Confirmar contraseña"
            autoComplete="new-password"
            enterKeyHint="next"
            required
            maxLength={128}
            placeholder="Repite tu contraseña"
            className="h-11"
            error={errors.confirm_password?.message}
            {...register("confirm_password")}
          />
        </FormSection>

        <div aria-hidden="true" className="h-px w-full bg-border-sand" />

        <FormSection title="Preferencias de alerta" caption="Avisos Zero-Waste" className="bg-surface/40">
          <Controller
            control={control}
            name="timezone"
            render={({ field, fieldState }) => (
              <TimeZoneField
                ref={field.ref}
                id="register-timezone"
                value={field.value ?? ""}
                onChange={(zone) => {
                  setTimezoneManual(true);
                  field.onChange(zone);
                }}
                autoDetected={!timezoneManual}
                error={fieldState.error?.message}
              />
            )}
          />

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="register-alert-days">Avisarme antes de caducar</Label>
              <span
                aria-hidden="true"
                className="inline-flex items-center rounded-full border border-primary-container/20 bg-primary-fixed/50 px-2.5 py-0.5 text-xs font-bold text-primary-container"
              >
                {daysLabel(alertDays)}
              </span>
            </div>
            <input
              id="register-alert-days"
              type="range"
              min={ALERT_MIN}
              max={ALERT_MAX}
              step={1}
              aria-valuetext={daysLabel(alertDays)}
              aria-invalid={Boolean(errors.alert_days_before)}
              aria-describedby={describedBy(
                ALERT_HELP_ID,
                errors.alert_days_before && "register-alert-days-error",
              )}
              className="range-input"
              style={{ "--range-progress": `${alertProgress}%` } as CSSProperties}
              {...register("alert_days_before", { valueAsNumber: true })}
            />
            <div
              aria-hidden="true"
              className="flex items-center justify-between px-0.5 text-[0.6875rem] text-muted-foreground"
            >
              <span>1 día (mínimo)</span>
              <span>15 días</span>
              <span>30 días</span>
            </div>
            <p id={ALERT_HELP_ID} className="pt-1 text-xs leading-tight text-muted-foreground">
              Recibirás alertas por correo con esta anticipación.
            </p>
            {errors.alert_days_before ? (
              <p id="register-alert-days-error" className="text-xs text-terracotta-strong">
                {errors.alert_days_before.message}
              </p>
            ) : null}
          </div>
        </FormSection>
      </div>

      <div className="mt-5 space-y-2">
        <Button
          type="submit"
          fullWidth
          loading={submitting}
          loadingText="Creando cuenta…"
          aria-disabled={offline || undefined}
          aria-describedby={offline ? OFFLINE_HINT_ID : undefined}
        >
          <span>Crear cuenta</span>
          <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
        </Button>
        {offline ? (
          <p id={OFFLINE_HINT_ID} className="text-center text-xs font-medium text-amber-status">
            Necesitas conexión para crear tu cuenta.
          </p>
        ) : null}
      </div>

      <p className="mt-3 text-center text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link
          href={withNext("/login", next)}
          className="inline-flex min-h-11 items-center font-semibold text-primary-container underline underline-offset-4 hover:text-foreground focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          Inicia sesión
        </Link>
      </p>
    </form>
  );
}
