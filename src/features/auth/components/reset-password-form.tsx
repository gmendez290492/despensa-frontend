"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PasswordField } from "@/components/ui/password-field";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";
import { useIsOffline } from "@/components/connection-status-pill";
import { useResetPasswordMutation } from "@/features/auth/client";
import { AUTH_ERROR_MESSAGES, mapAuthError, type AuthBanner } from "@/features/auth/form-errors";
import { PROBLEM_TYPES } from "@/lib/api/problem";
import { FORGOT_PASSWORD_PATH } from "@/lib/auth/constants";
import {
  RESET_TOKEN_MAX_LENGTH,
  RESET_TOKEN_MIN_LENGTH,
  resetPasswordSchema,
  type ResetPasswordInput,
  type ResetPasswordValues,
} from "@/lib/auth/schemas";

const RESET_FIELDS = ["new_password"] as const;
const OFFLINE_HINT_ID = "reset-offline-hint";
const STRENGTH_ID = "reset-password-strength";
const labelClass = "text-[12.5px] tracking-wider uppercase";

const linkClass =
  "inline-flex min-h-11 items-center font-semibold text-primary-container underline underline-offset-4 hover:text-foreground focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container";

/** `true` si el token de la URL tiene una forma plausible (la validez real la decide FastAPI). */
function isPlausibleToken(token: string | null): token is string {
  return (
    typeof token === "string" &&
    token.length >= RESET_TOKEN_MIN_LENGTH &&
    token.length <= RESET_TOKEN_MAX_LENGTH
  );
}

/** Aviso de enlace inválido con acceso a pedir uno nuevo. */
function InvalidLink({ message }: { message: string }) {
  return (
    <div className="rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient">
      <Alert title="Enlace no válido">{message}</Alert>
      <p className="mt-5 text-center text-sm">
        <Link href={FORGOT_PASSWORD_PATH} className={linkClass}>
          Solicitar un enlace nuevo
        </Link>
      </p>
    </div>
  );
}

/**
 * Formulario de restablecimiento de contraseña (Stitch "Despensa - Restablecer
 * Contraseña", screen `ad43b46c2dbb4794b1b4660b02272223`; destino del enlace del correo
 * `/reset-password?token=…`). Lee `useSearchParams`: envolver en `<Suspense>`.
 *
 * @remarks
 * - **El token no se queda en la URL:** se lee una vez en el estado del
 *   componente y se elimina con `history.replaceState`, para que no quede en
 *   el historial, en capturas ni en marcadores. La ruta además se sirve con
 *   `Referrer-Policy: no-referrer` (`next.config.ts`) y no carga recursos de
 *   terceros, así el token no se filtra por `Referer`.
 * - Una sola contraseña nueva con `autoComplete="new-password"` para que el
 *   navegador sugiera una fuerte (la guía desaconseja pedirla dos veces).
 * - `204`: FastAPI revoca todas las sesiones; se limpia el estado local y se
 *   va a `/login?reset=1`. `400 invalid-reset-token`: se ofrece pedir otro enlace.
 *
 * @returns El formulario o el aviso de enlace inválido.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `autofill-sign-up-form` y `security`.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Se captura en el primer render y no depende más de la URL (que se limpia).
  const [token] = useState(() => searchParams.get("token"));
  const [linkError, setLinkError] = useState<string | null>(null);
  const [banner, setBanner] = useState<AuthBanner | null>(null);

  const offline = useIsOffline();
  const reset = useResetPasswordMutation();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("token")) {
      url.searchParams.delete("token");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordValues, unknown, ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: token ?? "", new_password: "" },
  });
  const password = useWatch({ control, name: "new_password" }) ?? "";

  if (!isPlausibleToken(token)) {
    return <InvalidLink message="Este enlace está incompleto. Ábrelo de nuevo desde el correo o solicita uno nuevo." />;
  }
  if (linkError) return <InvalidLink message={linkError} />;

  const onSubmit = handleSubmit((values) => {
    if (offline) return;
    setBanner(null);
    reset.mutate(values, {
      onSuccess: () => {
        router.replace("/login?reset=1");
        router.refresh();
      },
      onError: (error) => {
        if (error.is(PROBLEM_TYPES.invalidResetToken)) {
          setLinkError(AUTH_ERROR_MESSAGES.invalidResetToken);
          return;
        }
        const mapped = mapAuthError(error, RESET_FIELDS);
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

  const submitting = reset.isPending || reset.isSuccess;

  return (
    <div className="rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient">
      {banner ? (
        <Alert
          className="mb-5"
          footnote={banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined}
        >
          {banner.message}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Restablecer contraseña">
        <input type="hidden" {...register("token")} />
        <PasswordField
          id="reset-new-password"
          label="Contraseña nueva"
          labelClassName={labelClass}
          autoComplete="new-password"
          leadingIcon={<Lock className="size-4" strokeWidth={1.75} />}
          enterKeyHint="done"
          required
          minLength={8}
          maxLength={128}
          describedByIds={[STRENGTH_ID]}
          error={errors.new_password?.message}
          {...register("new_password")}
        >
          <PasswordStrengthMeter id={STRENGTH_ID} password={password} />
        </PasswordField>

        <div className="space-y-2 pt-2">
          <Button
            type="submit"
            fullWidth
            loading={submitting}
            loadingText="Guardando contraseña…"
            disabled={offline}
            aria-describedby={offline ? OFFLINE_HINT_ID : undefined}
          >
            <span>Guardar contraseña nueva</span>
            <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
          </Button>
          {offline ? (
            <p id={OFFLINE_HINT_ID} className="text-center text-xs font-medium text-amber-status">
              Necesitas conexión para cambiar tu contraseña.
            </p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
