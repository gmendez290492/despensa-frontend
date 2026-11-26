"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { TextField } from "@/components/ui/text-field";
import { useIsOffline } from "@/components/connection-status-pill";
import { mapAuthError, withNext, type AuthBanner } from "@/features/auth/form-errors";
import { useLoginMutation } from "@/features/auth/client";
import { FORGOT_PASSWORD_PATH } from "@/lib/auth/constants";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { loginSchema, type LoginFormValues, type LoginInput } from "@/lib/auth/schemas";

const LOGIN_FIELDS = ["email", "password"] as const;
const OFFLINE_HINT_ID = "login-offline-hint";
const labelClass = "text-[12.5px] tracking-wider uppercase";

/**
 * Formulario de inicio de sesión (Stitch "Inicio de Sesión"). Lee `?next=` y
 * `?registered=1` / `?reset=1`: envolver en `<Suspense>`.
 *
 * @remarks
 * - El correo usa `autoComplete="username"` (lo reconocen los gestores de
 *   contraseñas aunque sea `type="email"`) y la contraseña
 *   `"current-password"`; ambos `required` con `enterKeyHint`.
 * - Validación con Zod al enviar (`noValidate`); React Hook Form enfoca el
 *   primer campo inválido para que el lector anuncie su error.
 * - Sin conexión el envío se bloquea y se explica con texto visible.
 *
 * @returns Tarjeta con el formulario y enlace a registro.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `autofill-sign-in-form`.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const justRegistered = searchParams.get("registered") === "1";
  const justReset = searchParams.get("reset") === "1";

  const offline = useIsOffline();
  const login = useLoginMutation();
  const [banner, setBanner] = useState<AuthBanner | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormValues, unknown, LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit((values) => {
    if (offline) return;
    setBanner(null);
    login.mutate(values, {
      onSuccess: () => {
        router.replace(safeRedirectPath(next));
        router.refresh();
      },
      onError: (error) => {
        const mapped = mapAuthError(error, LOGIN_FIELDS);
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

  // Tras el éxito se mantiene el estado de carga hasta que navega.
  const submitting = login.isPending || login.isSuccess;

  return (
    <>
      <div className="rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient">
        {banner ? (
          <Alert
            className="mb-5"
            footnote={
              banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined
            }
          >
            {banner.message}
          </Alert>
        ) : justRegistered ? (
          <Alert tone="success" className="mb-5">
            Tu cuenta fue creada. Inicia sesión para continuar.
          </Alert>
        ) : justReset ? (
          <Alert tone="success" className="mb-5">
            Tu contraseña se actualizó y cerramos tus otras sesiones. Inicia sesión con la nueva.
          </Alert>
        ) : null}

        <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Iniciar sesión">
          <TextField
            id="login-email"
            label="Correo electrónico"
            labelClassName={labelClass}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            required
            maxLength={254}
            placeholder="tu@correo.com"
            leadingIcon={<Mail className="size-4" strokeWidth={1.75} />}
            error={errors.email?.message}
            {...register("email")}
          />

          <PasswordField
            id="login-password"
            label="Contraseña"
            labelClassName={labelClass}
            autoComplete="current-password"
            labelAction={
              <Link
                href={FORGOT_PASSWORD_PATH}
                className="inline-flex min-h-11 items-center text-[12.5px] font-semibold text-primary-container underline-offset-4 hover:underline focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            }
            enterKeyHint="done"
            required
            maxLength={128}
            placeholder="••••••••"
            leadingIcon={<Lock className="size-4" strokeWidth={1.75} />}
            error={errors.password?.message}
            {...register("password")}
          />

          <div className="space-y-2 pt-2">
            <Button
              type="submit"
              fullWidth
              loading={submitting}
              loadingText="Iniciando sesión…"
              disabled={offline}
              aria-describedby={offline ? OFFLINE_HINT_ID : undefined}
            >
              <span>Iniciar sesión</span>
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            </Button>
            {offline ? (
              <p id={OFFLINE_HINT_ID} className="text-center text-xs font-medium text-amber-status">
                Necesitas conexión para iniciar sesión.
              </p>
            ) : null}
          </div>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        ¿Aún no tienes cuenta?{" "}
        <Link
          href={withNext("/registro", next)}
          className="inline-flex min-h-11 items-center font-semibold text-primary-container underline underline-offset-4 hover:text-foreground focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          Crear cuenta
        </Link>
      </p>
    </>
  );
}
