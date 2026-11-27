import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  StatusAnnouncerProvider,
  useAnnounceOnChange,
  useStatusAnnouncer,
} from "@/components/status-announcer";

function Trigger({ text = "Consumiste 1 l de Leche." }: { text?: string }) {
  const { announce } = useStatusAnnouncer();
  return (
    <button type="button" onClick={() => announce(text)}>
      Consumir
    </button>
  );
}

function RemovableTrigger() {
  const [shown, setShown] = useState(true);
  const { announce } = useStatusAnnouncer();
  return shown ? (
    <button
      type="button"
      onClick={() => {
        announce("Consumiste lo último.");
        setShown(false);
      }}
    >
      Consumir lo último
    </button>
  ) : null;
}

const toastRegion = () => screen.getByRole("region", { name: "Avisos" });

describe("StatusAnnouncerProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("muestra el aviso dentro de la región 'Avisos' con una región de estado", () => {
    render(
      <StatusAnnouncerProvider>
        <Trigger />
      </StatusAnnouncerProvider>,
    );
    const status = within(toastRegion()).getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Consumir" }));
    expect(status).toHaveTextContent("Consumiste 1 l de Leche.");
    expect(within(toastRegion()).getByRole("button", { name: "Cerrar aviso" })).toBeInTheDocument();
  });

  it("re-anuncia un mensaje idéntico montando un nodo nuevo en la región", () => {
    render(
      <StatusAnnouncerProvider>
        <Trigger />
      </StatusAnnouncerProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Consumir" }));
    const status = within(toastRegion()).getByRole("status");
    const first = status.firstElementChild;
    fireEvent.click(screen.getByRole("button", { name: "Consumir" }));
    const second = status.firstElementChild;
    expect(second).toHaveTextContent("Consumiste 1 l de Leche.");
    expect(second).not.toBe(first);
  });

  it("al cerrar el aviso devuelve el foco a donde estaba al anunciarse", () => {
    render(
      <StatusAnnouncerProvider>
        <main>
          <Trigger />
        </main>
      </StatusAnnouncerProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Consumir" });
    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByRole("button", { name: "Cerrar aviso" });
    close.focus();
    fireEvent.click(close);

    expect(screen.queryByRole("button", { name: "Cerrar aviso" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("si el elemento previo ya no existe, lleva el foco al <main>", () => {
    render(
      <StatusAnnouncerProvider>
        <main>
          <RemovableTrigger />
        </main>
      </StatusAnnouncerProvider>,
    );
    const trigger = screen.getByRole("button", { name: "Consumir lo último" });
    trigger.focus();
    fireEvent.click(trigger);

    const close = screen.getByRole("button", { name: "Cerrar aviso" });
    close.focus();
    fireEvent.click(close);

    const main = screen.getByRole("main");
    expect(main).toHaveFocus();
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("marca el aviso visible para reservar su altura en scroll-padding-bottom", () => {
    const { container } = render(
      <StatusAnnouncerProvider>
        <Trigger />
      </StatusAnnouncerProvider>,
    );
    const toast = container.ownerDocument.querySelector(".status-toast")!;
    expect(toast).not.toHaveAttribute("data-visible");
    fireEvent.click(screen.getByRole("button", { name: "Consumir" }));
    expect(toast).toHaveAttribute("data-visible");
    expect(document.documentElement.style.getPropertyValue("--status-toast-block-size")).toMatch(/px$/);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(toast).not.toHaveAttribute("data-visible");
    expect(document.documentElement.style.getPropertyValue("--status-toast-block-size")).toBe("");
  });
});

function Filter() {
  const [value, setValue] = useState("a");
  const [count, setCount] = useState(3);
  useAnnounceOnChange(value, `${count} resultados`, 300);
  return (
    <>
      <button type="button" onClick={() => setValue((previous) => (previous === "a" ? "b" : "a"))}>
        Cambiar filtro
      </button>
      <button type="button" onClick={() => setCount((previous) => previous + 1)}>
        Refetch
      </button>
    </>
  );
}

describe("useAnnounceOnChange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("anuncia una vez al cambiar la clave, nunca al montar ni si solo cambia el mensaje", () => {
    vi.useFakeTimers();
    render(
      <StatusAnnouncerProvider>
        <Filter />
      </StatusAnnouncerProvider>,
    );
    const announcer = screen.getByTestId("sr-announcer");

    act(() => vi.advanceTimersByTime(500));
    expect(announcer).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
    act(() => vi.advanceTimersByTime(500));
    expect(announcer).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole("button", { name: "Cambiar filtro" }));
    expect(announcer).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(300));
    expect(announcer).toHaveTextContent("4 resultados");
    // El anuncio oculto no crea un aviso visible.
    expect(screen.queryByRole("button", { name: "Cerrar aviso" })).not.toBeInTheDocument();
  });

  it("agrupa cambios rápidos en un solo anuncio con el último mensaje", () => {
    vi.useFakeTimers();
    render(
      <StatusAnnouncerProvider>
        <Filter />
      </StatusAnnouncerProvider>,
    );
    const announcer = screen.getByTestId("sr-announcer");
    fireEvent.click(screen.getByRole("button", { name: "Cambiar filtro" }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole("button", { name: "Refetch" }));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar filtro" }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole("button", { name: "Cambiar filtro" }));
    act(() => vi.advanceTimersByTime(299));
    expect(announcer).toBeEmptyDOMElement();
    act(() => vi.advanceTimersByTime(1));
    expect(announcer).toHaveTextContent("4 resultados");
    expect(announcer.children).toHaveLength(1);
  });
});
