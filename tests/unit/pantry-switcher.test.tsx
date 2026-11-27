import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PANTRY_SWITCH_DELAY_MS, PantrySwitcher } from "@/features/pantry/components/home-dashboard";
import type { PantryResponse } from "@/features/pantry/api";

const PANTRIES = [
  { id: "p1", name: "Casa" },
  { id: "p2", name: "Playa" },
  { id: "p3", name: "Oficina" },
] as unknown as PantryResponse[];

describe("PantrySwitcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("no se muestra con un solo hogar", () => {
    const { container } = render(<PantrySwitcher pantries={PANTRIES.slice(0, 1)} activeId="p1" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("agrupa los cambios rápidos (flechas) y aplica solo el último", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<PantrySwitcher pantries={PANTRIES} activeId="p1" onChange={onChange} />);
    const select = screen.getByLabelText("Hogar activo");

    fireEvent.change(select, { target: { value: "p2" } });
    expect(select).toHaveValue("p2");
    act(() => vi.advanceTimersByTime(PANTRY_SWITCH_DELAY_MS - 100));
    fireEvent.change(select, { target: { value: "p3" } });
    act(() => vi.advanceTimersByTime(PANTRY_SWITCH_DELAY_MS - 1));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("p3");
  });

  it("aplica de inmediato lo pendiente al salir del control", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(<PantrySwitcher pantries={PANTRIES} activeId="p1" onChange={onChange} />);
    const select = screen.getByLabelText("Hogar activo");

    fireEvent.change(select, { target: { value: "p2" } });
    fireEvent.blur(select);
    expect(onChange).toHaveBeenCalledWith("p2");
    act(() => vi.advanceTimersByTime(PANTRY_SWITCH_DELAY_MS));
    expect(onChange).toHaveBeenCalledOnce();
  });
});
