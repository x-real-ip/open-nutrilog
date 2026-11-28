import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Fast, FastingState } from '@shared/types.ts';
import { api } from '../api.ts';
import { locale, t } from '../i18n.ts';
import { toast, useLoad } from './ui.tsx';

export const FAST_GOALS = [12, 14, 16, 18, 20];
const HOUR = 3_600_000;

/** "14 h 05 min" (Dutch: "14 u 05 min"). */
export function duration(hours: number): string {
  const total = Math.max(0, Math.floor(hours * 60));
  return `${Math.floor(total / 60)} ${t('h', 'u')} ${String(total % 60).padStart(2, '0')} min`;
}

/** A time of day, with the weekday when it isn't today. */
export function clock(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(locale(), sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

/** A local date-time for <input type="datetime-local">. */
function localInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Hours since the start, counted on this device so the timer moves without asking the server. */
const elapsed = (f: Fast) => (Date.now() - new Date(f.startedAt).getTime()) / HOUR;

/**
 * The fasting timer: start a fast with a goal, see how long it has run, end it. `full` (the fasting page) adds
 * changing the start and the goal, and the history.
 */
export function FastingCard({ defaultGoal, full = false }: { defaultGoal: number; full?: boolean }) {
  const { data, setData } = useLoad(() => api.fasting());
  const [goal, setGoal] = useState(defaultGoal);
  const [busy, setBusy] = useState(false);
  const [startText, setStartText] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // The timer moves every half minute.
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => setGoal(defaultGoal), [defaultGoal]);

  const run = async (fn: () => Promise<FastingState>, done?: string) => {
    setBusy(true);
    try {
      setData(await fn());
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const cur = data.current;
  const last = data.recent[0];
  const hours = cur ? elapsed(cur) : 0;
  const f = cur ? Math.min(1, hours / cur.goalHours) : 0;
  const goalAt = cur ? new Date(new Date(cur.startedAt).getTime() + cur.goalHours * HOUR).toISOString() : '';

  return (
    <section className="section panel stack fasting" aria-label={t('Fasting', 'Vasten')}>
      <div className="spread">
        <h2 style={{ margin: 0 }}>{t('Fasting', 'Vasten')}</h2>
        {!full && (
          <Link className="link-btn small" to="/fasting">
            {t('History', 'Geschiedenis')}
          </Link>
        )}
      </div>

      {cur ? (
        <>
          <div className="spread">
            <span className="value num">{duration(hours)}</span>
            <span className={hours >= cur.goalHours ? 'tag ok' : 'muted small'}>
              {hours >= cur.goalHours ? t('Goal reached', 'Doel gehaald') : t(`Goal ${cur.goalHours} h at ${clock(goalAt)}`, `Doel ${cur.goalHours} u om ${clock(goalAt)}`)}
            </span>
          </div>
          <div className="track" role="meter" aria-label={t('Fast progress', 'Voortgang vasten')} aria-valuemin={0} aria-valuemax={cur.goalHours} aria-valuenow={Math.round(hours * 10) / 10}>
            <div className="bar" style={{ width: `${f * 100}%` }} />
          </div>
          <div className="muted small">{t(`Started ${clock(cur.startedAt)}`, `Gestart ${clock(cur.startedAt)}`)}</div>
          <button className="btn primary block" disabled={busy} onClick={() => void run(() => api.endFast(), t('Fast ended', 'Vasten beëindigd'))}>
            {t('End fast', 'Vasten beëindigen')}
          </button>
          {full && (
            <div className="stack">
              {startText === null ? (
                <button className="link-btn" onClick={() => setStartText(localInput(cur.startedAt))}>
                  {t('I started at another time', 'Ik ben op een ander tijdstip begonnen')}
                </button>
              ) : (
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" type="datetime-local" aria-label={t('Start of the fast', 'Start van het vasten')} value={startText} onChange={(e) => setStartText(e.target.value)} />
                  <button
                    className="btn small-btn"
                    disabled={busy || !startText}
                    onClick={() =>
                      void run(async () => {
                        const r = await api.changeFast({ startedAt: new Date(startText).toISOString() });
                        setStartText(null);
                        return r;
                      }, t('Start changed', 'Start aangepast'))
                    }
                  >
                    {t('Save', 'Opslaan')}
                  </button>
                </div>
              )}
              <div className="field">
                <span>{t('Goal', 'Doel')}</span>
                <div className="chips wrap">
                  {FAST_GOALS.map((g) => (
                    <button key={g} type="button" aria-pressed={cur.goalHours === g} disabled={busy} onClick={() => void run(() => api.changeFast({ goalHours: g }))}>
                      {g} {t('h', 'u')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {last && (
            <div className="muted small">
              {t(`Last fast: ${duration(last.hours)}`, `Laatste vasten: ${duration(last.hours)}`)}
              {last.reached ? t(' (goal reached)', ' (doel gehaald)') : ''}
            </div>
          )}
          <div className="chips wrap" role="group" aria-label={t('Goal', 'Doel')}>
            {FAST_GOALS.map((g) => (
              <button key={g} type="button" aria-pressed={goal === g} onClick={() => setGoal(g)}>
                {g} {t('h', 'u')}
              </button>
            ))}
          </div>
          <button className="btn primary block" disabled={busy} onClick={() => void run(() => api.startFast(goal), t('Fast started', 'Vasten gestart'))}>
            {t(`Start a ${goal}-hour fast`, `Start ${goal} uur vasten`)}
          </button>
        </>
      )}

      {full && data.recent.length > 0 && (
        <div className="list" aria-label={t('Earlier fasts', 'Eerdere keren')}>
          {data.recent.map((x) => (
            <div key={x.id} className="list-row">
              <div className="grow">
                <div className="title">
                  {duration(x.hours)} {x.reached && <span className="tag ok">{t('goal', 'doel')}</span>}
                </div>
                <div className="sub">
                  {new Date(x.startedAt).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {t(`goal ${x.goalHours} h`, `doel ${x.goalHours} u`)}
                </div>
              </div>
              <button
                className="link-btn small"
                disabled={busy}
                aria-label={t(`Remove the fast of ${clock(x.startedAt)}`, `Vasten van ${clock(x.startedAt)} verwijderen`)}
                onClick={() => confirm(t('Remove this fast?', 'Dit vasten verwijderen?')) && void run(() => api.deleteFast(x.id))}
              >
                {t('Remove', 'Verwijderen')}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
