import { useEffect, useState } from 'react';
import type { SavedMeal } from '@shared/types.ts';
import { api } from '../api.ts';
import { IconClose } from '../components/Icons.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { amountLabel } from '../food.ts';
import { kcal } from '../format.ts';
import { t } from '../i18n.ts';

/** One saved meal: rename it, take foods out, or delete it. */
function SavedMealPanel({ meal, onChanged }: { meal: SavedMeal; onChanged: () => void }) {
  const [name, setName] = useState(meal.name);
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(meal.name), [meal.name]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel stack" aria-label={meal.name}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>{meal.name}</h2>
        <span className="muted num">{kcal(meal.totals.kcal)}</span>
      </div>
      <div className="list">
        {meal.items.map((item) => (
          <div key={item.id} className="list-row">
            <div className="grow">
              <div className="title">{item.name}</div>
              <div className="sub">
                {[amountLabel(item), kcal(item.nutrients.kcal)].filter(Boolean).join(' · ')}
              </div>
            </div>
            {meal.items.length > 1 && (
              <button
                className="icon-btn"
                disabled={busy}
                aria-label={t(`Take ${item.name} out`, `${item.name} weghalen`)}
                onClick={() =>
                  void run(() => api.updateSavedMeal(meal.id, meal.name, meal.items.filter((x) => x.id !== item.id).map((x) => x.id)), t('Taken out', 'Weggehaald'))
                }
              >
                <IconClose size={18} />
              </button>
            )}
          </div>
        ))}
      </div>
      <label className="field">
        <span>{t('Name', 'Naam')}</span>
        <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="grid-2">
        <button className="btn" disabled={busy || !name.trim() || name.trim() === meal.name} onClick={() => void run(() => api.updateSavedMeal(meal.id, name.trim()), t('Renamed', 'Hernoemd'))}>
          {t('Rename', 'Hernoemen')}
        </button>
        <button
          className="btn danger"
          disabled={busy}
          onClick={() =>
            confirm(t(`Delete “${meal.name}”? What you logged with it stays.`, `“${meal.name}” verwijderen? Wat je ermee gelogd hebt, blijft staan.`)) &&
            void run(() => api.deleteSavedMeal(meal.id), t('Deleted', 'Verwijderd'))
          }
        >
          {t('Delete', 'Verwijderen')}
        </button>
      </div>
    </section>
  );
}

/** Your saved meals. You make one from a meal's menu in the diary, and log it from "Add food". */
export default function SavedMealsPage() {
  const { data, error, loading, reload } = useLoad(() => api.savedMeals().then((r) => r.savedMeals));
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? ''} onRetry={reload} />;

  return (
    <main className="page">
      <div className="page-head">
        <h1>{t('Saved meals', 'Vaste maaltijden')}</h1>
      </div>
      {data.length ? (
        <div className="stack">
          {data.map((m) => (
            <SavedMealPanel key={m.id} meal={m} onChanged={() => void reload()} />
          ))}
        </div>
      ) : (
        <p className="muted">
          {t(
            'Nothing saved yet. In the diary, tap a meal’s name and choose “Save as a saved meal”; then log it from “Add food” in one tap.',
            'Nog niets opgeslagen. Tik in het dagboek op de naam van een maaltijd en kies “Opslaan als vaste maaltijd”; log hem daarna met één tik via “Eten toevoegen”.',
          )}
        </p>
      )}
    </main>
  );
}
