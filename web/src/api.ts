import type {
  AppInfo,
  BodyWeightEntry,
  DayMark,
  DiaryDay,
  DiaryEntry,
  EntryInput,
  Meal,
  Product,
  ProductInput,
  ProductLists,
  ProductPreference,
  Profile,
  ProgressResponse,
  Recipe,
  RecipeInput,
  SourcesInfo,
  TargetResponse,
} from '@shared/types.ts';
import { sumNutrients } from '@shared/nutrition.ts';
import { deletePending, getPending, pendingAll, putPending, type PendingOp } from './offlineStore.ts';
import { t } from './i18n.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(t('No connection to the server', 'Geen verbinding met de server'), 0);
  }
  if (res.status === 401) window.dispatchEvent(new Event('open-nutrilog:unauthorized'));
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error ?? t(`Request failed (${res.status})`, `Verzoek mislukt (${res.status})`), res.status);
  return data as T;
}

export const api = {
  info: () => request<AppInfo>('GET', '/api/info'),
  login: (password: string) => request<{ ok: true }>('POST', '/api/auth/login', { password }),
  logout: () => request<{ ok: true; redirect: string | null }>('POST', '/api/auth/logout'),

  profile: () => request<{ profile: Profile | null }>('GET', '/api/profile'),
  saveProfile: (p: Omit<Profile, 'updatedAt'>) => request<{ profile: Profile }>('PUT', '/api/profile', p),

  search: (q: string) => request<{ products: Product[] }>('GET', `/api/products/search?q=${encodeURIComponent(q)}`),
  searchOnline: (q: string) => request<{ products: Product[] }>('GET', `/api/products/search?q=${encodeURIComponent(q)}&online=1`),
  recipe: (id: number) => request<{ recipe: Recipe }>('GET', `/api/recipes/${id}`),
  saveRecipe: (id: number | null, r: RecipeInput) => request<{ recipe: Recipe }>(id ? 'PUT' : 'POST', id ? `/api/recipes/${id}` : '/api/recipes', r),
  sources: () => request<SourcesInfo>('GET', '/api/sources'),
  productLists: () => request<ProductLists>('GET', '/api/products/lists'),
  barcode: (code: string) => request<{ product: Product }>('GET', `/api/products/barcode/${encodeURIComponent(code)}`),
  product: (id: number) => request<{ product: Product }>('GET', `/api/products/${id}`),
  createProduct: (p: ProductInput) => request<{ product: Product }>('POST', '/api/products', p),
  updateProduct: (id: number, p: ProductInput) => request<{ product: Product }>('PUT', `/api/products/${id}`, p),
  deleteProduct: (id: number) => request<{ ok: true }>('DELETE', `/api/products/${id}`),
  setPreference: (id: number, preference: ProductPreference | null) => request<{ product: Product }>('PUT', `/api/products/${id}/preference`, { preference }),

  meals: () => request<{ meals: Meal[] }>('GET', '/api/meals'),
  addMeal: (name: string) => request<{ meals: Meal[] }>('POST', '/api/meals', { name }),
  updateMeal: (id: number, name: string, hidden: boolean) => request<{ meals: Meal[] }>('PUT', `/api/meals/${id}`, { name, hidden }),

  day: (day: string) => request<DiaryDay>('GET', `/api/diary/${day}`),
  copy: (body: { from: string; to: string; mealId?: number | null; toMealId?: number | null }) => request<DiaryDay>('POST', '/api/diary/copy', body),

  target: (day: string) => request<TargetResponse>('GET', `/api/targets/${day}`),
  setMark: (day: string, mark: Partial<DayMark>) => request<TargetResponse>('PUT', `/api/days/${day}/mark`, mark),
  bodyWeights: () => request<{ entries: BodyWeightEntry[] }>('GET', '/api/body-weights'),
  logBodyWeight: (weightKg: number, date?: string) => request<{ entries: BodyWeightEntry[] }>('POST', '/api/body-weights', { weightKg, date }),
  deleteBodyWeight: (id: number) => request<{ entries: BodyWeightEntry[] }>('DELETE', `/api/body-weights/${id}`),
  progress: (days = 56) => request<ProgressResponse>('GET', `/api/progress?days=${days}`),

  importJson: (data: unknown) => request<{ ok: true }>('POST', '/api/import/json', data),
  /** The NEVO file as downloaded (CSV or zip), sent as is. */
  importNevo: async (file: File) => {
    let res: Response;
    try {
      res = await fetch(`/api/nevo/import?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      });
    } catch {
      throw new ApiError(t('No connection to the server', 'Geen verbinding met de server'), 0);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(data?.error ?? t(`Request failed (${res.status})`, `Verzoek mislukt (${res.status})`), res.status);
    return data as { nevo: { version: string; count: number } };
  },
};

// ---------------------------------------------------------------------------
// Diary sync queue. Changes are saved on the device first (IndexedDB, see offlineStore.ts) and pushed to the
// server; failed pushes stay queued and are retried, so logging works without a connection.

/** A random UUID; crypto.randomUUID only exists on secure origins, so fall back to getRandomValues. */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const listeners = new Set<() => void>();

/** Called whenever the queue changes or a flush finished, so screens can show the latest state. */
export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const notify = () => listeners.forEach((fn) => fn());

export function pendingCount(): number {
  return pendingAll().length;
}

/** The server's day with what is still queued on this device laid over it. */
export function withPending(day: DiaryDay): DiaryDay & { pendingIds: Set<string> } {
  const byId = new Map(day.entries.map((e) => [e.id, e]));
  const pendingIds = new Set<string>();
  for (const op of pendingAll()) {
    if (op.kind === 'delete') {
      byId.delete(op.id);
    } else if (op.preview.day === day.day) {
      byId.set(op.id, op.preview);
      pendingIds.add(op.id);
    } else {
      byId.delete(op.id); // moved to another day
    }
  }
  const entries = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { ...day, entries, totals: sumNutrients(entries.map((e) => e.nutrients)), pendingIds };
}

let flushing: Promise<void> | null = null;

export function flushQueue(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const op of pendingAll()) {
      try {
        if (op.kind === 'put') await request('PUT', `/api/diary/entries/${op.id}`, op.input);
        else await request('DELETE', `/api/diary/entries/${op.id}`);
        // Only remove it if it wasn't changed again while we were sending.
        if (JSON.stringify(getPending(op.id)) === JSON.stringify(op)) await deletePending(op.id);
      } catch (err) {
        if (err instanceof ApiError && err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status)) {
          // The server rejected it for good (e.g. the meal no longer exists): drop it, or it blocks the queue.
          await deletePending(op.id);
          continue;
        }
        break; // offline or a server error: keep everything, retry later
      }
    }
  })().finally(() => {
    flushing = null;
    notify();
  });
  return flushing;
}

async function enqueue(op: PendingOp): Promise<void> {
  await putPending(op);
  notify();
  void flushQueue();
}

/** Logs or changes an entry: shown right away, sent when there is a connection. */
export function saveEntry(input: EntryInput, preview: DiaryEntry): Promise<void> {
  return enqueue({ kind: 'put', id: preview.id, input, preview });
}

export function removeEntry(id: string, day: string): Promise<void> {
  return enqueue({ kind: 'delete', id, day });
}

window.addEventListener('online', () => void flushQueue());
setInterval(() => {
  if (pendingCount() > 0) void flushQueue();
}, 15_000);
