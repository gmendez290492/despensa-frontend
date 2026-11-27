import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Semaforo } from "@/features/pantry/api";
import { SemaforoBadge } from "@/features/pantry/components/semaforo-badge";

const CASES: [Semaforo, string][] = [
  ["ÓPTIMO", "Óptimo"],
  ["PRECAUCIÓN", "Precaución"],
  ["CRÍTICO", "Crítico"],
  ["VENCIDO", "Vencido"],
];

describe("SemaforoBadge", () => {
  it.each(CASES)("%s muestra texto e icono decorativo (no solo color)", (semaforo, label) => {
    const { container } = render(<SemaforoBadge semaforo={semaforo} detail="Vence mañana" />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Vence mañana")).toBeInTheDocument();
    const icon = container.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("usa la tinta de contraste del estado, no el color base", () => {
    const { container } = render(<SemaforoBadge semaforo="PRECAUCIÓN" />);
    expect(container.firstChild).toHaveClass("text-semaforo-precaucion-ink");
  });
});
