import { Link, useParams } from 'react-router-dom';
import type { WeekReport } from '@shared/types.ts';
import { useInfo } from '../App.tsx';
import { api } from '../api.ts';
import { BarChart } from '../components/Charts.tsx';
import { IconBack, IconChevron } from '../components/Icons.tsx';
import { BackButton, ErrorState, Loading, useLoad } from '../components/ui.tsx';
import { addDaysTo, chipDate, grams, kcal, kg, shortDate, signed } from '../format.ts';
import { t } from '../i18n.ts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "This week", "Last week", or "Week of 16 Nov". */
export function weekTitle(r: Pick<WeekReport, 'weekStart' | 'next'>, today: string): string {
  if (r.next === null) return t('This week', 'Deze week');
  if (addDaysTo(r.weekStart, 7) <= today && today <= addDaysTo(r.weekStart, 13)) return t('Last week', 'Vorige week');
  return t(`Week of ${shortDate(r.weekStart)}`, `Week van ${shortDate(r.weekStart)}`);
}

/** One sentence on how the week went against the target. */
function summary(r: WeekReport): string | null {
  if (r.avgKcal === null || r.avgTargetKcal === null) return null;
  const diff = r.avgKcal - r.avgTargetKcal;
  const days = r.completeDays === 1 ? t('1 complete day', '1 complete dag') : t(`${r.completeDays} complete days`, `${r.completeDays} complete dagen`);
  if (Math.abs(diff) <= 50) return t(`On target: ${kcal(r.avgKcal)} a day against ${kcal(r.avgTargetKcal)}, over ${days}.`, `Op doel: ${kcal(r.avgKcal)} per dag tegen ${kcal(r.avgTargetKcal)}, over ${days}.`);
  return diff < 0
    ? t(`${kcal(-diff)} a day under your target (${kcal(r.avgKcal)} against ${kcal(r.avgTargetKcal)}), over ${days}.`, `${kcal(-diff)} per dag onder je doel (${kcal(r.avgKcal)} tegen ${kcal(r.avgTargetKcal)}), over ${days}.`)
    : t(`${kcal(diff)} a day over your target (${kcal(r.avgKcal)} against ${kcal(r.avgTargetKcal)}), over ${days}.`, `${kcal(diff)} per dag boven je doel (${kcal(r.avgKcal)} tegen ${kcal(r.avgTargetKcal)}), over ${days}.`);
}

