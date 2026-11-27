"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useIsOffline } from "@/components/connection-status-pill";
import { blockSubmitWhileOffline } from "@/features/auth/offline-submit";
import { useForgotPasswordMutation } from "@/features/auth/client";
import { mapAuthError, type AuthBanner } from "@/features/auth/form-errors";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
  type ForgotPasswordValues,
} from "@/lib/auth/schemas";

const FORGOT_FIELDS = ["email"] as const;
const OFFLINE_HINT_ID = "forgot-offline-hint";
const labelClass = "text-[0.78125rem] tracking-wider uppercase";

const linkClass =
  "inline-flex min-h-11 items-center font-semibold text-primary-container underline underline-offset-4 hover:text-foreground focus-visible:rounded-[4px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container";

/**
 * Formulario "Olvidé mi contraseña" (Stitch "Despensa - Recuperar Contraseña",
 * screen `84802b86c1ae44ea83665e1b0e03b10b`): pide el correo y muestra siempre el
 * mismo mensaje genérico de FastAPI, exista o no la cuenta (no revela si el
 * correo está registrado).
 *
 * @remarks
 * - Correo con `type="email"`, `autoComplete="username"` y `required`, como en el login.
 * - Tras el envío el formulario se sustituye por un `Alert` `role="status"`
 *   (anuncio cortés) con el mensaje y un enlace para volver a iniciar sesión.
 * - Un `429` muestra cuánto esperar (`Retry-After`) y no se reintenta solo.
 * - Sin conexión el botón queda `aria-disabled` (enfocable, lee la pista
 *   `aria-describedby`) y `blockSubmitWhileOffline` bloquea el envío.
 *
 * @returns Tarjeta con el formulario o el mensaje de confirmación.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `autofill-sign-in-form`, `forms` y `custom-button-actions`.
 */
export function ForgotPasswordForm() {
  const offline = useIsOffline();
  const forgot = useForgotPasswordMutation();
  const [banner, setBanner] = useState<AuthBanner | null>(null);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordValues, unknown, ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit((values) => {
    if (offline) return;
    setBanner(null);
    forgot.mutate(values, {
      onSuccess: ({ detail }) => setSentMessage(detail),
      onError: (error) => {
        const mapped = mapAuthError(error, FORGOT_FIELDS);
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

  if (sentMessage) {
    return (
      <div className="rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient">
        <Alert tone="success" title="Revisa tu correo">
          {sentMessage} El enlace caduca en 30 minutos.
        </Alert>
        <p className="mt-5 text-center text-sm text-muted-foreground">
          <Link href="/login" className={linkClass}>
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient">
        {banner ? (
          <Alert
            className="mb-5"
            footnote={banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined}
          >
            {banner.message}
          </Alert>
        ) : null}

        <form onSubmit={blockSubmitWhileOffline(offline, onSubmit)} noValidate className="space-y-4" aria-label="Recuperar contraseña">
          <TextField
            id="forgot-email"
            label="Correo electrónico"
            labelClassName={labelClass}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="send"
            required
            maxLength={254}
            placeholder="tu@correo.com"
            hint="Te enviaremos un enlace para crear una contraseña nueva."
            leadingIcon={<Mail className="size-4" strokeWidth={1.75} />}
            error={errors.email?.message}
            {...register("email")}
          />

          <div className="space-y-2 pt-2">
            <Button
              type="submit"
              fullWidth
              loading={forgot.isPending}
              loadingText="Enviando enlace…"
              aria-disabled={offline || undefined}
              aria-describedby={offline ? OFFLINE_HINT_ID : undefined}
            >
              <span>Enviar enlace</span>
              <ArrowRight aria-hidden="true" className="size-4" strokeWidth={2} />
            </Button>
            {offline ? (
              <p id={OFFLINE_HINT_ID} className="text-center text-xs font-medium text-amber-status">
                Necesitas conexión para recuperar tu contraseña.
              </p>
            ) : null}
          </div>
        </form>
      </div>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        ¿La recordaste?{" "}
        <Link href="/login" className={linkClass}>
          Inicia sesión
        </Link>
      </p>
    </>
  );
}
