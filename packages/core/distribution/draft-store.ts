import type { PlatformId } from "./platforms";

export interface DraftFillRecord {
  at: number;
  status: "filled" | "failed";
  message: string;
  warnings?: string[];
}

export interface DistributionDraft {
  id: string;
  title: string;
  markdown: string;
  sourceUrl: string;
  source: "capture" | "file" | "manual";
  createdAt: number;
  updatedAt: number;
  juejinTabId?: number;
  lastFill?: DraftFillRecord;
  platformTabIds?: Partial<Record<PlatformId, number>>;
  platformFills?: Partial<Record<PlatformId, DraftFillRecord>>;
}

const DB_NAME = "wan-neng-jian-cun-distribution";
const STORE_NAME = "drafts";
let pendingWrite: Promise<void> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地稿件库"));
  });
}

async function requestFromStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("本地稿件写入失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("本地稿件操作已取消"));
    });
  } finally {
    db.close();
  }
}

export function createDistributionDraft(
  input: Pick<DistributionDraft, "title" | "markdown" | "source" | "sourceUrl">,
): DistributionDraft {
  const now = Date.now();
  return {
    ...input,
    id: crypto.randomUUID(),
    title: input.title.trim() || "未命名稿件",
    createdAt: now,
    updatedAt: now,
  };
}

export function saveDistributionDraft(draft: DistributionDraft): Promise<void> {
  const previous = pendingWrite;
  const write = (async () => {
    await previous;
    await requestFromStore("readwrite", (store) => store.put(draft));
  })();
  pendingWrite = (async () => {
    try {
      await write;
    } catch {
      // Keep the queue usable; the caller still receives the write error.
    }
  })();
  return write;
}

export async function getDistributionDraft(id: string): Promise<DistributionDraft | null> {
  return (await requestFromStore("readonly", (store) => store.get(id))) ?? null;
}

export async function listDistributionDrafts(): Promise<DistributionDraft[]> {
  const drafts = await requestFromStore<DistributionDraft[]>("readonly", (store) => store.getAll());
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteDistributionDraft(id: string): Promise<void> {
  await pendingWrite;
  await requestFromStore("readwrite", (store) => store.delete(id));
}
