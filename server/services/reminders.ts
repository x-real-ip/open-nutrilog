// Reminders by push, checked every minute: a meal with nothing logged at its time, no weigh-in yet at the weigh-in
// time, and a summary of the day in the evening. Times are in the profile's time zone. Each reminder goes out at most
// once a day (claimed in the settings table, so a restart or a second replica doesn't send it twice), and only within
// half an hour of its time, so a server that was down doesn't send a pile of old reminders.
import { one, run } from '../db.ts';
import { langOf, pick, type Lang } from '../i18n.ts';
import { targetFor } from './dayTargets.ts';
import { dayOf, timeOf } from './days.ts';
import { getDay } from './diary.ts';
import { getProfile, timeZoneOf } from './profile.ts';
import { pushAll, subscriptionCount, type PushMessage } from './push.ts';

/** How long after its time a reminder may still go out. */
const WINDOW_MIN = 30;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `time` has come within the window. */
export function isDue(time: string, now: string): boolean {
  const d = minutes(now) - minutes(time);
  return d >= 0 && d < WINDOW_MIN;
}

/** Claims a reminder for the day; false when it already went (or was skipped) today. */
async function claim(key: string, day: string): Promise<boolean> {
  const row = await one(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE settings.value <> excluded.value
     RETURNING key`,
    [`reminder:${key}`, day],
  );
  return Boolean(row);
}

const L = (lang: Lang, en: string, nl: string) => (lang === 'nl' ? nl : en);

/** Checks every reminder for the moment `now`; returns what was pushed (for tests and the log). */
export async function checkReminders(now: Date = new Date()): Promise<PushMessage[]> {
  const p = await getProfile();
  if (!p || (await subscriptionCount()) === 0) return [];
  const r = p.reminders;
  if (!r.meals.length && !r.weighIn && !r.summary) return [];
  const tz = timeZoneOf(p);
  const day = dayOf(now, tz);
  const clock = timeOf(now, tz);
  const lang = langOf(p);
  const out: PushMessage[] = [];
  const send = async (m: PushMessage) => {
    if ((await pushAll(m)) > 0) out.push(m);
  };

  for (const m of r.meals) {
    if (!isDue(m.time, clock) || !(await claim(`meal:${m.mealId}`, day))) continue;
    const meal = await one<{ name: string; hidden: boolean }>('SELECT name, hidden FROM meals WHERE id = $1', [m.mealId]);
    if (!meal || meal.hidden) continue;
    const logged = await one('SELECT 1 FROM diary_entries WHERE day = $1 AND meal_id = $2 LIMIT 1', [day, m.mealId]);
    if (logged) continue;
    const name = pick(meal.name, lang);
    await send({ title: name, body: L(lang, `Nothing logged for ${name.toLowerCase()} yet. Tap to add it.`, `Nog niets gelogd bij ${name.toLowerCase()}. Tik om het toe te voegen.`), tag: `meal-${m.mealId}`, url: '/diary' });
  }

  if (r.weighIn && isDue(r.weighIn, clock) && (await claim('weigh-in', day))) {
    const weighed = await one('SELECT 1 FROM body_weights WHERE measured_on = $1', [day]);
    if (!weighed) await send({ title: L(lang, 'Weigh-in', 'Wegen'), body: L(lang, 'You haven’t weighed yourself today.', 'Je hebt je vandaag nog niet gewogen.'), tag: 'weigh-in', url: '/progress' });
  }

  if (r.summary && isDue(r.summary, clock) && (await claim('summary', day))) {
    const eaten = await getDay(day, lang);
    const target = (await targetFor(day)).target;
    const kcal = Math.round(eaten.totals.kcal);
    const protein = Math.round(eaten.totals.protein);
    const body = !eaten.entries.length
      ? L(lang, 'Nothing logged today. Tap to catch up.', 'Vandaag nog niets gelogd. Tik om bij te werken.')
      : target
        ? L(lang, `${kcal} of ${target.kcal} kcal · protein ${protein} of ${target.proteinG} g`, `${kcal} van ${target.kcal} kcal · eiwit ${protein} van ${target.proteinG} g`)
        : L(lang, `${kcal} kcal · protein ${protein} g`, `${kcal} kcal · eiwit ${protein} g`);
    await send({ title: L(lang, 'Your day', 'Je dag'), body, tag: 'summary', url: '/' });
  }
  return out;
}

let timer: NodeJS.Timeout | null = null;

/** Checks every minute; never keeps the process alive and never throws. */
export function startReminders(log: (msg: string) => void = console.error): void {
  if (timer) return;
  timer = setInterval(() => {
    checkReminders().catch((err) => log(`Reminders failed: ${(err as Error).message}`));
  }, 60_000);
  timer.unref();
}

/** For tests: forget what was sent today. */
export async function resetReminderClaims(): Promise<void> {
  await run(`DELETE FROM settings WHERE key LIKE 'reminder:%'`);
}
