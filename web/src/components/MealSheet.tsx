import { useEffect, useState } from 'react';
import type { Meal } from '@shared/types.ts';
import { api, flushQueue, isPending } from '../api.ts';
import { addDaysTo, dayLabel } from '../format.ts';
import { t } from '../i18n.ts';
import { Sheet, toast } from './ui.tsx';

/** A meal's menu: copy it to or from other days, rename it, or hide it. */
export function MealSheet({
  open,
  meal,
  day,
  today,
  entryIds,
  onClose,
  onChanged,
  onCopyToDays,
}: {
  open: boolean;
  meal: Meal | null;
  day: string;
  today: string;
  /** The entries of this meal on this day. */
  entryIds: string[];
  onClose: () => void;
  onChanged: () => void;
  /** Opens the sheet to copy this meal to one or more days. */
  onCopyToDays: () => void;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);

  useEffect(() => {
    if (open && meal) setName(meal.name);
    setSaveName(null);
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
  const hasEntries = entryIds.length > 0;

  const saveAsMeal = () =>
    run(async () => {
      // Entries logged on this device have to reach the server first.
      await flushQueue();
      if (entryIds.some(isPending)) throw new Error(t('Not synced yet. Try again when you’re online.', 'Nog niet gesynchroniseerd. Probeer het opnieuw als je online bent.'));
      await api.createSavedMeal(saveName!.trim(), entryIds);
    }, t('Saved; find it under “Saved meals” when you add food', 'Opgeslagen; je vindt hem onder “Vaste maaltijden” bij eten toevoegen'));

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
          {hasEntries && (
            <button className="list-row" disabled={busy} onClick={onCopyToDays}>
              <div className="grow">
                <div className="title">{t('Copy to other days…', 'Kopiëren naar andere dagen…')}</div>
                <div className="sub">{t('For example the coming days of the week', 'Bijvoorbeeld de komende dagen van de week')}</div>
              </div>
            </button>
          )}
          {hasEntries && saveName === null && (
            <button className="list-row" disabled={busy} onClick={() => setSaveName(meal.name)}>
              <div className="grow">
                <div className="title">{t('Save as a saved meal…', 'Opslaan als vaste maaltijd…')}</div>
                <div className="sub">{t('Log these foods together again in one tap', 'Log deze producten later weer samen met één tik')}</div>
              </div>
            </button>
          )}
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

        {saveName !== null && (
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              void saveAsMeal();
            }}
          >
            <label className="field">
              <span>{t('Name of the saved meal', 'Naam van de vaste maaltijd')}</span>
              <input className="input" value={saveName} maxLength={60} onChange={(e) => setSaveName(e.target.value)} />
            </label>
            <button className="btn primary" disabled={busy || !saveName.trim()}>
              {t('Save meal', 'Maaltijd opslaan')}
            </button>
          </form>
        )}

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
