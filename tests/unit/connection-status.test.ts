import { describe, expect, it } from "vitest";
import { subscribeToConnectionStatus } from "@/lib/offline/connection";
import type { ConnectionStatus } from "@/stores/ui-store";

function setup(initialOnline: boolean, initialStatus: ConnectionStatus = "online") {
  const nav = { onLine: initialOnline };
  const target = new EventTarget();
  let status: ConnectionStatus = initialStatus;
  const history: ConnectionStatus[] = [];
  const unsubscribe = subscribeToConnectionStatus(
    () => status,
    (next) => {
      status = next;
      history.push(next);
    },
    { navigator: nav, target },
  );
  const go = (online: boolean) => {
    nav.onLine = online;
    target.dispatchEvent(new Event(online ? "online" : "offline"));
  };
  return { go, unsubscribe, getStatus: () => status, history };
}

describe("subscribeToConnectionStatus", () => {
  it("sincroniza el valor real tras montar (SSR asume 'online')", () => {
    const { getStatus } = setup(false);
    expect(getStatus()).toBe("offline");
  });

  it("no emite si el estado ya coincide", () => {
    const { history } = setup(true);
    expect(history).toEqual([]);
  });

  it("reacciona a eventos online/offline", () => {
    const { go, getStatus } = setup(true);
    go(false);
    expect(getStatus()).toBe("offline");
    go(true);
    expect(getStatus()).toBe("online");
  });

  it("no pisa 'syncing' con 'online', pero sí pasa a 'offline'", () => {
    const { go, getStatus } = setup(true, "syncing");
    go(true);
    expect(getStatus()).toBe("syncing");
    go(false);
    expect(getStatus()).toBe("offline");
  });

  it("la limpieza elimina los listeners", () => {
    const { go, unsubscribe, getStatus } = setup(true);
    unsubscribe();
    go(false);
    expect(getStatus()).toBe("online");
  });
});
