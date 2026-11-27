import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { sumNutrients } from '@shared/nutrition.ts';
import { useInfo } from '../App.tsx';
import { api, onQueueChange, withPending } from '../api.ts';
import { ErrorState, Loading, useLoad } from '../components/ui.tsx';
import { macroLine } from '../food.ts';
import { kcal, longDate, versionLabel } from '../format.ts';
import { t } from '../i18n.ts';

export default function TodayPage() {
  const info = useInfo();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.profile(), api.day(info.today)]));
  const [, setTick] = useState(0);
  useEffect(() => onQueueChange(() => setTick((n) => n + 1)), []);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const [{ profile }, day] = data;
  const view = withPending(day);

  return (
    <main className="page">
      <div className="brand">
        OPEN NUTRILOG <span className="version">{versionLabel(info.version)}</span>
      </div>
      <div className="page-head">
        <h1>{t('Today', 'Vandaag')}</h1>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        {longDate(info.today)}
      </p>

      {!profile && (
        <section className="section panel stack">
          <p style={{ margin: 0 }}>{t('Welcome! Set up your profile to get started.', 'Welkom! Stel je profiel in om te beginnen.')}</p>
          <Link className="btn primary block" to="/profile">
            {t('Set up your profile', 'Profiel instellen')}
          </Link>
        </section>
      )}

      <section className="section panel day-total" aria-label={t('Eaten today', 'Vandaag gegeten')}>
        <div className="muted small">{t('Eaten today', 'Vandaag gegeten')}</div>
        <div className="value num">{kcal(view.totals.kcal)}</div>
        <div className="muted small">{macroLine(view.totals)}</div>
      </section>

      <section className="section">
        <div className="list">
          {view.meals
            .filter((m) => !m.hidden || view.entries.some((e) => e.mealId === m.id))
            .map((m) => {
              const entries = view.entries.filter((e) => e.mealId === m.id);
              return (
                <Link key={m.id} className="list-row" to="/diary">
                  <div className="grow">
                    <div className="title">{m.name}</div>
                    <div className="sub">
                      {entries.length
                        ? t(`${entries.length} item${entries.length === 1 ? '' : 's'}`, `${entries.length} ${entries.length === 1 ? 'item' : 'items'}`)
                        : t('Nothing yet', 'Nog niets')}
                    </div>
                  </div>
                  <span className="num muted">{entries.length ? kcal(sumNutrients(entries.map((e) => e.nutrients)).kcal) : ''}</span>
                </Link>
              );
            })}
        </div>
      </section>

      <section className="section stack">
        <Link className="btn primary big block" to="/diary">
          {t('Open the diary', 'Dagboek openen')}
        </Link>
      </section>
    </main>
  );
}
