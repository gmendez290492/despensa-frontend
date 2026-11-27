import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

const { default: OfflinePage } = await import("@/app/offline/page");
const { OfflineCopy } = await import("@/app/offline/offline-copy");

describe("/offline", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
  });

  it("sin motivo muestra 'Sin conexión' con el icono de wifi y Reintentar", () => {
    const { container } = render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sin conexión" })).toBeInTheDocument();
    expect(screen.getByText(/no tiene conexión a internet/i)).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-wifi-off")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("con motivo=limite habla del rate limit, sin icono de wifi y con Reintentar", () => {
    searchParams = new URLSearchParams({ motivo: "limite" });
    const { container } = render(<OfflinePage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Demasiados intentos" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/espera unos segundos y vuelve a intentarlo/i)).toBeInTheDocument();
    expect(screen.queryByText("Sin conexión")).toBeNull();
    expect(screen.queryByText(/conexión a internet/i)).toBeNull();
    expect(container.querySelector("svg.lucide-wifi-off")).toBeNull();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("un motivo desconocido cae en el texto por defecto", () => {
    searchParams = new URLSearchParams({ motivo: "otro" });
    render(<OfflinePage />);
    expect(screen.getByRole("heading", { level: 1, name: "Sin conexión" })).toBeInTheDocument();
  });

  it("el fallback de <Suspense> (HTML estático) es el texto por defecto", () => {
    render(<OfflineCopy reason="red" />);
    expect(screen.getByRole("heading", { level: 1, name: "Sin conexión" })).toBeInTheDocument();
  });
});

describe("RetryButton", () => {
  const assign = vi.fn();
  const reload = vi.fn();

  const stubLocation = (pathname: string, search = "") => {
    vi.stubGlobal("location", { pathname, search, assign, reload });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    assign.mockReset();
    reload.mockReset();
  });

  it("en /offline?motivo=limite&next= navega a `next` saneado", () => {
    stubLocation("/offline", "?motivo=limite&next=%2Finventario%3Fsemaforo%3Dcritico");
    render(<OfflinePage />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(assign).toHaveBeenCalledWith("/inventario?semaforo=critico");
    expect(reload).not.toHaveBeenCalled();
  });

  it("en /offline rechaza un `next` externo y va a /", () => {
    stubLocation("/offline", "?motivo=limite&next=https%3A%2F%2Fevil.example");
    render(<OfflinePage />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("como fallback del SW (otra ruta en la barra) recarga", () => {
    stubLocation("/despensa");
    render(<OfflinePage />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});
