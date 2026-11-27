import { useState, type FormEvent } from 'react';
import { useInfo } from '../App.tsx';
import { api } from '../api.ts';
import { BarChart, LineChart } from '../components/Charts.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { parseNumber } from '../food.ts';
import { grams, kcal, kg, num, shortDate } from '../format.ts';
import { t } from '../i18n.ts';

const RANGES = [28, 56, 91];

export default function ProgressPage() {
  const info = useInfo();
  const [range, setRange] = useState(28);
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.progress(range), api.bodyWeights()]), [range]);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  const [p, { entries }] = data;

  const logWeight = async (e: FormEvent) => {
    e.preventDefault();
    const value = parseNumber(weight);
    if (value === null) return;
    setBusy(true);
    try {
      await api.logBodyWeight(value, info.today);
      setWeight('');
      toast(t('Weight saved', 'Gewicht opgeslagen'));
      void reload();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number, date: string, w: number) => {
    if (!confirm(t(`Remove ${kg(w)} kg of ${shortDate(date)}?`, `${kg(w)} kg van ${shortDate(date)} verwijderen?`))) return;
    await api.deleteBodyWeight(id);
    void reload();
  };

  const latest = p.weights.at(-1);
  const weights = p.weights.filter((w) => w.date >= p.days[0].date);
  const logged = p.days.filter((d) => d.logged);
  const change = p.weeklyChangeKg;

  return (
    <main className="page">
      <div className="page-head">
        <h1>{t('Progress', 'Voortgang')}</h1>
      </div>

      <div className="chips" aria-label={t('Period', 'Periode')}>
        {RANGES.map((r) => (
          <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
            {t(`${r / 7} weeks`, `${r / 7} weken`)}
          </button>
        ))}
      </div>

      <section className="section stack" aria-label={t('Body weight', 'Lichaamsgewicht')}>
        <div className="spread">
          <h2>{t('Body weight', 'Lichaamsgewicht')}</h2>
          {latest && (
            <span className="faint small">
              {t('trend', 'trend')} {kg(latest.trendKg)} kg
              {change !== null ? ` · ${change > 0 ? '+' : change < 0 ? '−' : '±'}${kg(Math.abs(change))} kg ${t('a week', 'per week')}` : ''}
            </span>
          )}
        </div>
        <form className="row" style={{ gap: 8 }} onSubmit={logWeight}>
          <input
            className="input num"
            inputMode="decimal"
            placeholder={latest ? kg(latest.weightKg) : 'kg'}
            aria-label={t('Weight today in kg', 'Gewicht vandaag in kg')}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn primary" disabled={busy || parseNumber(weight) === null}>
            {t('Save today', 'Vandaag opslaan')}
          </button>
        </form>
        {weights.length > 1 && (
          <LineChart
            title={t('Trend weight', 'Trendgewicht')}
            sub={t('Line: the trend (smoothed). Dots: your weigh-ins.', 'Lijn: de trend (afgevlakt). Stippen: je wegingen.')}
            unit=" kg"
            data={weights.map((w) => ({ label: shortDate(w.date), value: w.trendKg, detail: `${kg(w.trendKg)} kg (${t('weighed', 'gewogen')} ${kg(w.weightKg)} kg)` }))}
            points={weights.map((w) => w.weightKg)}
          />
        )}
        {entries.length > 0 && (
          <div className="list">
            {[...entries]
              .reverse()
              .slice(0, 5)
              .map((e) => (
                <div className="list-row" key={e.id}>
                  <div className="grow">
                    <div className="title">{kg(e.weightKg)} kg</div>
                    <div className="sub">{shortDate(e.date)}</div>
                  </div>
                  <button className="link-btn small" onClick={() => void remove(e.id, e.date, e.weightKg)} aria-label={t(`Remove ${shortDate(e.date)}`, `${shortDate(e.date)} verwijderen`)}>
                    {t('Remove', 'Verwijderen')}
                  </button>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className="section stack" aria-label={t('Intake', 'Inname')}>
        <h2>{t('Intake', 'Inname')}</h2>
        {logged.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {t('Log what you eat in the diary to see it here.', 'Log wat je eet in het dagboek om het hier te zien.')}
          </p>
        ) : (
          <>
            <BarChart
              title={t('Energy per day', 'Energie per dag')}
              sub={t('Bars: eaten. Lines: your target that day.', 'Balken: gegeten. Streepjes: je doel van die dag.')}
              unit=" kcal"
              data={p.days.map((d) => ({
                label: shortDate(d.date),
                value: d.kcal,
                detail: d.targetKcal ? `${kcal(d.kcal)} / ${kcal(d.targetKcal)}${d.isTrainingDay ? ` · ${t('training', 'training')}` : ''}` : kcal(d.kcal),
              }))}
              reference={p.days.map((d) => d.targetKcal)}
            />
            <div className="list">
              {[...p.weeks]
                .filter((w) => w.loggedDays > 0)
                .reverse()
                .map((w) => (
                <div className="list-row" key={w.weekStart}>
                  <div className="grow">
                    <div className="title">{t(`Week of ${shortDate(w.weekStart)}`, `Week van ${shortDate(w.weekStart)}`)}</div>
                    <div className="sub">{t(`${w.loggedDays} days logged`, `${w.loggedDays} dagen gelogd`)}</div>
                  </div>
                  <span className="num muted">
                    {w.avgKcal !== null ? `${kcal(w.avgKcal)}${w.avgTargetKcal !== null ? ` / ${w.avgTargetKcal}` : ''}` : '–'}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {p.averages && (
          <div className="stat-row" aria-label={t('Average of the last 7 days', 'Gemiddelde van de laatste 7 dagen')}>
            <div className="stat">
              <div className="value">{grams(p.averages.proteinG)}</div>
              <div className="label">{t('Protein / day', 'Eiwit / dag')}</div>
            </div>
            <div className="stat">
              <div className="value">{grams(p.averages.carbsG)}</div>
              <div className="label">{t('Carbs / day', 'Koolh. / dag')}</div>
            </div>
            <div className="stat">
              <div className="value">{grams(p.averages.fatG)}</div>
              <div className="label">{t('Fat / day', 'Vet / dag')}</div>
            </div>
          </div>
        )}
        {p.averages && (
          <p className="faint small" style={{ margin: 0 }}>
            {t(
              `Average of the last ${p.averages.days} complete days: ${kcal(p.averages.kcal)}${latest ? `, ${num(p.averages.proteinG / latest.weightKg, 1)} g protein per kg` : ''}.`,
              `Gemiddelde van de laatste ${p.averages.days} complete dagen: ${kcal(p.averages.kcal)}${latest ? `, ${num(p.averages.proteinG / latest.weightKg, 1)} g eiwit per kg` : ''}.`,
            )}
          </p>
        )}
      </section>

      {p.tdee.length > 1 && (
        <section className="section">
          <LineChart
            title={t('Maintenance without training', 'Onderhoud zonder training')}
            sub={t('Per week: the formula, then your own data', 'Per week: de formule, daarna je eigen data')}
            unit=" kcal"
            data={p.tdee.map((w) => ({ label: shortDate(w.weekStart), value: w.baseKcal, detail: `${kcal(w.baseKcal)}${w.adaptiveKcal === null ? ` (${t('formula', 'formule')})` : ''}` }))}
          />
        </section>
      )}
    </main>
  );
}
