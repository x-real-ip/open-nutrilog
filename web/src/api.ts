import type { AppInfo, Profile } from '@shared/types.ts';
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

  importJson: (data: unknown) => request<{ ok: true }>('POST', '/api/import/json', data),
};
