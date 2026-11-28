import { useEffect, useRef, useState } from 'react';
import type { EntryInput, MealLine, MealProposal, Product } from '@shared/types.ts';
import { scale } from '@shared/nutrition.ts';
import { api, newId, saveEntry } from '../api.ts';
import { useInfo } from '../App.tsx';
import { parseNumber, previewEntry } from '../food.ts';
import { kcal, num } from '../format.ts';
import { t } from '../i18n.ts';
import { SourceBadge } from './AddFoodSheet.tsx';
import { Sheet, toast } from './ui.tsx';

/** A photo scaled down in the browser (longest side 1024 px, JPEG) before it is sent anywhere. */
async function resizePhoto(file: File, max = 1024): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const f = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * f);
  canvas.height = Math.round(bitmap.height * f);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** What a line logs: a product, the AI's own estimate, or nothing. */
type Choice = { kind: 'product'; product: Product } | { kind: 'estimate' } | { kind: 'skip' };

interface Row {
  line: MealLine;
  grams: string;
  choice: Choice;
}

function initialChoice(line: MealLine): Choice {
  if (line.candidates[0]) return { kind: 'product', product: line.candidates[0] };
  return line.estimate ? { kind: 'estimate' } : { kind: 'skip' };
}

/** kcal for a row as it would be logged. */
function rowKcal(r: Row): number {
  const g = parseNumber(r.grams) ?? 0;
  if (r.choice.kind === 'product') return scale(r.choice.product.per100, g).kcal;
  if (r.choice.kind === 'estimate' && r.line.estimate) return (r.line.estimate.kcal * g) / Math.max(1, r.line.grams);
  return 0;
}

/**
 * Describe or photograph a meal. The AI lists foods and amounts, the server matches them to products here, and you
 * confirm each line (another match, another amount, the AI's estimate, or skip) before anything is logged.
 */