/** A week looked back on: intake against target, protein, training, weight trend and what gave the most energy. */
export default function WeekPage() {
  const info = useInfo();
  const params = useParams();
  const day = params.day && DAY.test(params.day) ? params.day : undefined;
  const { data: r, error, loading, reload } = useLoad(() => api.weekReport(day), [day]);
  if (loading && !r) return <Loading />;
  if (error || !r) return <ErrorState message={error ?? ''} onRetry={reload} />;

  const line = summary(r);
  return (
    <main className="page">
      <div className="row" style={{ marginBottom: 6 }}>
        <BackButton fallback="/progress" />
      </div>
      <div className="page-head day-head">
        <Link className="icon-btn" replace to={`/week/${r.previous}`} aria-label={t('Previous week', 'Vorige week')}>
          <IconBack />
        </Link>
        <div className="date-pick">
          <h1>{weekTitle(r, info.today)}</h1>
          <div className="muted small">
            {shortDate(r.weekStart)} – {shortDate(r.weekEnd)}
          </div>
        </div>
        {r.next ? (
          <Link className="icon-btn" replace to={`/week/${r.next}`} aria-label={t('Next week', 'Volgende week')}>
            <IconChevron />
          </Link>
        ) : (
          <span className="icon-btn" aria-hidden style={{ visibility: 'hidden' }} />
        )}
      </div>

      {r.loggedDays === 0 ? (
        <p className="muted">{t('Nothing logged this week.', 'Deze week is er niets gelogd.')}</p>
      ) : (
        <>
          <section className="section stack" aria-label={t('Summary', 'Samenvatting')}>
            {line && <p style={{ margin: 0 }}>{line}</p>}
            <div className="stat-row">
              <div className="stat">
                <div className="value">{r.avgKcal ?? '–'}</div>
                <div className="label">{t('kcal a day', 'kcal per dag')}</div>
              </div>
              <div className="stat">
                <div className="value">{r.balanceKcal === null ? '–' : signed(r.balanceKcal, (x) => String(Math.round(x)))}</div>
                <div className="label">{t('kcal against target, total', 'kcal t.o.v. doel, totaal')}</div>
              </div>
              <div className="stat">
                <div className="value">{r.trendChangeKg === null ? '–' : signed(r.trendChangeKg, kg)}</div>
                <div className="label">{t('kg, trend weight', 'kg, trendgewicht')}</div>
              </div>
            </div>
            <div className="stat-row">
              <div className="stat">
                <div className="value">
                  {r.proteinHitDays}/{r.proteinTargetDays}
                </div>
                <div className="label">{t('days protein target', 'dagen eiwitdoel')}</div>
              </div>
              <div className="stat">
                <div className="value">
                  {r.completeDays}/{r.daysSoFar}
                </div>
                <div className="label">{t('days fully logged', 'dagen volledig gelogd')}</div>
              </div>
              <div className="stat">
                <div className="value">{r.trainingDays}</div>
                <div className="label">{t('training days', 'trainingsdagen')}</div>
              </div>
            </div>
            {r.avgProteinG !== null && (
              <p className="muted small" style={{ margin: 0 }}>
                {t(
                  `A day on average: ${grams(r.avgProteinG)} protein, ${grams(r.avgCarbsG ?? 0)} carbs, ${grams(r.avgFatG ?? 0)} fat.`,
                  `Gemiddeld per dag: ${grams(r.avgProteinG)} eiwit, ${grams(r.avgCarbsG ?? 0)} koolhydraten, ${grams(r.avgFatG ?? 0)} vet.`,
                )}
                {r.trendEndKg !== null && ` ${t(`Trend weight ${kg(r.trendEndKg)} kg (${r.weighIns} weigh-ins this week).`, `Trendgewicht ${kg(r.trendEndKg)} kg (${r.weighIns} wegingen deze week).`)}`}
              </p>
            )}
          </section>

          <section className="section">
            <BarChart
              title={t('Energy per day', 'Energie per dag')}
              sub={t('Bars: eaten. Lines: your target that day.', 'Balken: gegeten. Streepjes: je doel van die dag.')}
              unit=" kcal"
              data={r.days.map((d) => ({
                label: chipDate(d.date),
                value: d.kcal,
                detail: [
                  d.targetKcal ? `${kcal(d.kcal)} / ${kcal(d.targetKcal)}` : kcal(d.kcal),
                  d.isTrainingDay ? t('training', 'training') : null,
                  d.incomplete ? t('not complete', 'niet compleet') : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              }))}
              reference={r.days.map((d) => d.targetKcal)}
            />
          </section>

          {r.topFoods.length > 0 && (
            <section className="section stack" aria-label={t('Most energy from', 'Meeste energie uit')}>
              <h2>{t('Most energy from', 'Meeste energie uit')}</h2>
              <div className="list">
                {r.topFoods.map((f) => (
                  <div key={f.name} className="list-row">
                    <div className="grow">
                      <div className="title">{f.name}</div>
                      <div className="sub">{f.times === 1 ? t('once', '1 keer') : t(`${f.times} times`, `${f.times} keer`)}</div>
                    </div>
                    <span className="num muted">{kcal(f.kcal)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="faint small">
            {t(
              'Averages count only days you logged completely; a day you marked as incomplete in the diary is left out. Protein counts as reached from 95 % of the target.',
              'Gemiddelden tellen alleen dagen die je volledig hebt gelogd; een dag die je in het dagboek als onvolledig markeert, telt niet mee. Eiwit telt als gehaald vanaf 95 % van het doel.',
            )}
          </p>
        </>
      )}
    </main>
  );
}
