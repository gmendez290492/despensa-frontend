"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { House, KeyRound, Users } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useIsOffline } from "@/components/connection-status-pill";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  isIdempotencyInProgressError,
  useActionMutationId,
  useCreatePantryMutation,
  useJoinPantryMutation,
} from "@/features/pantry/hooks";
import { isProblemDetailError, PROBLEM_TYPES } from "@/lib/api/problem";
import {
  createPantrySchema,
  joinPantrySchema,
  type CreatePantryInput,
  type JoinPantryInput,
} from "@/lib/pantry/schemas";

interface Banner {
  message: string;
  correlationId?: string;
}

const OFFLINE_HINT = "Necesitas conexión para crear o unirte a un hogar.";

function unexpectedBanner(error: unknown): Banner {
  if (isProblemDetailError(error) && (error.status === 0 || error.is(PROBLEM_TYPES.networkError))) {
    return { message: "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo." };
  }
  if (isIdempotencyInProgressError(error)) {
    // Sin reintento automático: la misma clave se reutiliza al volver a enviar.
    return { message: "Tu solicitud anterior aún se está procesando. Espera unos segundos e inténtalo de nuevo." };
  }
  return {
    message: "Algo salió mal. Inténtalo de nuevo; si persiste, contacta a soporte.",
    correlationId: isProblemDetailError(error) ? error.correlation_id : undefined,
  };
}

function CreatePantryForm({ offline }: { offline: boolean }) {
  const create = useCreatePantryMutation();
  const mutationId = useActionMutationId();
  const [banner, setBanner] = useState<Banner | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreatePantryInput>({ resolver: zodResolver(createPantrySchema), defaultValues: { name: "" } });

  const onSubmit = handleSubmit((values) => {
    if (offline) return;
    setBanner(null);
    create.mutate(
      { input: values, idempotencyKey: mutationId.idFor(["create-pantry", values]) },
      {
        onSuccess: () => mutationId.release(),
        onError: (error) => {
          mutationId.release(error);
          setBanner(unexpectedBanner(error));
        },
      },
    );
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="onboarding-create-title"
      className="space-y-4 rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient"
    >
      <h3 id="onboarding-create-title" className="flex items-center gap-2 font-display text-xl font-medium">
        <House aria-hidden="true" className="size-5 text-primary-container" />
        Crear un hogar
      </h3>
      <p className="text-sm text-muted-foreground">
        Crearemos una ubicación inicial y te daremos un código para invitar a tu familia.
      </p>
      {banner ? (
        <Alert footnote={banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined}>
          {banner.message}
        </Alert>
      ) : null}
      <TextField
        id="onboarding-pantry-name"
        label="Nombre del hogar"
        autoComplete="off"
        enterKeyHint="done"
        required
        minLength={2}
        maxLength={100}
        placeholder="Casa de la playa"
        hint="Entre 2 y 100 caracteres."
        error={errors.name?.message}
        {...register("name")}
      />
      <Button
        type="submit"
        fullWidth
        size="md"
        loading={create.isPending}
        loadingText="Creando hogar…"
        disabled={offline}
      >
        Crear hogar
      </Button>
    </form>
  );
}

function JoinPantryForm({ offline }: { offline: boolean }) {
  const join = useJoinPantryMutation();
  const mutationId = useActionMutationId();
  const [banner, setBanner] = useState<Banner | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<JoinPantryInput>({ resolver: zodResolver(joinPantrySchema), defaultValues: { invite_code: "" } });

  const onSubmit = handleSubmit((values) => {
    if (offline) return;
    setBanner(null);
    join.mutate({ input: values, idempotencyKey: mutationId.idFor(["join-pantry", values]) }, {
      onSuccess: () => mutationId.release(),
      onError: (error) => {
        mutationId.release(error);
        if (isProblemDetailError(error) && error.is(PROBLEM_TYPES.invalidInviteCode)) {
          setError(
            "invite_code",
            { type: "server", message: "Ese código no corresponde a ningún hogar. Revísalo con quien te invitó." },
            { shouldFocus: true },
          );
          return;
        }
        if (isProblemDetailError(error) && error.is(PROBLEM_TYPES.alreadyPantryMember)) {
          setError(
            "invite_code",
            { type: "server", message: "Ya eres miembro de ese hogar." },
            { shouldFocus: true },
          );
          return;
        }
        setBanner(unexpectedBanner(error));
      },
    });
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby="onboarding-join-title"
      className="space-y-4 rounded-[4px] border border-border-sand bg-surface-lowest p-5 shadow-ambient"
    >
      <h3 id="onboarding-join-title" className="flex items-center gap-2 font-display text-xl font-medium">
        <Users aria-hidden="true" className="size-5 text-primary-container" />
        Unirme con un código
      </h3>
      {banner ? (
        <Alert footnote={banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined}>
          {banner.message}
        </Alert>
      ) : null}
      <TextField
        id="onboarding-invite-code"
        label="Código de invitación"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        required
        minLength={6}
        maxLength={32}
        hint="Te lo comparte un miembro del hogar (6 a 32 caracteres)."
        leadingIcon={<KeyRound className="size-4" strokeWidth={1.75} />}
        error={errors.invite_code?.message}
        {...register("invite_code")}
      />
      <Button
        type="submit"
        variant="secondary"
        fullWidth
        size="md"
        loading={join.isPending}
        loadingText="Uniéndote…"
        disabled={offline}
      >
        Unirme al hogar
      </Button>
    </form>
  );
}

/**
 * Onboarding para usuarios sin hogares: formularios "Crear hogar" y "Unirme
 * con código". Al terminar, `useCreatePantryMutation` / `useJoinPantryMutation`
 * guardan el hogar en caché y lo activan, y el panel aparece solo.
 *
 * @remarks
 * - Cada `<form>` se nombra con `aria-labelledby` (hay dos en la página).
 * - `invalid-invite-code` y `already-pantry-member` son errores del campo con
 *   foco devuelto (React Hook Form), no banners genéricos.
 * - El código desactiva autocorrección y mayúsculas automáticas (es un
 *   identificador, no prosa).
 * - Sin conexión se bloquea el envío con texto visible (estas acciones no se
 *   encolan en la outbox).
 * - Cada envío lleva una `Idempotency-Key` por intención (`useActionMutationId`):
 *   el doble toque o el reintento tras 5xx/timeout con el mismo cuerpo
 *   reutiliza la clave; un `409 idempotency-request-in-progress` muestra un
 *   aviso para esperar, sin reintentar en bucle.
 *
 * @returns La sección de onboarding.
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guía `forms`.
 */
export function PantryOnboarding() {
  const offline = useIsOffline();
  return (
    <section aria-labelledby="onboarding-title" className="space-y-4">
      <div>
        <h2 id="onboarding-title" className="font-display text-2xl font-medium tracking-tight">
          Empieza tu despensa
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Aún no perteneces a ningún hogar. Crea uno o únete al de tu familia.
        </p>
        {offline ? <p className="mt-2 text-xs font-medium text-amber-status">{OFFLINE_HINT}</p> : null}
      </div>
      <CreatePantryForm offline={offline} />
      <JoinPantryForm offline={offline} />
    </section>
  );
}
