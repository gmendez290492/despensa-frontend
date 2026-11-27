import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import { StatusAnnouncerProvider } from "@/components/status-announcer";
import { PriorityShelf } from "@/features/pantry/components/priority-shelf";
import { IDS, LOCATIONS, makeBatch } from "./helpers/pantry-fixtures";

const BATCHES = [
  makeBatch({ product_name: "Yogur", product_id: IDS.yogurt, dias_para_vencer: -2, semaforo: "VENCIDO" }),
  makeBatch({ product_name: "Leche", dias_para_vencer: 1, semaforo: "CRÍTICO" }),
  makeBatch({ product_name: "Pan", dias_para_vencer: 5, semaforo: "PRECAUCIÓN", location_id: IDS.larder }),
  makeBatch({ product_name: "Arroz", product_id: IDS.rice, dias_para_vencer: 90, semaforo: "ÓPTIMO" }),
  // Agotado: no cuenta.
  makeBatch({ product_name: "Huevos", current_quantity: "0", dias_para_vencer: 1 }),
];

function renderShelf(searchParams = "", onUrlUpdate?: (event: UrlUpdateEvent) => void) {
  const onConsume = vi.fn();
  render(
    <StatusAnnouncerProvider>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
        <PriorityShelf batches={BATCHES} locations={LOCATIONS} onConsume={onConsume} />
      </NuqsTestingAdapter>
    </StatusAnnouncerProvider>,
  );
  return { onConsume };
}

const productHeadings = () =>
  screen.queryAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);

describe("PriorityShelf (filtros ?plazo=)", () => {
  it("por defecto muestra los urgentes (≤ 7 días) con recuentos y aria-pressed", () => {
    renderShelf();
    const group = screen.getByRole("group", { name: "Plazo de caducidad" });
    expect(within(group).getByRole("button", { name: /Urgentes \(3\)/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: /Vencidos \(1\)/ })).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: /En 48 h \(1\)/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Esta semana \(2\)/ })).toBeInTheDocument();
    expect(productHeadings()).toEqual(["Yogur", "Leche", "Pan"]);
  });

  it("filtra y escribe el plazo en la URL", async () => {
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    renderShelf("", onUrlUpdate);
    fireEvent.click(screen.getByRole("button", { name: /Vencidos/ }));

    expect(screen.getByRole("button", { name: /Vencidos/ })).toHaveAttribute("aria-pressed", "true");
    expect(productHeadings()).toEqual(["Yogur"]);
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get("plazo")).toBe("vencidos");
    expect(screen.getByText("1 lote · vencidos")).toBeInTheDocument();
    // El recuento se anuncia una vez por la región oculta del shell, no como región viva propia.
    await waitFor(() => expect(screen.getByTestId("sr-announcer")).toHaveTextContent("1 lote · vencidos"));
  });

  it("no anuncia el recuento al montar (solo al cambiar de plazo)", async () => {
    renderShelf("?plazo=semana");
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByTestId("sr-announcer")).toBeEmptyDOMElement();
    expect(screen.getByText("2 lotes · esta semana")).not.toHaveAttribute("role");
  });

  it("lee el plazo de la URL compartida", () => {
    renderShelf("?plazo=semana");
    expect(screen.getByRole("button", { name: /Esta semana/ })).toHaveAttribute("aria-pressed", "true");
    expect(productHeadings()).toEqual(["Leche", "Pan"]);
  });

  it("la tarjeta muestra ubicación, semáforo y cantidad, y abre el consumo", () => {
    const { onConsume } = renderShelf("?plazo=48h");
    const card = screen.getByRole("article");
    expect(within(card).getByText("Nevera")).toBeInTheDocument();
    expect(within(card).getByText("Crítico")).toBeInTheDocument();
    expect(within(card).getByText("1,5 l")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Consumir Leche" }));
    expect(onConsume).toHaveBeenCalledWith(expect.objectContaining({ product_name: "Leche" }));
  });

  it("muestra un estado vacío si nada vence en el plazo", () => {
    render(
      <NuqsTestingAdapter>
        <PriorityShelf
          batches={[makeBatch({ dias_para_vencer: 30, semaforo: "ÓPTIMO" })]}
          locations={LOCATIONS}
          onConsume={vi.fn()}
        />
      </NuqsTestingAdapter>,
    );
    expect(screen.getByText(/Todo está en buen estado/)).toBeInTheDocument();
  });
});
