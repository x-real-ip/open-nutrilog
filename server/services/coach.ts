// The nutrition coach: a chat that gets your real nutrition data and, when linked, your training from Open Strength.
// It may explain targets and suggest a different phase or pace, but never sets targets: a suggestion goes through the
// target engine and needs your confirmation (the "Apply" button). Without AI it shows the facts.
import { z } from 'zod';
import type { CoachMessage, PhaseSuggestion, Profile } from '../../shared/types.ts';
import { all, nowIso, one, run } from '../db.ts';
import { AI_LANGUAGE, formatNumber, langOf, type Lang } from '../i18n.ts';
import { complete } from './ai.ts';
import { aiConfigured } from './aiSettings.ts';
import { daySummaries, progress, targetFor } from './dayTargets.ts';
import { addDays, today } from './days.ts';
import { timeZoneOf } from './profile.ts';
import { linked, strengthProfile, strengthWorkouts } from './strength.ts';

export const suggestionSchema = z.object({ phase: z.enum(['cut', 'maintain', 'bulk']), ratePctPerWeek: z.number().min(0).max(1) }).strict();

function toMessage(r: any): CoachMessage {
  return { id: r.id, role: r.role, content: r.content, suggestion: r.suggestion ?? null, createdAt: r.created_at };
}

export async function listMessages(limit = 100): Promise<CoachMessage[]> {
  const rows = await all('SELECT * FROM coach_messages ORDER BY id DESC LIMIT $1', [limit]);
  return rows.reverse().map(toMessage);
}

async function addMessage(role: 'user' | 'assistant', content: string, suggestion: PhaseSuggestion | null = null): Promise<CoachMessage> {
  const row = await one('INSERT INTO coach_messages (role, content, suggestion, created_at) VALUES ($1, $2, $3, $4) RETURNING *', [
    role,
    content,
    suggestion ? JSON.stringify(suggestion) : null,
    nowIso(),
  ]);
  return toMessage(row);
}

export async function clearMessages() {
  await run('DELETE FROM coach_messages');
}

/** Facts from your data, in your language: the AI's context, and the answer when there is no AI. */
export async function nutritionFacts(profile: Profile | null): Promise<string> {
  const lang: Lang = langOf(profile);
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);
  const n = (v: number, d = 1) => formatNumber(v, lang, d);
  const now = today(timeZoneOf(profile));
  const lines: string[] = [];
  const t = await targetFor(now);
  if (!t.target) {
    lines.push(T('No target yet: sex, age, height or weight is missing in the profile.', 'Nog geen doel: geslacht, leeftijd, lengte of gewicht ontbreekt in het profiel.'));
  } else {
    const g = t.target;
    lines.push(
      T(
        `Today's target: ${g.kcal} kcal (protein ${g.proteinG} g, carbohydrates ${g.carbsG} g, fat ${g.fatG} g)${g.isTrainingDay ? `, a training day (+${g.workoutKcal} kcal)` : ', a rest day'}.`,
        `Doel vandaag: ${g.kcal} kcal (eiwit ${g.proteinG} g, koolhydraten ${g.carbsG} g, vet ${g.fatG} g)${g.isTrainingDay ? `, een trainingsdag (+${g.workoutKcal} kcal)` : ', een rustdag'}.`,
      ),
    );
    lines.push(T('How it is built:', 'Hoe het is opgebouwd:'));
    for (const s of g.steps) lines.push(`- ${s.text}`);
  }
  if (profile) {
    const phase = { cut: T('losing fat', 'afvallen'), maintain: T('maintaining', 'op gewicht blijven'), bulk: T('building', 'aankomen') }[profile.phase];
    lines.push(T(`Phase: ${phase}${profile.phase === 'maintain' ? '' : `, ${n(profile.ratePctPerWeek, 2)} % a week`}.`, `Fase: ${phase}${profile.phase === 'maintain' ? '' : `, ${n(profile.ratePctPerWeek, 2)} % per week`}.`));
  }
  if (t.adaptive) lines.push(t.adaptive.text);

  // The last 14 complete days.
  const { days } = await daySummaries(addDays(now, -14), addDays(now, -1));
  const done = days.filter((d) => d.logged && !d.incomplete);
  if (done.length) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const withTarget = done.filter((d) => d.targetKcal !== null);
    const kcal = avg(done.map((d) => d.kcal));
    const target = withTarget.length ? avg(withTarget.map((d) => d.targetKcal!)) : null;
    const protein = done.filter((d) => d.weightKg).map((d) => d.proteinG / d.weightKg!);
    lines.push(
      T(
        `Last 14 days: ${done.length} complete days logged, on average ${Math.round(kcal)} kcal${target ? ` against a target of ${Math.round(target)}` : ''}${protein.length ? `, ${n(avg(protein))} g protein per kg` : ''}.`,
        `Laatste 14 dagen: ${done.length} complete dagen gelogd, gemiddeld ${Math.round(kcal)} kcal${target ? ` tegen een doel van ${Math.round(target)}` : ''}${protein.length ? `, ${n(avg(protein))} g eiwit per kg` : ''}.`,
      ),
    );
  } else {
    lines.push(T('No complete days logged in the last 14 days.', 'De laatste 14 dagen geen complete dagen gelogd.'));
  }
  const p = await progress(28);
  const latest = p.weights.at(-1);
  if (latest) {
    lines.push(
      T(
        `Trend weight ${n(latest.trendKg)} kg${p.weeklyChangeKg !== null ? `, ${p.weeklyChangeKg >= 0 ? '+' : ''}${n(p.weeklyChangeKg, 2)} kg a week` : ''}.`,
        `Trendgewicht ${n(latest.trendKg)} kg${p.weeklyChangeKg !== null ? `, ${p.weeklyChangeKg >= 0 ? '+' : ''}${n(p.weeklyChangeKg, 2)} kg per week` : ''}.`,
      ),
    );
  }

  // Training, from Open Strength when linked.
  if (linked()) {
    const [sp, workouts] = await Promise.all([strengthProfile(), strengthWorkouts(addDays(now, -14), now)]);
    if (sp) {
      const goal = { hypertrophy: T('muscle growth', 'spiermassa'), strength: T('strength', 'kracht'), conditioning: T('conditioning', 'conditie'), fat_loss: T('fat loss', 'vetverlies') }[sp.goal];
      const minutes = workouts.reduce((a, w) => a + w.durationMinutes, 0);
      lines.push(
        T(
          `Training (Open Strength): goal ${goal}, level ${sp.level}; ${workouts.length} workouts in the last 14 days, ${minutes} minutes in total.`,
          `Training (Open Strength): doel ${goal}, niveau ${sp.level}; ${workouts.length} trainingen in de laatste 14 dagen, samen ${minutes} minuten.`,
        ),
      );
    }
  }
  return lines.join('\n');
}

