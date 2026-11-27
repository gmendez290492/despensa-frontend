import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type LogoutOptions = { onSettled?: (data: unknown, error: unknown) => void };
const mutate = vi.fn<(variables: unknown, options?: LogoutOptions) => void>();
const replace = vi.fn();
const refresh = vi.fn();
const syncNow = vi.fn<() => Promise<void>>(async () => undefined);
const countUnsynced = vi.fn<() => Promise<number>>(async () => 0);
let records: { id: number; status: string }[] = [];

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/features/auth/client", () => ({ useLogoutMutation: () => ({ mutate, isPending: false }) }));
vi.mock("@/features/pantry/hooks", () => ({ useOutboxRecords: () => records }));
vi.mock("@/features/pantry/components/outbox-banner", () => ({ useOutboxSyncNow: () => syncNow }));
vi.mock("@/lib/offline/clear-user-data", () => ({ countUnsyncedOutboxRecords: () => countUnsynced() }));

const { LogoutButton } = await import("@/features/auth/components/logout-button");

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

beforeEach(() => {
  mutate.mockReset();
  syncNow.mockReset().mockResolvedValue(undefined);
  countUnsynced.mockReset().mockResolvedValue(0);
  records = [];
});

const openLogoutButton = () => screen.getByRole("button", { name: "Cerrar sesión" });
const dialog = () => document.querySelector("dialog")!;

describe("LogoutButton", () => {
  it("sin cambios pendientes cierra sesión directamente", async () => {
    render(<LogoutButton />);
    fireEvent.click(openLogoutButton());
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    expect(dialog()).not.toHaveAttribute("open");
  });

  it("con cambios sin sincronizar pide confirmación con foco en Cancelar", async () => {
    countUnsynced.mockResolvedValue(2);
    records = [
      { id: 1, status: "pending" },
      { id: 2, status: "conflict" },
    ];
    render(<LogoutButton />);
    fireEvent.click(openLogoutButton());

    await waitFor(() => expect(dialog()).toHaveAttribute("open"));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tienes 2 cambios sin sincronizar");
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(dialog()).not.toHaveAttribute("open");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("'Cerrar sesión igualmente' descarta y cierra sesión", async () => {
    countUnsynced.mockResolvedValue(1);
    render(<LogoutButton />);
    fireEvent.click(openLogoutButton());
    await waitFor(() => expect(dialog()).toHaveAttribute("open"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tienes 1 cambio sin sincronizar");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión igualmente" }));
    expect(dialog()).not.toHaveAttribute("open");
    expect(mutate).toHaveBeenCalledOnce();
  });

  it("'Sincronizar ahora' cierra sesión si la outbox queda vacía", async () => {
    countUnsynced.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    render(<LogoutButton />);
    fireEvent.click(openLogoutButton());
    await waitFor(() => expect(dialog()).toHaveAttribute("open"));

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar ahora" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    expect(syncNow).toHaveBeenCalledOnce();
    expect(dialog()).not.toHaveAttribute("open");
  });

  it("si quedan cambios tras sincronizar lo explica y no cierra sesión", async () => {
    countUnsynced.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    render(<LogoutButton />);
    fireEvent.click(openLogoutButton());
    await waitFor(() => expect(dialog()).toHaveAttribute("open"));

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar ahora" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Quedan 1 cambio sin sincronizar"),
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(dialog()).toHaveAttribute("open");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tienes 1 cambio sin sincronizar");
  });

  it("mientras sincroniza usa aria-disabled (conserva el foco) e ignora pulsaciones", async () => {
    let finish: () => void = () => undefined;
    syncNow.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    countUnsynced.mockResolvedValue(1);
    render(<LogoutButton />);
    fireEvent.click(openLogoutButton());
    await waitFor(() => expect(dialog()).toHaveAttribute("open"));

    fireEvent.click(screen.getByRole("button", { name: "Sincronizar ahora" }));
    const busy = await screen.findByRole("button", { name: "Sincronizando…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).not.toBeDisabled();
    fireEvent.click(busy);
    expect(syncNow).toHaveBeenCalledOnce();
    finish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sincronizar ahora" })).toBeInTheDocument());
  });
});
