// Reminders through Web Push, as in Open Strength: this device asks permission and registers with the server, which
// pushes the reminders at the times set in the profile.
import { api } from './api.ts';

const ENDPOINT_KEY = 'nutrilog-push-endpoint';

export type PushSupport = 'supported' | 'unsupported' | 'install-first';

/** iPhone and iPad only allow web push for an app added to the home screen. */
export function pushSupport(): PushSupport {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !standalone) return 'install-first';
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window ? 'supported' : 'unsupported';
}

function storedEndpoint(): string | null {
  try {
    return localStorage.getItem(ENDPOINT_KEY);
  } catch {
    return null;
  }
}

function storeEndpoint(endpoint: string | null) {
  try {
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
  } catch {
    // The server still has the subscription; this device just forgets it is on.
  }
}

/** Whether this device gets the reminders. */
export function notificationsOn(): boolean {
  return pushSupport() === 'supported' && Notification.permission === 'granted' && storedEndpoint() !== null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask permission (must run from a tap) and register this device. Returns false when refused. */
export async function enableNotifications(): Promise<boolean> {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const sub =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.pushSubscribe(sub.toJSON());
  storeEndpoint(sub.endpoint);
  return true;
}

export async function disableNotifications(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint);
    await sub.unsubscribe();
  }
  storeEndpoint(null);
}
