// Web Push, as in Open Strength. VAPID keys are made once and kept in the settings table. Each device's
// subscription is a settings row too (`push:<hash of the endpoint>`): they belong to devices, not to your data, so
// they stay out of exports like the rest of the settings.
import crypto from 'node:crypto';
import webpush, { type PushSubscription } from 'web-push';
import { config } from '../config.ts';
import { all, ensureSetting, run } from '../db.ts';

interface Vapid {
  publicKey: string;
  privateKey: string;
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  /** Where tapping the notification goes. */
  url?: string;
}

/** Sends one push; replaceable in tests. Resolves with the HTTP status of the push service. */
export type PushSender = (subscription: PushSubscription, payload: string) => Promise<number>;

let vapid: Vapid | null = null;
let sender: PushSender = async (subscription, payload) => {
  // A reminder that arrives hours late is no use: let the push service drop it after an hour.
  const res = await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'normal' });
  return res.statusCode;
};

export function setPushSender(fn: PushSender) {
  sender = fn;
}

async function ensurePush(): Promise<Vapid> {
  if (vapid) return vapid;
  const fresh = webpush.generateVAPIDKeys();
  vapid = JSON.parse(await ensureSetting('vapid', JSON.stringify(fresh))) as Vapid;
  // The subject identifies the sender to push services: the app's URL, or a mailto fallback.
  const subject = config.publicUrl.startsWith('https://') ? config.publicUrl : 'mailto:open-nutrilog@localhost';
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
  return vapid;
}

export async function publicKey(): Promise<string> {
  return (await ensurePush()).publicKey;
}

const keyOf = (endpoint: string) => `push:${crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32)}`;

export async function saveSubscription(sub: PushSubscription): Promise<void> {
  await run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [keyOf(sub.endpoint), JSON.stringify(sub)]);
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await run('DELETE FROM settings WHERE key = $1', [keyOf(endpoint)]);
}

export async function subscriptionCount(): Promise<number> {
  return (await all(`SELECT 1 FROM settings WHERE key LIKE 'push:%'`)).length;
}

/** Push to every registered device; subscriptions the push service no longer knows are removed. */
export async function pushAll(message: PushMessage): Promise<number> {
  await ensurePush();
  const subs = (await all<{ value: string }>(`SELECT value FROM settings WHERE key LIKE 'push:%'`)).map((r) => JSON.parse(r.value) as PushSubscription);
  let sent = 0;
  for (const s of subs) {
    try {
      await sender(s, JSON.stringify(message));
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await deleteSubscription(s.endpoint);
      else console.error('Push failed:', (err as Error).message);
    }
  }
  return sent;
}
