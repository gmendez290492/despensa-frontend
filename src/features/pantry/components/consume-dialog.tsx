"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Utensils, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  FieldError,
  Label,
  TextField,
  describedBy,
  fieldIds,
  inputBaseClass,
} from "@/components/ui/text-field";
import { formatQuantity, OptimisticInsufficientStockError, type ProductStock } from "@/features/pantry/fefo";
import { useActionMutationId, useConsumeMutation } from "@/features/pantry/hooks";
import { isProblemDetailError, PROBLEM_TYPES } from "@/lib/api/problem";
import { consumeSchema, type ConsumeInput, type ConsumePayload } from "@/lib/pantry/schemas";
import { cn } from "@/lib/utils";

/** Props de {@link ConsumeDialog}. */
export interface ConsumeDialogProps {
  /** Controla la apertura (`showModal()` / `close()`). */
  open: boolean;
  /** Se llama cuando el diálogo se cierra por cualquier vía (Esc, Cancelar, éxito). */
  onClose: () => void;
  /** Hogar activo. */
  pantryId: string;
  /** Productos con stock (de `groupByProduct`), en orden FEFO. */
  products: readonly ProductStock[];
  /** Producto preseleccionado (desde una tarjeta); si falta, el primero. */
  defaultProductId?: string | null;
  /** Mensaje de resultado para la región de estado, tras cerrar el diálogo. */
  onConsumed: (message: string) => void;
}

interface Banner {
  message: string;
  correlationId?: string;
}

/**
 * Mensaje de resultado de un consumo, para la región `role="status"`.
 *
 * @param product - Producto consumido.
 * @param quantity - Cantidad consumida (decimal `string`).
 * @param queued - `true` si quedó en la outbox sin conexión.
 * @returns p. ej. `"Consumiste 1 l de Leche."`.
 */
export function consumeOutcomeMessage(
  product: Pick<ProductStock, "productName" | "unitCode">,
  quantity: string,
  queued: boolean,
): string {
  const amount = formatQuantity(quantity, product.unitCode);
  return queued
    ? `Guardado sin conexión: ${amount} de ${product.productName}. Se sincronizará al volver la conexión.`
    : `Consumiste ${amount} de ${product.productName}.`;
}

/**
 * Diálogo modal "Registrar consumo" (Stitch "Quick Consume" / "Consume").
 * Descuenta stock por FEFO vía `useConsumeMutation` (optimista y con outbox
 * sin conexión).
 *
 * @remarks
 * - `<dialog>` nativo abierto con `showModal()` desde script (no
 *   `command`/`commandfor`, que son Baseline *newly available*). El navegador
 *   aporta página inerte, contención de foco, `Esc`, gesto atrás y devolución
 *   del foco al botón que lo abrió: no hay `role="dialog"`, `aria-modal`,
 *   trampa de foco ni manejador de `Esc` propios. El nombre accesible sale de
 *   `aria-labelledby` → `<h1>` (primer encabezado en su ámbito).
 * - El foco inicial va al primer campo útil (cantidad si el producto viene
 *   preseleccionado) justo después de `showModal()`: React no serializa
 *   `autofocus` en nodos creados en cliente, así que se enfoca explícitamente.
 * - Cantidad con `type="text"` + `inputMode="decimal"` (sin los saltos de
 *   `type="number"`), acepta coma; la unidad y el stock disponible son texto
 *   persistente enlazado con `aria-describedby`.
 * - `insufficient-stock` (servidor) y `OptimisticInsufficientStockError`
 *   (caché) se muestran como error del campo cantidad y le devuelven el foco.
 * - Estilos modales en `globals.css` (`dialog.app-dialog`): `overscroll-behavior`
 *   contiene el scroll sin bloquear `overflow` en `html`/`body`.
 *
 * @param props - {@link ConsumeDialogProps}.
 * @returns El `<dialog>` (cerrado hasta que `open` sea `true`).
 *
 * @see https://developer.chrome.com/docs/modern-web-guidance — guías `dialog`, `prevent-page-scroll-under-modal-dialog` y `forms`.
 */