async function systemPrompt(profile: Profile | null): Promise<string> {
  return `You are a knowledgeable, practical nutrition coach inside a food diary app. You look at the user's real data below and help with eating for their goal, alongside strength training.

Rules:
- Base every statement about the user's intake and progress on the data below. If the data is insufficient, say so.
- You do not set targets. The app's target engine works them out from fixed rules; explain them when asked, never invent different numbers.
- You may suggest a different phase or pace (cut at most 1 % of body weight a week, bulk at most 0.5 %). When you do, end your answer with exactly one line:
  SUGGESTION {"phase":"cut|maintain|bulk","ratePctPerWeek":0.5}
  The user can then apply it; the app recalculates the targets and asks for confirmation. Leave the line out when you don't suggest a change.
- Keep answers short and structured for a phone screen.
- Not a doctor or dietitian: for medical conditions, eating disorders or pregnancy, advise seeing a professional.
- Reply in ${AI_LANGUAGE[langOf(profile)]} unless the user's latest message is clearly in another language.

USER DATA
${await nutritionFacts(profile)}`;
}

/** The SUGGESTION line, if the answer has a valid one; and the answer without it. */
export function splitSuggestion(reply: string): { text: string; suggestion: PhaseSuggestion | null } {
  const m = /^\s*SUGGESTION\s*(\{.*\})\s*$/m.exec(reply);
  if (!m) return { text: reply.trim(), suggestion: null };
  let suggestion: PhaseSuggestion | null = null;
  try {
    const parsed = suggestionSchema.safeParse(JSON.parse(m[1]));
    if (parsed.success) suggestion = parsed.data.phase === 'maintain' ? { phase: 'maintain', ratePctPerWeek: 0 } : parsed.data;
  } catch {
    suggestion = null;
  }
  return { text: reply.replace(m[0], '').trim(), suggestion };
}

export async function sendMessage(content: string, profile: Profile | null): Promise<CoachMessage[]> {
  const user = await addMessage('user', content.trim().slice(0, 4000));
  if (!aiConfigured()) {
    const facts = await nutritionFacts(profile);
    const reply =
      langOf(profile) === 'nl'
        ? `AI staat uit, dus hier zijn de feiten uit je gegevens:\n\n${facts}\n\nZet AI aan via Profiel → AI-instellingen voor een geschreven analyse en antwoord op je vragen.`
        : `AI is off, so here are the facts from your data:\n\n${facts}\n\nTurn on AI in Profile → AI settings for a written analysis and answers to your questions.`;
    return [user, await addMessage('assistant', reply)];
  }
  const history = (await listMessages(12)).map((m) => ({ role: m.role, content: m.content }));
  while (history.length && history[0].role !== 'user') history.shift();
  let reply: string;
  try {
    reply = await complete({ feature: 'coach', system: await systemPrompt(profile), messages: history, maxTokens: 4000 });
  } catch (err) {
    // Remove the unanswered question so a retry doesn't leave two user turns in a row.
    await run('DELETE FROM coach_messages WHERE id = $1', [user.id]);
    throw err;
  }
  const { text, suggestion } = splitSuggestion(reply);
  return [user, await addMessage('assistant', text, suggestion)];
}
