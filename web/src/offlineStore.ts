// Durable storage for diary changes made on this device but not yet confirmed by the server. IndexedDB survives
// closed tabs and phone restarts; an in-memory copy keeps reads synchronous for the UI. One pending operation per
// entry id: logging and then deleting an entry before it was sent leaves only the delete.
import type { DiaryEntry, EntryInput } from '@shared/types.ts';

export type PendingOp =
  | { kind: 'put'; id: string; input: EntryInput; /** What the diary shows until the server has it. */ preview: DiaryEntry }
  | { kind: 'delete'; id: string; day: string };

const DB_NAME = 'nutrilog';
const STORE = 'pendingOps';
/** The fallback when IndexedDB is unavailable (private mode in some browsers). */
const LOCAL_KEY = 'nutrilog.pendingOps';

const cache = new Map<string, PendingOp>();
let db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function idb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db!.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function saveLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify([...cache.values()]));
  } catch {
    // Storage full or blocked: the in-memory copy still syncs while the tab is open.
  }
}

/** Loads what is pending. Never rejects: without IndexedDB the queue falls back to localStorage. */
export async function initOfflineStore(): Promise<void> {
  try {
    db = await openDb();
    const all = await idb<PendingOp[]>('readonly', (s) => s.getAll() as IDBRequest<PendingOp[]>);
    for (const op of all) cache.set(op.id, op);
  } catch {
    db = null;
    try {
      for (const op of JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as PendingOp[]) cache.set(op.id, op);
    } catch {
      // Nothing usable stored.
    }
  }
}

export function pendingAll(): PendingOp[] {
  return [...cache.values()];
}

export function getPending(id: string): PendingOp | undefined {
  return cache.get(id);
}

export async function putPending(op: PendingOp): Promise<void> {
  cache.set(op.id, op);
  if (db) await idb('readwrite', (s) => s.put(op, op.id)).catch(saveLocal);
  else saveLocal();
}

export async function deletePending(id: string): Promise<void> {
  cache.delete(id);
  if (db) await idb('readwrite', (s) => s.delete(id)).catch(saveLocal);
  else saveLocal();
}
