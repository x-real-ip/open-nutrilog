import { Link } from 'react-router-dom';
import { useInfo } from '../App.tsx';
import { api } from '../api.ts';
import { ErrorState, Loading, SubpageHead, useLoad } from '../components/ui.tsx';
import { kcal } from '../format.ts';
import { t } from '../i18n.ts';

/** "How your target is built": today's target step by step, from the same rules that compute it. */
export default function TargetsPage() {
  const info = useInfo();
  const { data, error, loading, reload } = useLoad(() => api.target(info.today));

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? ''} onRetry={reload} />;
  const goal = data.target;

  return (
    <main className="page">
      <SubpageHead title={t('How your target is built', 'Hoe je doel is opgebouwd')} fallback="/today" />

      {!goal ? (
        <section className="panel stack">
          <p style={{ margin: 0 }}>{t('Add your sex, age, height and weight to get a daily target.', 'Vul je geslacht, leeftijd, lengte en gewicht in voor een dagdoel.')}</p>
          <Link className="btn primary block" to="/profile">
            {t('Set up your profile', 'Profiel instellen')}
          </Link>
        </section>
      ) : (
        <>
          <section className="panel stack" aria-label={t('Today’s target', 'Doel van vandaag')}>
            <div className="spread">
              <span className="value num big-num">{kcal(goal.kcal)}</span>
              <span className={`tag ${goal.isTrainingDay ? 'training' : ''}`}>{goal.isTrainingDay ? t('Training day', 'Trainingsdag') : t('Rest day', 'Rustdag')}</span>
            </div>
            <div className="muted small">
              {t(`Protein ${goal.proteinG} g · carbohydrates ${goal.carbsG} g · fat ${goal.fatG} g`, `Eiwit ${goal.proteinG} g · koolhydraten ${goal.carbsG} g · vet ${goal.fatG} g`)}
            </div>
          </section>

          <section className="section stack">
            <h2>{t('Step by step', 'Stap voor stap')}</h2>
            <ol className="steps-list">
              {goal.steps.map((s) => (
                <li key={s.id}>{s.text}</li>
              ))}
            </ol>
          </section>

          {data.adaptive && (
            <section className="section stack">
              <h2>{t('Your own maintenance', 'Je eigen onderhoud')}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {data.adaptive.text}
              </p>
            </section>
          )}
        </>
      )}

      <section className="section stack">
        <h2>{t('The rules', 'De regels')}</h2>
        <ul className="steps-list muted">
          <li>
            {t(
              'Targets come from fixed rules, the same every time. An AI may explain them but never sets them.',
              'Doelen komen uit vaste regels, elke keer hetzelfde. Een AI mag ze uitleggen maar stelt ze nooit vast.',
            )}
          </li>
          <li>
            {t(
              'Training is added only on training days, as net energy ((MET − 1) × kg × hours, at most 2 hours), so it is never counted twice.',
              'Training komt er alleen op trainingsdagen bij, als netto energie ((MET − 1) × kg × uren, hooguit 2 uur), dus het telt nooit dubbel.',
            )}
          </li>
          <li>
            {t(
              'A cut is at most 1 % of your weight a week, a bulk at most 0.5 %. The target never goes below your resting energy.',
              'Afvallen gaat met hooguit 1 % van je gewicht per week, aankomen met hooguit 0,5 %. Het doel gaat nooit onder je ruststofwisseling.',
            )}
          </li>
          <li>
            {t(
              'After 14 days with enough logging and weigh-ins, your own data takes over from the formula, step by step and at most 150 kcal a week. Days you mark as incomplete are left out.',
              'Na 14 dagen met genoeg logs en wegingen neemt je eigen data het stap voor stap over van de formule, hooguit 150 kcal per week. Dagen die je als onvolledig markeert, tellen niet mee.',
            )}
          </li>
        </ul>
      </section>
    </main>
  );
}