export function ConsumeDialog({
  open,
  onClose,
  pantryId,
  products,
  defaultProductId,
  onConsumed,
}: ConsumeDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const titleId = `${uid}-title`;
  const productFieldId = `${uid}-product`;
  const quantityId = `${uid}-quantity`;
  const fefoNoteId = `${uid}-fefo`;

  const consume = useConsumeMutation();
  // Misma Idempotency-Key al reintentar el mismo consumo; nueva si cambia, tras éxito o error definitivo.
  const mutationId = useActionMutationId();
  const [banner, setBanner] = useState<Banner | null>(null);

  const initialProductId =
    products.find((product) => product.productId === defaultProductId)?.productId ??
    products[0]?.productId ??
    "";

  const {
    register,
    handleSubmit,
    reset,
    setError,
    control,
    formState: { errors },
  } = useForm<ConsumeInput, unknown, ConsumePayload>({
    resolver: zodResolver(consumeSchema),
    defaultValues: { product_id: initialProductId, quantity: "", notes: "" },
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setBanner(null);
      reset({ product_id: initialProductId, quantity: "", notes: "" });
      dialog.showModal();
      if (products.length > 0) {
        const target = defaultProductId ? quantityId : productFieldId;
        dialog.querySelector<HTMLElement>(`[id="${target}"]`)?.focus();
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // `initialProductId` se lee solo al abrir: no debe reabrir/reiniciar el formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selectedId = useWatch({ control, name: "product_id" });
  const selected = products.find((product) => product.productId === selectedId) ?? null;
  const qtyIds = fieldIds(quantityId);
  const quantityHintId = qtyIds.hint;

  const close = () => dialogRef.current?.close();

  const submitValid = (payload: ConsumePayload) => {
    const product = products.find((candidate) => candidate.productId === payload.product_id);
    if (!product) return;
    setBanner(null);
    consume.mutate(
      {
        pantryId,
        input: { product_id: payload.product_id, quantity: payload.quantity, notes: payload.notes || undefined },
        productName: product.productName,
        unitCode: product.unitCode,
        clientMutationId: mutationId.idFor([pantryId, payload]),
      },
      {
        onSuccess: (outcome) => {
          mutationId.release();
          const quantity = outcome.queued ? payload.quantity : outcome.result.consumed_quantity;
          // Cerrar primero: con el modal abierto la región de estado sería inerte.
          close();
          onConsumed(consumeOutcomeMessage(product, quantity, outcome.queued));
        },
        onError: (error) => {
          mutationId.release(error);
          if (error instanceof OptimisticInsufficientStockError) {
            setError(
              "quantity",
              {
                type: "server",
                message: `Solo quedan ${formatQuantity(error.available, product.unitCode)} de ${product.productName}.`,
              },
              { shouldFocus: true },
            );
            return;
          }
          if (isProblemDetailError(error) && error.is(PROBLEM_TYPES.insufficientStock)) {
            setError(
              "quantity",
              {
                type: "server",
                message: `No hay stock suficiente de ${product.productName}. Otro miembro del hogar pudo consumirlo; revisa la cantidad.`,
              },
              { shouldFocus: true },
            );
            return;
          }
          if (isProblemDetailError(error) && error.is(PROBLEM_TYPES.pantryAccessDenied)) {
            setBanner({ message: "Ya no tienes acceso a este hogar. Cierra el diálogo y recarga tus hogares." });
            return;
          }
          setBanner({
            message: "No pudimos registrar el consumo. Inténtalo de nuevo.",
            correlationId: isProblemDetailError(error) ? error.correlation_id : undefined,
          });
        },
      },
    );
  };

  // `handleSubmit` se invoca en el evento (no en render): `submitValid` lee el ref del diálogo.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => void handleSubmit(submitValid)(event);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-[24.875rem] rounded-[4px] border border-border-sand bg-surface-lowest p-0 text-foreground shadow-ambient"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-sand px-5 pt-4 pb-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-bold tracking-widest text-muted-foreground uppercase">
            Consumo FEFO
          </p>
          <h1 id={titleId} className="font-display text-2xl leading-8 font-medium tracking-tight">
            Registrar consumo
          </h1>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar"
          className="-mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-surface-low hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-container"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {products.length === 0 ? (
        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-muted-foreground">
            No hay productos con stock en este hogar ahora mismo.
          </p>
          <Button variant="secondary" size="md" fullWidth onClick={close}>
            Entendido
          </Button>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-labelledby={titleId} className="space-y-4 px-5 py-5">
          {banner ? (
            <Alert footnote={banner.correlationId ? `Código de soporte: ${banner.correlationId}` : undefined}>
              {banner.message}
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor={productFieldId}>Producto</Label>
            <select
              id={productFieldId}
              required
              aria-invalid={Boolean(errors.product_id)}
              aria-describedby={describedBy(errors.product_id && fieldIds(productFieldId).error)}
              className={cn(inputBaseClass, "appearance-auto")}
              {...register("product_id")}
            >
              {products.map((product) => (
                <option key={product.productId} value={product.productId}>
                  {product.productName} — {formatQuantity(product.available, product.unitCode)}
                </option>
              ))}
            </select>
            <FieldError id={fieldIds(productFieldId).error}>
              {errors.product_id ? "Elige un producto." : null}
            </FieldError>
          </div>

          <div className="space-y-1.5">
            <TextField
              id={quantityId}
              label={selected ? `Cantidad (${selected.unitCode})` : "Cantidad"}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              required
              maxLength={11}
              placeholder="1"
              hint={
                selected
                  ? `Disponible: ${formatQuantity(selected.available, selected.unitCode)} en ${selected.batchCount} ${
                      selected.batchCount === 1 ? "lote" : "lotes"
                    }. Admite decimales con coma.`
                  : undefined
              }
              error={errors.quantity?.message}
              aria-describedby={describedBy(
                selected ? quantityHintId : null,
                errors.quantity ? qtyIds.error : null,
                fefoNoteId,
              )}
              {...register("quantity")}
            />
          </div>

          <TextField
            id={`${uid}-notes`}
            label="Nota (opcional)"
            type="text"
            autoComplete="off"
            maxLength={255}
            enterKeyHint="done"
            placeholder="p. ej. Para la cena"
            error={errors.notes?.message}
            {...register("notes")}
          />

          <p id={fefoNoteId} className="flex items-start gap-2 text-xs leading-snug text-muted-foreground">
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span>Se descuenta primero del lote que vence antes (FEFO).</span>
          </p>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="secondary" size="md" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" size="md" loading={consume.isPending} loadingText="Registrando…">
              <Utensils aria-hidden="true" className="size-4" />
              Registrar consumo
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
