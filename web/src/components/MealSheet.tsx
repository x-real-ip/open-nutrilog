import { useEffect, useState } from 'react';
import type { Meal } from '@shared/types.ts';
import { api } from '../api.ts';
import { addDaysTo, dayLabel } from '../format.ts';
import { t } from '../i18n.ts';
import { Sheet, toast } from './ui.tsx';

/** A meal's menu: copy it to or from another day, rename it, or hide it. */
export function MealSheet({
  open,
  meal,
  day,
  today,
  hasEntries,
  onClose,
  onChanged,
}: {
  open: boolean;
  meal: Meal | null;
  day: string;
  today: string;
  hasEntries: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && meal) setName(meal.name);
  }, [open, meal]);

  if (!meal) return null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const yesterday = addDaysTo(day, -1);

  return (
    <Sheet open={open} onClose={onClose} label={meal.name}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{meal.name}</h2>
        <div className="list">
          <button
            className="list-row"
            disabled={busy}
            onClick={() => void run(() => api.copy({ from: yesterday, to: day, mealId: meal.id, toMealId: meal.id }), t('Copied', 'Gekopieerd'))}
          >
            <div className="grow">
              <div className="title">{t(`Copy from ${dayLabel(yesterday, today).toLowerCase()}`, `Kopiëren van ${dayLabel(yesterday, today).toLowerCase()}`)}</div>
              <div className="sub">{t('The same meal of the day before', 'Dezelfde maaltijd van de dag ervoor')}</div>
            </div>
          </button>
          {hasEntries && day !== today && (
            <button
              className="list-row"
              disabled={busy}
              onClick={() => void run(() => api.copy({ from: day, to: today, mealId: meal.id, toMealId: meal.id }), t('Copied to today', 'Gekopieerd naar vandaag'))}
            >
              <div className="grow">
                <div className="title">{t('Copy to today', 'Kopiëren naar vandaag')}</div>
              </div>
            </button>
          )}
        </div>

        <label className="field">
          <span>{t('Name', 'Naam')}</span>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2">
          <button
            className="btn"
            disabled={busy || !name.trim()}
            onClick={() => void run(() => api.updateMeal(meal.id, name.trim(), meal.hidden), t('Meal saved', 'Maaltijd opgeslagen'))}
          >
            {t('Rename', 'Hernoemen')}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.updateMeal(meal.id, meal.name, !meal.hidden),
                meal.hidden ? t('Meal shown again', 'Maaltijd weer zichtbaar') : t('Meal hidden', 'Maaltijd verborgen'),
              )
            }
          >
            {meal.hidden ? t('Show again', 'Weer tonen') : t('Hide meal', 'Maaltijd verbergen')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
