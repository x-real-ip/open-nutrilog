import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DayTarget, TargetResponse } from '@shared/types.ts';
import { sumNutrients } from '@shared/nutrition.ts';
import { useInfo } from '../App.tsx';
import { api, onQueueChange, withPending } from '../api.ts';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { IconChevron } from '../components/Icons.tsx';
import { grams, kcal, kg, longDate, signed, versionLabel } from '../format.ts';
import { t } from '../i18n.ts';

/** A ring that fills as the day's target is eaten; red when over. */
function BudgetRing({ eaten, target }: { eaten: number; target: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const f = target > 0 ? Math.min(1, eaten / target) : 0;
  const over = eaten > target;
  return (
    <svg className="ring" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r={r} className="ring-track" />
      <circle cx="60" cy="60" r={r} className={`ring-fill${over ? ' over' : ''}`} strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 60 60)" />
    </svg>
  );
}

function MacroBar({ label, eaten, target, color }: { label: string; eaten: number; target: number; color: string }) {
  const f = target > 0 ? Math.min(1, eaten / target) : 0;
  return (
    <div className="macro">
      <div className="spread small">
        <span>{label}</span>
        <span className="num muted">
          {grams(eaten)} / {grams(target)}
        </span>
      </div>
      <div className="track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(eaten)}>
        <div className="bar" style={{ width: `${f * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function TrainingLine({ target, day, onChange }: { target: TargetResponse; day: string; onChange: (r: TargetResponse) => void }) {
  const marked = target.mark.training === true;
  const ignored = target.mark.training === false;
  const w: DayTarget['workout'] = target.target?.workout ?? null;
  const linked = w && w.source !== 'planned';
  const setTraining = async (training: boolean | null) => {
    try {
      onChange(await api.setMark(day, { training }));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const toggle = () => setTraining(marked ? null : true);
  // A workout from Open Strength counts by itself; "doesn't count" is for the odd day it shouldn't.
  if (linked || ignored) {
    return (
      <div className="spread training-line">
        <span className={`tag ${linked ? 'training' : ''}`}>
          {linked
            ? w!.source === 'in_progress'
              ? t(`Training now (Open Strength, ${w!.minutes} min so far)`, `Nu aan het trainen (Open Strength, tot nu toe ${w!.minutes} min)`)
              : t(`Trained today: ${w!.minutes} min in Open Strength`, `Vandaag getraind: ${w!.minutes} min in Open Strength`)
            : t('Not counted as a training day', 'Telt niet als trainingsdag')}
        </span>
        <button className="btn small-btn" onClick={() => void setTraining(ignored ? null : false)}>
          {ignored ? t('Count it again', 'Toch meetellen') : t('Don’t count it', 'Niet meetellen')}
        </button>
      </div>
    );
  }
  return (
    <div className="spread training-line">
      <span>
        {target.target?.isTrainingDay ? (
          <span className="tag training">
            {linked
              ? t(`Training day: workout of ${w!.minutes} min`, `Trainingsdag: training van ${w!.minutes} min`)
              : t('Training day', 'Trainingsdag')}
          </span>
        ) : (
          <span className="tag">{t('Rest day', 'Rustdag')}</span>
        )}
      </span>
      {!linked && (
        <button className="btn small-btn" aria-pressed={marked} onClick={() => void toggle()}>
          {marked ? t('Not training today', 'Vandaag geen training') : t('Training today', 'Vandaag training')}
        </button>
      )}
    </div>
  );
}

export default function TodayPage() {
  const info = useInfo();
  const { data, error, loading, reload, setData } = useLoad(() => Promise.all([api.profile(), api.day(info.today), api.target(info.today)]));
  const [, setTick] = useState(0);
  useEffect(() => onQueueChange(() => setTick((n) => n + 1)), []);
  // Last week at a glance; loaded separately, so the page never waits for it.
  const week = useLoad(() => api.weekReport());

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const [{ profile }, day, target] = data;
  const view = withPending(day);
  const eaten = view.totals;
  const goal = target.target;

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

      {(!profile || target.missing.length > 0) && (
        <section className="section panel stack">
          <p style={{ margin: 0 }}>
            {profile
              ? t('Add your sex, age, height and weight to get a daily target.', 'Vul je geslacht, leeftijd, lengte en gewicht in voor een dagdoel.')
              : t('Welcome! Set up your profile to get started.', 'Welkom! Stel je profiel in om te beginnen.')}
          </p>
          <Link className="btn primary block" to="/profile">
            {t('Set up your profile', 'Profiel instellen')}
          </Link>
        </section>
      )}

      {goal ? (
        <section className="section panel budget" aria-label={t('Today’s budget', 'Budget van vandaag')}>
          <div className="budget-top">
            <div className="ring-wrap">
              <BudgetRing eaten={eaten.kcal} target={goal.kcal} />
              <div className="ring-center">
                <div className="value num">{Math.abs(Math.round(goal.kcal - eaten.kcal))}</div>
                <div className="small muted">{eaten.kcal > goal.kcal ? t('kcal over', 'kcal te veel') : t('kcal left', 'kcal over')}</div>
              </div>
            </div>
            <div className="stack" style={{ gap: 6 }}>
              <div>
                <div className="small muted">{t('Target', 'Doel')}</div>
                <div className="num big-num">{kcal(goal.kcal)}</div>
              </div>
              <div>
                <div className="small muted">{t('Eaten', 'Gegeten')}</div>
                <div className="num big-num">{kcal(eaten.kcal)}</div>
              </div>
              {goal.workoutKcal > 0 && <div className="small muted">{t(`incl. ${goal.workoutKcal} kcal training`, `incl. ${goal.workoutKcal} kcal training`)}</div>}
            </div>
          </div>
          <div className="macros">
            <MacroBar label={t('Protein', 'Eiwit')} eaten={eaten.protein} target={goal.proteinG} color="var(--macro-protein)" />
            <MacroBar label={t('Carbohydrates', 'Koolhydraten')} eaten={eaten.carbs} target={goal.carbsG} color="var(--macro-carbs)" />
            <MacroBar label={t('Fat', 'Vet')} eaten={eaten.fat} target={goal.fatG} color="var(--macro-fat)" />
          </div>
          <TrainingLine target={target} day={info.today} onChange={(r) => setData([data[0], data[1], r])} />
          {goal.floorHit && (
            <p className="notice small" style={{ margin: 0 }}>
              {t(
                'Your target is kept at your resting energy: going lower for long isn’t good for you. A slower pace gets you there too.',
                'Je doel blijft op je ruststofwisseling: langere tijd lager gaan is niet goed voor je. Rustiger aan brengt je er ook.',
              )}
            </p>
          )}
          <Link className="link-btn small" to="/targets">
            {t('How your target is built', 'Hoe je doel is opgebouwd')}
          </Link>
        </section>
      ) : (
        <section className="section panel day-total" aria-label={t('Eaten today', 'Vandaag gegeten')}>
          <div className="muted small">{t('Eaten today', 'Vandaag gegeten')}</div>
          <div className="value num">{kcal(eaten.kcal)}</div>
        </section>
      )}

      <section className="section">
        <div className="list">
          {view.meals
            .filter((m) => !m.hidden || view.entries.some((e) => e.mealId === m.id))
            .map((m) => {
              const entries = view.entries.filter((e) => e.mealId === m.id);
              const eatenKcal = sumNutrients(entries.map((e) => e.nutrients)).kcal;
              const goal = target.meals.find((g) => g.mealId === m.id);
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
                  <span className="num muted">{goal ? `${Math.round(eatenKcal)} / ${kcal(goal.kcal)}` : entries.length ? kcal(eatenKcal) : ''}</span>
                </Link>
              );
            })}
        </div>
      </section>

      {week.data && week.data.completeDays > 0 && (
        <section className="section list">
          <Link className="list-row" to="/week" aria-label={t('Last week: weekly report', 'Vorige week: weekoverzicht')}>
            <div className="grow">
              <div className="title">{t('Last week', 'Vorige week')}</div>
              <div className="sub">
                {[
                  week.data.avgKcal !== null ? t(`${kcal(week.data.avgKcal)} a day`, `${kcal(week.data.avgKcal)} per dag`) : null,
                  week.data.proteinTargetDays ? t(`protein ${week.data.proteinHitDays}/${week.data.proteinTargetDays} days`, `eiwit ${week.data.proteinHitDays}/${week.data.proteinTargetDays} dagen`) : null,
                  week.data.trendChangeKg !== null ? `${signed(week.data.trendChangeKg, kg)} kg` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <IconChevron />
          </Link>
        </section>
      )}

      <section className="section stack">
        <Link className="btn primary big block" to="/diary">
          {t('Open the diary', 'Dagboek openen')}
        </Link>
      </section>
    </main>
  );
}