export function MealAiSheet({ open, mode, day, mealId, mealName, onClose }: { open: boolean; mode: 'text' | 'photo'; day: string; mealId: number; mealName: string; onClose: () => void }) {
  const info = useInfo();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setPhoto(null);
    setRows(null);
  }, [open, mode]);

  const read = async () => {
    setBusy(true);
    try {
      const proposal: MealProposal = mode === 'text' ? await api.mealFromText(text) : await api.mealFromPhoto(photo!, text);
      if (!proposal.lines.length) toast(t('No food found. Try describing it differently.', 'Geen eten gevonden. Probeer het anders te beschrijven.'));
      setRows(proposal.lines.map((line) => ({ line, grams: String(line.grams), choice: initialChoice(line) })));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickPhoto = async (file: File) => {
    try {
      setPhoto(await resizePhoto(file));
    } catch {
      toast(t('This photo could not be opened.', 'Deze foto kon niet worden geopend.'));
    }
  };

  const logAll = async () => {
    if (!rows) return;
    let n = 0;
    for (const r of rows) {
      const g = parseNumber(r.grams);
      if (!g || g <= 0 || r.choice.kind === 'skip') continue;
      const id = newId();
      if (r.choice.kind === 'product') {
        const p = r.choice.product;
        const input: EntryInput = { day, mealId, productId: p.id, amount: g, unit: p.unit };
        await saveEntry(input, previewEntry(id, input, p));
      } else if (r.line.estimate) {
        // The AI's estimate was for its own amount; a changed amount scales it.
        const f = g / Math.max(1, r.line.grams);
        const e = r.line.estimate;
        const k = Math.round(e.kcal * f);
        const s = (x: number | null) => (x === null ? null : Math.round(x * f * 10) / 10);
        const input: EntryInput = { day, mealId, productId: null, amount: Math.max(k, 0.1), unit: 'kcal', quick: { name: r.line.name, kcal: k, protein: s(e.protein), carbs: s(e.carbs), fat: s(e.fat), aiEstimate: true } };
        const preview = previewEntry(id, input, null);
        await saveEntry(input, { ...preview, aiEstimate: true });
      }
      n++;
    }
    toast(t(`${n} logged`, `${n} gelogd`));
    onClose();
  };

  const total = rows ? rows.reduce((a, r) => a + rowKcal(r), 0) : 0;
  const count = rows ? rows.filter((r) => r.choice.kind !== 'skip' && (parseNumber(r.grams) ?? 0) > 0).length : 0;
  const title = mode === 'text' ? t('Describe a meal', 'Maaltijd beschrijven') : t('Photo of a meal', 'Foto van een maaltijd');

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{title}</h2>
        {!rows ? (
          <>
            {mode === 'photo' && (
              <>
                <p className="notice small" style={{ margin: 0 }}>
                  {t(
                    `The photo is sent to your AI provider (${info.aiModel}) to be read. Portions are estimates you can change.`,
                    `De foto wordt naar je AI-aanbieder (${info.aiModel}) gestuurd om te lezen. Porties zijn schattingen die je kunt aanpassen.`,
                  )}
                </p>
                {photo ? (
                  <img className="meal-photo" src={photo} alt={t('Your photo', 'Je foto')} />
                ) : null}
                <button className="btn block" onClick={() => fileRef.current?.click()}>
                  {photo ? t('Another photo', 'Andere foto') : t('Take or choose a photo', 'Foto maken of kiezen')}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  hidden
                  aria-label={t('Meal photo', 'Maaltijdfoto')}
                  onChange={(e) => e.target.files?.[0] && void pickPhoto(e.target.files[0])}
                />
              </>
            )}
            <label className="field">
              <span>{mode === 'text' ? t(`What did you eat for ${mealName.toLowerCase()}?`, `Wat at je bij ${mealName.toLowerCase()}?`) : t('Note (optional)', 'Toelichting (optioneel)')}</span>
              <textarea
                className="textarea"
                rows={mode === 'text' ? 3 : 2}
                maxLength={mode === 'text' ? 1000 : 500}
                placeholder={mode === 'text' ? t('2 slices of wholemeal bread with cheese and an apple', '2 sneetjes volkorenbrood met kaas en een appel') : ''}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <button className="btn primary big block" disabled={busy || (mode === 'text' ? text.trim().length < 2 : !photo)} onClick={() => void read()}>
              {busy ? t('Reading…', 'Lezen…') : t('Read', 'Lezen')}
            </button>
          </>
        ) : (
          <>
            <p className="faint small" style={{ margin: 0 }}>
              {t('Check every line: the match, the amount, or skip it. Nothing is logged until you confirm.', 'Controleer elke regel: de match, de hoeveelheid, of sla hem over. Er wordt niets gelogd tot je bevestigt.')}
            </p>
            <div className="list">
              {rows.map((r, i) => (
                <div className="list-row meal-line" key={i} aria-label={r.line.name}>
                  <div className="grow stack" style={{ gap: 8 }}>
                    <div className="spread">
                      <div className="title">{r.line.name}</div>
                      <span className="num muted">{r.choice.kind === 'skip' ? '–' : kcal(rowKcal(r))}</span>
                    </div>
                    <div className="row">
                      <input
                        className="input num"
                        style={{ maxWidth: 100, minHeight: 44 }}
                        inputMode="decimal"
                        aria-label={t(`Grams of ${r.line.name}`, `Gram ${r.line.name}`)}
                        value={r.grams}
                        onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))}
                      />
                      <span className="muted">g</span>
                    </div>
                    <div className="chips">
                      {r.line.candidates.map((p) => (
                        <button
                          key={p.id}
                          aria-pressed={r.choice.kind === 'product' && r.choice.product.id === p.id}
                          onClick={() => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, choice: { kind: 'product', product: p } } : x)))}
                        >
                          {p.name}
                          {p.brand ? ` · ${p.brand}` : ''} <SourceBadge source={p.source} />
                        </button>
                      ))}
                      {r.line.estimate && (
                        <button aria-pressed={r.choice.kind === 'estimate'} onClick={() => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, choice: { kind: 'estimate' } } : x)))}>
                          {t('AI estimate', 'AI-schatting')} · {num(r.line.estimate.kcal, 0)} kcal
                        </button>
                      )}
                      <button aria-pressed={r.choice.kind === 'skip'} onClick={() => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, choice: { kind: 'skip' } } : x)))}>
                        {t('Skip', 'Overslaan')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn primary big block" disabled={count === 0} onClick={() => void logAll()}>
              {t(`Log ${count} · ${kcal(total)}`, `${count} loggen · ${kcal(total)}`)}
            </button>
            <button className="btn block" onClick={() => setRows(null)}>
              {t('Start again', 'Opnieuw')}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
