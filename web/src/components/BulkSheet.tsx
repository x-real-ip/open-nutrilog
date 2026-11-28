import { useEffect, useState } from 'react';
import type { Meal } from '@shared/types.ts';
import { api, flushQueue, isPending } from '../api.ts';
import { addDaysTo, chipDate, dayLabel } from '../format.ts';
import { t } from '../i18n.ts';
import { Sheet, toast } from './ui.tsx';

/** What to move or copy: picked entries of the day, or a whole meal. */
export type BulkScope = { entryIds: string[]; mealId?: undefined } | { mealId: number; entryIds?: undefined };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AHEAD = 14;

/** Moves entries to another meal or day, or copies them (or a whole meal) to one or more days. */
export function BulkSheet({
  open,
  mode,
  scope,
  count,
  day,
  today,
  meals,
  onClose,
  onDone,
}: {
  open: boolean;
  mode: 'move' | 'copy';
  scope: BulkScope | null;
  count: number;
  day: string;
  today: string;
  meals: Meal[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [mealId, setMealId] = useState<number | null>(null);
  const [toDay, setToDay] = useState(day);
  const [days, setDays] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMealId(null);
    setToDay(day);
    setDays([]);
    setOther('');
  }, [open, day, mode]);

  if (!scope) return null;

  const ahead = Array.from({ length: AHEAD }, (_, i) => addDaysTo(day, i + 1));
  const week = ahead.slice(0, 7);
  const extra = days.filter((d) => !ahead.includes(d));
  const toggleDay = (d: string) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  const wholeWeek = week.every((d) => days.includes(d));
  const visible = meals.filter((m) => !m.hidden);
  const label = (d: string) => (Math.abs(Date.parse(d) - Date.parse(today)) <= 86_400_000 ? dayLabel(d, today) : chipDate(d));

  const ready = mode === 'copy' ? days.length > 0 : mealId !== null || toDay !== day;

  const submit = async () => {
    setBusy(true);
    try {
      // Entries logged on this device have to reach the server first.
      await flushQueue();
      if (scope.entryIds?.some(isPending)) {
        toast(
          t(
            'Some items aren’t synced yet. Try again when you’re online.',
            'Sommige items zijn nog niet gesynchroniseerd. Probeer het opnieuw als je online bent.',
          ),
        );
        return;
      }
      if (mode === 'move') {
        const { moved } = await api.move({
          entryIds: scope.entryIds!,
          day: toDay === day ? null : toDay,
          mealId,
        });
        toast(t(`Moved ${moved} ${moved === 1 ? 'item' : 'items'}`, `${moved} ${moved === 1 ? 'item' : 'items'} verplaatst`));
      } else {
        await api.copy({
          from: day,
          days,
          toMealId: mealId,
          ...(scope.mealId ? { mealId: scope.mealId } : { entryIds: scope.entryIds }),
        });
        toast(t(`Copied to ${days.length} ${days.length === 1 ? 'day' : 'days'}`, `Gekopieerd naar ${days.length} ${days.length === 1 ? 'dag' : 'dagen'}`));
      }
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'move'
      ? t(`Move ${count} ${count === 1 ? 'item' : 'items'}`, `${count} ${count === 1 ? 'item' : 'items'} verplaatsen`)
      : t(`Copy ${count} ${count === 1 ? 'item' : 'items'}`, `${count} ${count === 1 ? 'item' : 'items'} kopiëren`);

  return (
    <Sheet open={open} onClose={onClose} label={title}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{title}</h2>

        {mode === 'copy' ? (
          <div className="field" role="group" aria-label={t('To which days', 'Naar welke dagen')}>
            <span>{t('To which days', 'Naar welke dagen')}</span>
            <div className="chips wrap">
              <button
                type="button"
                aria-pressed={wholeWeek}
                onClick={() => setDays((cur) => (wholeWeek ? cur.filter((d) => !week.includes(d)) : [...new Set([...cur, ...week])].sort()))}
              >
                {t('Next 7 days', 'Komende 7 dagen')}
              </button>
              {ahead.map((d) => (
                <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>
                  {label(d)}
                </button>
              ))}
              {extra.map((d) => (
                <button key={d} type="button" aria-pressed onClick={() => toggleDay(d)}>
                  {chipDate(d)}
                </button>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" type="date" aria-label={t('Another day', 'Andere dag')} value={other} onChange={(e) => setOther(e.target.value)} />
              <button
                type="button"
                className="btn small-btn"
                disabled={!DAY.test(other) || days.includes(other)}
                onClick={() => (toggleDay(other), setOther(''))}
              >
                {t('Add', 'Toevoegen')}
              </button>
            </div>
          </div>
        ) : (
          <div className="field" role="group" aria-label={t('To which day', 'Naar welke dag')}>
            <span>{t('To which day', 'Naar welke dag')}</span>
            <div className="chips wrap">
              {[addDaysTo(day, -1), day, addDaysTo(day, 1)].map((d) => (
                <button key={d} type="button" aria-pressed={toDay === d} onClick={() => setToDay(d)}>
                  {d === day ? t('Same day', 'Zelfde dag') : label(d)}
                </button>
              ))}
            </div>
            <input
              className="input"
              type="date"
              aria-label={t('Another day', 'Andere dag')}
              value={toDay}
              onChange={(e) => DAY.test(e.target.value) && setToDay(e.target.value)}
            />
          </div>
        )}

        <div className="field" role="group" aria-label={t('Into which meal', 'In welke maaltijd')}>
          <span>{t('Into which meal', 'In welke maaltijd')}</span>
          <div className="chips wrap">
            <button type="button" aria-pressed={mealId === null} onClick={() => setMealId(null)}>
              {t('Same meal', 'Zelfde maaltijd')}
            </button>
            {visible.map((m) => (
              <button key={m.id} type="button" aria-pressed={mealId === m.id} onClick={() => setMealId(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
        </div>

        <button className="btn primary block" disabled={busy || !ready} onClick={() => void submit()}>
          {mode === 'move'
            ? t('Move', 'Verplaatsen')
            : days.length
              ? t(`Copy to ${days.length} ${days.length === 1 ? 'day' : 'days'}`, `Kopiëren naar ${days.length} ${days.length === 1 ? 'dag' : 'dagen'}`)
              : t('Copy', 'Kopiëren')}
        </button>
      </div>
    </Sheet>
  );
}
