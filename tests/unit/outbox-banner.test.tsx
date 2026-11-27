import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROBLEM_TYPES, problemTypeUri } from "@/lib/api/problem";
import type { OutboxMutationRecord } from "@/lib/db/offline-db";
import { outboxEntryExpiredProblem } from "@/lib/offline/outbox";

const records = vi.hoisted(() => ({ current: [] as OutboxMutationRecord[] }));
const discardOutboxRecord = vi.fn<(id: number) => Promise<void>>(async () => undefined);
const retryExpiredOutboxRecord = vi.fn<(id: number) => Promise<boolean>>(async () => true);
const syncNow = vi.fn(async () => undefined);

vi.mock("@/features/pantry/hooks", () => ({
  useOutboxRecords: () => records.current,
  useOutboxSync: () => ({ syncNow }),
  discardOutboxRecord: (id: number) => discardOutboxRecord(id),
  retryExpiredOutboxRecord: (id: number) => retryExpiredOutboxRecord(id),
}));

const { OutboxBanner, OutboxSync } = await import("@/features/pantry/components/outbox-banner");

const row = (overrides: Partial<OutboxMutationRecord>): OutboxMutationRecord => ({
  id: 1,
  clientMutationId: "cmid-1",
  userId: "user-a",
  endpoint: "/api/bff/pantries/x/consume",
  method: "POST",
  payload: {},
  pantryId: "x",
  status: "conflict",
  createdAt: "2026-11-01T00:00:00.000Z",
  kind: "consume",
  ...overrides,
});

beforeEach(() => {
  discardOutboxRecord.mockClear();
  retryExpiredOutboxRecord.mockClear();
  syncNow.mockClear();
});

describe("OutboxBanner", () => {
  it("solo los conflictos outbox-entry-expired ofrecen 'Reenviar <label>'; todos conservan 'Descartar <label>'", () => {
    records.current = [
      row({ id: 1, label: "Leche · 1 l", lastError: outboxEntryExpiredProblem() }),
      row({
        id: 2,
        label: "Arroz · 2 kg",
        lastError: { type: problemTypeUri(PROBLEM_TYPES.insufficientStock), title: "x", status: 400, detail: "Stock insuficiente" },
      }),
    ];
    render(<OutboxBanner />);

    const region = screen.getByRole("region", { name: "Cambios con conflicto" });
    expect(within(region).getByText(/más de 7 días sin sincronizar/)).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: /Reenviar Leche · 1 l/ })).toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: /Reenviar Arroz/ })).toBeNull();
    expect(within(region).getByRole("button", { name: /Descartar Leche · 1 l/ })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: /Descartar Arroz · 2 kg/ })).toBeInTheDocument();
  });

  it("'Reenviar' renueva la fila y fuerza un drenado", async () => {
    records.current = [row({ id: 7, label: "Leche · 1 l", lastError: outboxEntryExpiredProblem() })];
    render(
      <OutboxSync>
        <OutboxBanner />
      </OutboxSync>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reenviar Leche/ }));

    await waitFor(() => expect(syncNow).toHaveBeenCalledOnce());
    expect(retryExpiredOutboxRecord).toHaveBeenCalledWith(7);
    expect(discardOutboxRecord).not.toHaveBeenCalled();
  });

  it("si la fila ya no es renovable no fuerza el drenado", async () => {
    retryExpiredOutboxRecord.mockResolvedValueOnce(false);
    records.current = [row({ id: 8, label: "Leche · 1 l", lastError: outboxEntryExpiredProblem() })];
    render(
      <OutboxSync>
        <OutboxBanner />
      </OutboxSync>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reenviar Leche/ }));

    await waitFor(() => expect(retryExpiredOutboxRecord).toHaveBeenCalledWith(8));
    expect(syncNow).not.toHaveBeenCalled();
  });
});
