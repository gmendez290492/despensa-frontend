import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OptimisticInsufficientStockError, type ProductStock } from "@/features/pantry/fefo";
import { ProblemDetailError, problemTypeUri } from "@/lib/api/problem";
import { IDS, makeBatch } from "./helpers/pantry-fixtures";

type MutateOptions = { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void };
const mutate = vi.fn<(variables: unknown, options?: MutateOptions) => void>();

vi.mock("@/features/pantry/hooks", async (importOriginal) => ({
  // La lógica real de la Idempotency-Key estable; solo se simula la mutación.
  useActionMutationId: (await importOriginal<typeof import("@/features/pantry/hooks")>()).useActionMutationId,
  useConsumeMutation: () => ({ mutate, isPending: false }),
}));

const { ConsumeDialog } = await import("@/features/pantry/components/consume-dialog");

const PRODUCTS: ProductStock[] = [
  {
    productId: IDS.milk,
    productName: "Leche",
    unitCode: "l",
    available: "1.5",
    firstBatch: makeBatch(),
    batchCount: 1,
  },
  {
    productId: IDS.rice,
    productName: "Arroz",
    unitCode: "kg",
    available: "2",
    firstBatch: makeBatch({ product_id: IDS.rice, product_name: "Arroz", unit_code: "kg" }),
    batchCount: 2,
  },
];

beforeAll(() => {
  // jsdom no implementa showModal()/close() del <dialog>.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

function renderDialog(overrides: Partial<ComponentProps<typeof ConsumeDialog>> = {}) {
  const onClose = vi.fn();
  const onConsumed = vi.fn();
  render(
    <ConsumeDialog
      open
      onClose={onClose}
      pantryId={IDS.pantry}
      products={PRODUCTS}
      defaultProductId={IDS.milk}
      onConsumed={onConsumed}
      {...overrides}
    />,
  );
  return { onClose, onConsumed };
}

const quantityField = () => screen.getByLabelText(/^cantidad \(l\)/i);

function submitQuantity(value: string) {
  fireEvent.change(quantityField(), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar consumo" }));
}

describe("ConsumeDialog", () => {
  beforeEach(() => mutate.mockReset());

  it("es un <dialog> nombrado, con producto, cantidad decimal y nota FEFO", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog", { name: "Registrar consumo" });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(screen.getByLabelText("Producto")).toHaveValue(IDS.milk);
    expect(screen.getByRole("option", { name: /Leche/ })).toBeInTheDocument();
    const quantity = quantityField();
    expect(quantity).toHaveAttribute("inputmode", "decimal");
    expect(quantity).toHaveAttribute("aria-invalid", "false");
    expect(quantity).toHaveAccessibleDescription(/Disponible: 1,5 l.*FEFO/);
    expect(quantity).toHaveFocus();
  });

  it("valida la cantidad sin llamar a la API", async () => {
    renderDialog();
    submitQuantity("0");
    expect(await screen.findByText("La cantidad debe ser mayor que 0.")).toBeInTheDocument();
    expect(quantityField()).toHaveAttribute("aria-invalid", "true");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("envía la cantidad normalizada, cierra y anuncia el resultado", async () => {
    mutate.mockImplementation((_variables, options) =>
      options?.onSuccess?.({ queued: false, result: { consumed_quantity: "1.5" } }),
    );
    const { onClose, onConsumed } = renderDialog();
    submitQuantity("1,5");

    await waitFor(() => expect(onConsumed).toHaveBeenCalledWith("Consumiste 1,5 l de Leche."));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        pantryId: IDS.pantry,
        productName: "Leche",
        unitCode: "l",
        input: expect.objectContaining({ product_id: IDS.milk, quantity: "1.5" }),
        clientMutationId: expect.any(String),
      }),
      expect.any(Object),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("anuncia el guardado sin conexión cuando queda en la outbox", async () => {
    mutate.mockImplementation((_variables, options) =>
      options?.onSuccess?.({ queued: true, clientMutationId: "x" }),
    );
    const { onConsumed } = renderDialog();
    submitQuantity("1");
    await waitFor(() =>
      expect(onConsumed).toHaveBeenCalledWith(expect.stringMatching(/^Guardado sin conexión/)),
    );
  });

  it("muestra insufficient-stock del servidor como error del campo", async () => {
    mutate.mockImplementation((_variables, options) =>
      options?.onError?.(
        new ProblemDetailError({ type: problemTypeUri("insufficient-stock"), title: "Insufficient", status: 400 }),
      ),
    );
    const { onConsumed } = renderDialog();
    submitQuantity("1");

    expect(await screen.findByText(/No hay stock suficiente de Leche/)).toBeInTheDocument();
    expect(quantityField()).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(quantityField()).toHaveFocus());
    expect(onConsumed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
  });

  it("muestra el conflicto optimista con el stock en caché", async () => {
    mutate.mockImplementation((_variables, options) =>
      options?.onError?.(new OptimisticInsufficientStockError("1.5")),
    );
    renderDialog();
    submitQuantity("3");
    expect(await screen.findByText("Solo quedan 1,5 l de Leche.")).toBeInTheDocument();
  });

  it("reutiliza el clientMutationId al reintentar el mismo consumo y lo regenera si cambia o tras un error definitivo", async () => {
    const ids = () => mutate.mock.calls.map(([variables]) => (variables as { clientMutationId: string }).clientMutationId);
    // Resultado en duda (2xx con JSON ilegible): la clave se conserva.
    mutate.mockImplementation((_variables, options) => options?.onError?.(new SyntaxError("Unexpected end of JSON")));
    renderDialog();
    submitQuantity("1");
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    submitQuantity("1");
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(ids()[1]).toBe(ids()[0]);

    // Otro cuerpo → otra clave (si no, 422 idempotency-key-reused).
    submitQuantity("0,5");
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(3));
    expect(ids()[2]).not.toBe(ids()[1]);

    // Error de negocio definitivo → se libera: el siguiente intento usa otra clave.
    mutate.mockImplementation((_variables, options) =>
      options?.onError?.(new ProblemDetailError({ type: problemTypeUri("insufficient-stock"), title: "x", status: 400 })),
    );
    submitQuantity("0,5");
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(4));
    expect(ids()[3]).toBe(ids()[2]);
    submitQuantity("0,5");
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(5));
    expect(ids()[4]).not.toBe(ids()[3]);
  });

  it("muestra el código de soporte en errores inesperados", async () => {
    mutate.mockImplementation((_variables, options) =>
      options?.onError?.(
        new ProblemDetailError({
          type: problemTypeUri("unknown-error"),
          title: "Boom",
          status: 500,
          correlation_id: "corr-9",
        }),
      ),
    );
    renderDialog();
    submitQuantity("1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Código de soporte: corr-9");
  });
});
