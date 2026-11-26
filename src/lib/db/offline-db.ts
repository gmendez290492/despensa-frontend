import Dexie, { type EntityTable } from "dexie";

export type OutboxMutationStatus = "pending" | "syncing" | "conflict" | "failed";

export interface ProblemDetailError {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  correlation_id?: string | null;
}

export interface OutboxMutationRecord {
  id?: number;
  clientMutationId: string;
  endpoint: string;
  method: "POST" | "PATCH" | "DELETE";
  payload: unknown;
  pantryId: string | null;
  status: OutboxMutationStatus;
  createdAt: string;
  lastError?: ProblemDetailError | null;
}

export class DespensaOfflineDB extends Dexie {
  outboxQueue!: EntityTable<OutboxMutationRecord, "id">;

  constructor() {
    super("DespensaOfflineDB");
    this.version(1).stores({
      outboxQueue: "++id, clientMutationId, status, pantryId, createdAt",
    });
  }
}

export const offlineDb = new DespensaOfflineDB();
