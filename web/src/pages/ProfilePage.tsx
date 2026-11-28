import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Language, LinkedStrength, Phase, PicnicStatus, Profile, Sex } from '@shared/types.ts';
import { api } from '../api.ts';
import { useInfo, useRefreshInfo, useSetLanguage } from '../App.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { parseNumber } from '../food.ts';
import { kg, longDate, num, versionLabel } from '../format.ts';
import { getLang, t } from '../i18n.ts';

type ProfileInput = Omit<Profile, 'updatedAt'>;

/** Each language is named in itself, so you can find yours whatever the current language is. */
const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
];

const NEAT = (): { value: number; label: string; sub: string }[] => [
  { value: 1.2, label: t('Mostly sitting', 'Vooral zittend'), sub: t('Desk job, little walking', 'Kantoorwerk, weinig lopen') },
  { value: 1.4, label: t('Some walking', 'Wat lopen'), sub: t('Desk job, but on your feet now and then; 5–8k steps', 'Kantoorwerk, maar af en toe op de been; 5–8k stappen') },
  { value: 1.55, label: t('On your feet a lot', 'Veel op de been'), sub: t('Retail, teaching, lots of walking; 10k+ steps', 'Winkel, onderwijs, veel lopen; 10k+ stappen') },
  { value: 1.7, label: t('Physical work', 'Lichamelijk werk'), sub: t('Construction, warehouse, care', 'Bouw, magazijn, zorg') },
];

const RATES: Record<Phase, number[]> = { cut: [0.25, 0.5, 0.75, 1], maintain: [], bulk: [0.25, 0.5] };

const empty = (): ProfileInput => ({
  name: '',
  language: getLang(),
  timeZone: '',
  sex: null,
  age: null,
  heightCm: null,
  weightKg: null,
  neat: 1.4,
  phase: 'maintain',
  ratePctPerWeek: 0.5,
  proteinGPerKg: null,
  carbCycling: true,
  metStrength: 5,
  trainingMinutes: 60,
  workoutEnergyShare: 100,
  shiftDays: [],
  shiftKcal: 0,
  mealShares: [],
});

const WEEKDAYS = (): string[] => [
  t('Mon', 'ma'),
  t('Tue', 'di'),
  t('Wed', 'wo'),
  t('Thu', 'do'),
  t('Fri', 'vr'),
  t('Sat', 'za'),
  t('Sun', 'zo'),
];
const SHIFT_KCAL = [100, 200, 300, 400, 500];

/** Strip server-only fields so a saved profile can be sent back as is. */
function input(p: Profile): ProfileInput {
  const { updatedAt: _updatedAt, ...rest } = p;
  return rest;
}

/** A number typed with a comma or a point; empty means "not set". */
function NumberField({ label, value, onChange, suffix, digits = 1 }: { label: string; value: number | null; onChange: (v: number | null) => void; suffix?: string; digits?: number }) {
  const [text, setText] = useState(value === null ? '' : num(value, digits));
  useEffect(() => {
    if (parseNumber(text) !== value) setText(value === null ? '' : num(value, digits));
    // Only follow outside changes; typing keeps its own text (e.g. "80," on the way to "80,5").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span>
        {label}
        {suffix ? ` (${suffix})` : ''}
      </span>
      <input
        className="input num"
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseNumber(e.target.value));
        }}
      />
    </label>
  );
}

export default function ProfilePage() {
  const info = useInfo();
  const refreshInfo = useRefreshInfo();
  const setLanguage = useSetLanguage();
  const { data, error, loading, reload } = useLoad(() => api.profile());
  const meals = useLoad(() => api.meals().then((r) => r.meals.filter((m) => !m.hidden)));
  const [p, setP] = useState<ProfileInput>(empty);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const saved = data?.profile ?? null;
  const isNew = !saved;

  useEffect(() => {
    if (saved) setP(input(saved));
  }, [saved]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setP((cur) => ({ ...cur, [k]: v }));

  // The language applies right away. An existing profile saves just that field (other edits are not
  // saved by it); a new profile only switches the screen until the form is saved.
  const chooseLanguage = async (language: Language) => {
    if (language === getLang()) return;
    try {
      if (saved) {
        await api.saveProfile({ ...input(saved), language });
        refreshInfo();
      }
      set('language', language);
      setLanguage(language);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const sharesTotal = p.mealShares.reduce((sum, x) => sum + x.pct, 0);
  const shareOf = (mealId: number) => p.mealShares.find((x) => x.mealId === mealId)?.pct ?? null;
  const setShare = (mealId: number, pct: number | null) =>
    setP((cur) => ({
      ...cur,
      mealShares: [...cur.mealShares.filter((x) => x.mealId !== mealId), ...(pct ? [{ mealId, pct: Math.max(0, Math.min(100, Math.round(pct))) }] : [])].sort((a, b) => a.mealId - b.mealId),
    }));
  /** A usual split: breakfast a quarter, lunch and dinner the most, snacks the rest; else equal parts. */
  const suggestShares = () => {
    const list = meals.data ?? [];
    const usual = list.length === 4 ? [25, 35, 30, 10] : list.map((_, i) => Math.floor(100 / list.length) + (i < 100 % list.length ? 1 : 0));
    set('mealShares', list.map((m, i) => ({ mealId: m.id, pct: usual[i] })));
  };
  const toggleShiftDay = (d: number) =>
    setP((cur) => {
      const days = cur.shiftDays.includes(d) ? cur.shiftDays.filter((x) => x !== d) : [...cur.shiftDays, d].sort();
      return { ...cur, shiftDays: days, shiftKcal: days.length && !cur.shiftKcal ? 300 : cur.shiftKcal };
    });

  const save = async () => {
    if (p.mealShares.length && sharesTotal !== 100) {
      setFormError(t(`The shares per meal add up to ${sharesTotal} %; make that 100 %, or clear them.`, `De verdeling per maaltijd komt uit op ${sharesTotal} %; maak daar 100 % van, of wis hem.`));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await api.saveProfile({ ...p, language: getLang() });
      toast(t('Profile saved', 'Profiel opgeslagen'));
      refreshInfo();
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const choosePhase = (phase: Phase) => {
    setP((cur) => ({ ...cur, phase, ratePctPerWeek: RATES[phase].includes(cur.ratePctPerWeek) ? cur.ratePctPerWeek : (RATES[phase][1] ?? RATES[phase][0] ?? cur.ratePctPerWeek) }));
  };
  const perWeekKg = (rate: number) => (p.weightKg ? ` · ${kg((rate / 100) * p.weightKg)} kg` : '');

  return (
    <main className="page">
      <div className="page-head">
        <h1>{isNew ? t('Set up your profile', 'Profiel instellen') : t('Profile', 'Profiel')}</h1>
      </div>
      {isNew && (
        <p className="muted" style={{ marginTop: -8 }}>
          {t(
            'A few details so your targets fit you. You can change everything later.',
            'Een paar gegevens zodat je doelen bij je passen. Je kunt alles later aanpassen.',
          )}
        </p>
      )}

      <section className="section stack">
        <div className="field">
          <span>{t('Language', 'Taal')}</span>
          <div className="seg">
            {LANGUAGES.map((l) => (
              <button key={l.id} type="button" lang={l.id} aria-pressed={getLang() === l.id} onClick={() => void chooseLanguage(l.id)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="section stack">
        <h2>{t('About you', 'Over jou')}</h2>
        <label className="field">
          <span>{t('Name', 'Naam')}</span>
          <input className="input" value={p.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
        </label>
        <div className="field">
          <span>{t('Sex (for the energy formula)', 'Geslacht (voor de energieformule)')}</span>
          <div className="seg">
            {(['male', 'female'] as Sex[]).map((s) => (
              <button key={s} type="button" aria-pressed={p.sex === s} onClick={() => set('sex', s)}>
                {s === 'male' ? t('Man', 'Man') : t('Woman', 'Vrouw')}
              </button>
            ))}
          </div>
        </div>
        <div className="grid-3">
          <NumberField label={t('Age', 'Leeftijd')} value={p.age} digits={0} onChange={(v) => set('age', v === null ? null : Math.round(v))} />
          <NumberField label={t('Height', 'Lengte')} suffix="cm" value={p.heightCm} digits={0} onChange={(v) => set('heightCm', v)} />
          <NumberField label={t('Weight', 'Gewicht')} suffix="kg" value={p.weightKg} onChange={(v) => set('weightKg', v)} />
        </div>
        <p className="faint small" style={{ margin: 0 }}>
          {t(
            'Your weight follows your latest weigh-in (Progress); changing it here also logs today’s weight.',
            'Je gewicht volgt je laatste weging (Voortgang); als je het hier aanpast, wordt het ook als weging van vandaag opgeslagen.',
          )}
        </p>
      </section>

      <StrengthSection
        onPrefill={(sp) => setP((cur) => ({ ...cur, age: sp.age, heightCm: sp.heightCm, weightKg: cur.weightKg ?? sp.weightKg }))}
        phaseSaved={Boolean(saved)}
      />

      <section className="section stack">
        <h2>{t('Activity outside training', 'Activiteit buiten training')}</h2>
        <div className="list" role="radiogroup" aria-label={t('Activity outside training', 'Activiteit buiten training')}>
          {NEAT().map((o) => (
            <button key={o.value} className="list-row" role="radio" aria-checked={p.neat === o.value} onClick={() => set('neat', o.value)}>
              <div className="grow">
                <div className="title">{o.label}</div>
                <div className="sub">{o.sub}</div>
              </div>
              <span className={`radio${p.neat === o.value ? ' on' : ''}`} aria-hidden="true" />
            </button>
          ))}
        </div>
        <p className="faint small" style={{ margin: 0 }}>
          {t('Training is not part of this; it is added on training days.', 'Training hoort hier niet bij; die komt erbij op trainingsdagen.')}
        </p>
      </section>

      <section className="section stack">
        <h2>{t('Goal', 'Doel')}</h2>
        <div className="seg">
          {(['cut', 'maintain', 'bulk'] as Phase[]).map((ph) => (
            <button key={ph} type="button" aria-pressed={p.phase === ph} onClick={() => choosePhase(ph)}>
              {{ cut: t('Lose fat', 'Afvallen'), maintain: t('Maintain', 'Op gewicht'), bulk: t('Build', 'Aankomen') }[ph]}
            </button>
          ))}
        </div>
        {p.phase !== 'maintain' && (
          <div className="field">
            <span>{t('Pace (% of body weight per week)', 'Tempo (% van je gewicht per week)')}</span>
            <div className="chips">
              {RATES[p.phase].map((r) => (
                <button key={r} type="button" aria-pressed={p.ratePctPerWeek === r} onClick={() => set('ratePctPerWeek', r)}>
                  {num(r, 2)} %{perWeekKg(r)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <span>{t('Protein', 'Eiwit')}</span>
          <div className="seg">
            <button type="button" aria-pressed={p.proteinGPerKg === null} onClick={() => set('proteinGPerKg', null)}>
              {t('Automatic', 'Automatisch')} ({num(p.phase === 'cut' ? 2 : 1.8, 1)} g/kg)
            </button>
            <button type="button" aria-pressed={p.proteinGPerKg !== null} onClick={() => set('proteinGPerKg', p.proteinGPerKg ?? (p.phase === 'cut' ? 2 : 1.8))}>
              {t('My own', 'Zelf instellen')}
            </button>
          </div>
        </div>
        {p.proteinGPerKg !== null && (
          <NumberField label={t('Protein per kg body weight', 'Eiwit per kg lichaamsgewicht')} suffix="g" value={p.proteinGPerKg} onChange={(v) => set('proteinGPerKg', v ?? 1.8)} />
        )}
      </section>

      <section className="section stack" aria-label={t('Over the week', 'Over de week')}>
        <h2>{t('Over the week', 'Over de week')}</h2>
        <div className="field">
          <span>{t('Higher days', 'Hogere dagen')}</span>
          <div className="chips wrap">
            {WEEKDAYS().map((label, i) => (
              <button key={i} type="button" aria-pressed={p.shiftDays.includes(i + 1)} disabled={!p.shiftDays.includes(i + 1) && p.shiftDays.length >= 6} onClick={() => toggleShiftDay(i + 1)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {p.shiftDays.length > 0 && (
          <div className="field">
            <span>{t('Extra on those days', 'Extra op die dagen')}</span>
            <div className="chips wrap">
              {SHIFT_KCAL.map((k) => (
                <button key={k} type="button" aria-pressed={p.shiftKcal === k} onClick={() => set('shiftKcal', k)}>
                  +{k} kcal
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="faint small" style={{ margin: 0 }}>
          {t(
            'Eat more on the days you pick, such as the weekend. The other days get a bit less, so your week adds up to the same and your pace doesn’t change. “How your target is built” shows the numbers.',
            'Eet meer op de dagen die je kiest, zoals het weekend. De andere dagen krijgen iets minder, zodat je week hetzelfde uitkomt en je tempo niet verandert. “Hoe je doel is opgebouwd” toont de getallen.',
          )}
        </p>
      </section>

      <section className="section stack" aria-label={t('Per meal', 'Per maaltijd')}>
        <div className="spread">
          <h2>{t('Per meal', 'Per maaltijd')}</h2>
          {p.mealShares.length > 0 ? (
            <button type="button" className="link-btn" onClick={() => set('mealShares', [])}>
              {t('Clear', 'Wissen')}
            </button>
          ) : (
            <button type="button" className="link-btn" onClick={suggestShares}>
              {t('Use a usual split', 'Gebruikelijke verdeling')}
            </button>
          )}
        </div>
        <div className="grid-2">
          {(meals.data ?? []).map((m) => (
            <NumberField key={m.id} label={m.name} suffix="%" digits={0} value={shareOf(m.id)} onChange={(v) => setShare(m.id, v)} />
          ))}
        </div>
        <p className={`small ${p.mealShares.length && sharesTotal !== 100 ? 'error' : 'faint'}`} style={{ margin: 0 }}>
          {p.mealShares.length
            ? t(`Total ${sharesTotal} % (has to be 100 %). The diary then shows a target per meal.`, `Totaal ${sharesTotal} % (moet 100 % zijn). Het dagboek toont dan een doel per maaltijd.`)
            : t('Optional: split your day’s target over the meals, and the diary shows a target per meal.', 'Optioneel: verdeel je dagdoel over de maaltijden, dan toont het dagboek een doel per maaltijd.')}
        </p>
      </section>

      <section className="section stack">
        <h2>{t('Training', 'Training')}</h2>
        <div className="grid-2">
          <NumberField label={t('Usual training length', 'Gebruikelijke trainingsduur')} suffix="min" value={p.trainingMinutes} digits={0} onChange={(v) => set('trainingMinutes', Math.round(v ?? 60))} />
          <NumberField label={t('Intensity (MET)', 'Intensiteit (MET)')} value={p.metStrength} onChange={(v) => set('metStrength', v ?? 5)} />
        </div>
        <div className="field">
          <span>{t('Count training energy', 'Trainingsenergie meetellen')}</span>
          <div className="seg">
            {[0, 50, 100].map((share) => (
              <button key={share} type="button" aria-pressed={p.workoutEnergyShare === share} onClick={() => set('workoutEnergyShare', share)}>
                {share} %
              </button>
            ))}
          </div>
        </div>
        <label className="row" style={{ gap: 12 }}>
          <input type="checkbox" checked={p.carbCycling} onChange={(e) => set('carbCycling', e.target.checked)} />
          <span>{t('Extra energy on training days goes to carbohydrates', 'Extra energie op trainingsdagen gaat naar koolhydraten')}</span>
        </label>
        <p className="faint small" style={{ margin: 0 }}>
          {t(
            'The usual length counts when you mark a day as a training day before you train. Strength training is about MET 5.',
            'De gebruikelijke duur telt als je een dag als trainingsdag markeert voordat je traint. Krachttraining is ongeveer MET 5.',
          )}
        </p>
      </section>

      <section className="section stack">
        <label className="field">
          <span>{t('Time zone', 'Tijdzone')}</span>
          <input
            className="input"
            value={p.timeZone}
            placeholder={info.timeZone}
            maxLength={64}
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => set('timeZone', e.target.value.trim())}
          />
        </label>
        <p className="faint small" style={{ margin: 0 }}>
          {t(
            `A day in the diary runs from midnight to midnight in this zone. Empty means the server default (${info.timeZone}).`,
            `Een dag in het dagboek loopt van middernacht tot middernacht in deze zone. Leeg betekent de standaard van de server (${info.timeZone}).`,
          )}
        </p>
      </section>

      <section className="section stack">
        {formError && <p className="error">{formError}</p>}
        <button className="btn primary big block" disabled={saving} onClick={() => void save()}>
          {t('Save', 'Opslaan')}
        </button>
        {saved && (
          <Link className="btn block" to="/targets">
            {t('How your target is built', 'Hoe je doel is opgebouwd')}
          </Link>
        )}
      </section>

      <PicnicSection />
      <DataSection />
      <AboutSection />
    </main>
  );
}

/**
 * The link with Open Strength: its status and training goal, a gentle note when goal and phase pull different
 * ways, and a button to take age, height and weight from there. Loaded after the page, never blocking it.
 */
function StrengthSection({ onPrefill, phaseSaved }: { onPrefill: (p: NonNullable<LinkedStrength['profile']>) => void; phaseSaved: boolean }) {
  const { data } = useLoad(() => api.linkedStrength().catch(() => null));
  if (!data) return null;
  const goal = data.profile
    ? { hypertrophy: t('muscle growth', 'spiermassa'), strength: t('strength', 'kracht'), conditioning: t('conditioning', 'conditie'), fat_loss: t('fat loss', 'vetverlies') }[data.profile.goal]
    : null;
  return (
    <section className="section stack" aria-label="Open Strength">
      <h2>Open Strength</h2>
      <div className="panel small stack" style={{ gap: 6 }}>
        <div>
          {data.status === 'ok'
            ? t('Linked: workouts count on training days, and your weigh-ins are shared.', 'Gekoppeld: trainingen tellen mee op trainingsdagen, en je wegingen worden gedeeld.')
            : data.status === 'unreachable'
              ? t('Open Strength is not reachable right now; mark training days yourself.', 'Open Strength is nu niet bereikbaar; markeer trainingsdagen zelf.')
              : t('Not linked. Mark training days yourself on Today.', 'Niet gekoppeld. Markeer trainingsdagen zelf op Vandaag.')}
        </div>
        {goal && <div className="muted">{t(`Training goal there: ${goal}`, `Trainingsdoel daar: ${goal}`)}</div>}
        {data.pendingWeights > 0 && <div className="faint">{t(`${data.pendingWeights} weigh-ins waiting to be sent.`, `${data.pendingWeights} wegingen wachten om verstuurd te worden.`)}</div>}
      </div>
      {data.clash && phaseSaved && <p className="notice small" style={{ margin: 0 }}>{data.clash}</p>}
      {data.profile && (
        <button className="btn block" onClick={() => onPrefill(data.profile!)}>
          {t('Use age, height and weight from Open Strength', 'Leeftijd, lengte en gewicht uit Open Strength gebruiken')}
        </button>
      )}
    </section>
  );
}

/**
 * Picnic (optional, experimental): link your account to add products from your recent deliveries. Your password goes
 * to Picnic only; the app keeps the key Picnic hands out, never in the browser.
 */
function PicnicSection() {
  const refreshInfo = useRefreshInfo();
  const { data, setData } = useLoad(() => api.picnic().catch(() => null));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const run = async (fn: () => Promise<PicnicStatus | void>, done?: string) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setData(next);
      if (done) toast(done);
      refreshInfo();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const login = () =>
    run(async () => {
      const s = await api.picnicLogin(email.trim(), password);
      setPassword('');
      // Picnic asks for a code: send it straight away.
      if (s.awaiting2fa) await api.picnicSend2fa('SMS');
      return s;
    });

  return (
    <section className="section stack" aria-label="Picnic">
      <h2>Picnic</h2>
      {data.linked ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            {t(
              `Linked since ${data.linkedAt ? longDate(data.linkedAt.slice(0, 10)) : ''}. Under Add food → Picnic you find what was delivered lately.`,
              `Gekoppeld sinds ${data.linkedAt ? longDate(data.linkedAt.slice(0, 10)) : ''}. Onder Eten toevoegen → Picnic vind je wat er laatst bezorgd is.`,
            )}
          </p>
          <button className="btn block" disabled={busy} onClick={() => void run(() => api.picnicUnlink(), t('Picnic unlinked', 'Picnic ontkoppeld'))}>
            {t('Unlink Picnic', 'Picnic ontkoppelen')}
          </button>
        </>
      ) : data.awaiting2fa ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.picnicVerify2fa(code.trim()), t('Picnic linked', 'Picnic gekoppeld'));
          }}
        >
          <p className="muted small" style={{ margin: 0 }}>
            {t('Picnic sent you a code by text message.', 'Picnic heeft je een code per sms gestuurd.')}
          </p>
          <label className="field">
            <span>{t('Code', 'Code')}</span>
            <input className="input num" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn primary block" disabled={busy || code.trim().length < 3}>
            {t('Confirm', 'Bevestigen')}
          </button>
          <button type="button" className="link-btn small" disabled={busy} onClick={() => void run(async () => void (await api.picnicSend2fa('SMS')), t('Code sent again', 'Code opnieuw verstuurd'))}>
            {t('Send the code again', 'Code opnieuw sturen')}
          </button>
        </form>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <p className="muted small" style={{ margin: 0 }}>
            {t(
              'Optional and experimental: add products from your Picnic deliveries. Picnic has no official link, so this can stop working when Picnic changes its app. Your password goes to Picnic only and is not stored.',
              'Optioneel en experimenteel: producten uit je Picnic-bezorgingen toevoegen. Picnic heeft geen officiële koppeling, dus dit kan ophouden als Picnic zijn app verandert. Je wachtwoord gaat alleen naar Picnic en wordt niet bewaard.',
            )}
          </p>
          <label className="field">
            <span>{t('Picnic e-mail', 'Picnic-e-mail')}</span>
            <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('Picnic password', 'Picnic-wachtwoord')}</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn block" disabled={busy || !email.trim() || !password}>
            {t('Link Picnic', 'Picnic koppelen')}
          </button>
        </form>
      )}
    </section>
  );
}

function DataSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const nevoRef = useRef<HTMLInputElement>(null);
  const [nevoBusy, setNevoBusy] = useState(false);

  const importNevo = async (file: File) => {
    setNevoBusy(true);
    try {
      const { nevo } = await api.importNevo(file);
      toast(t(`${nevo.count} NEVO foods imported (version ${nevo.version})`, `${nevo.count} NEVO-voedingsmiddelen geïmporteerd (versie ${nevo.version})`));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setNevoBusy(false);
      if (nevoRef.current) nevoRef.current.value = '';
    }
  };

  const importFile = async (file: File) => {
    if (!confirm(t('Importing replaces all current data. Continue?', 'Importeren vervangt alle huidige gegevens. Doorgaan?'))) return;
    try {
      await api.importJson(JSON.parse(await file.text()));
      toast(t('Data imported', 'Gegevens geïmporteerd'));
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <section className="section stack">
      <h2>{t('Data', 'Gegevens')}</h2>
      <p className="faint small" style={{ margin: 0 }}>
        {t(
          'Database backups happen on the server. Exports are for your own copy or to move your data.',
          'Back-ups van de database gebeuren op de server. Exports zijn voor je eigen kopie of om gegevens te verhuizen.',
        )}
      </p>
      <div className="list">
        <a className="list-row" href="/api/export/json" download>
          <div className="grow">
            <div className="title">{t('Export everything', 'Alles exporteren')}</div>
            <div className="sub">{t('JSON file with all your data (without NEVO data)', 'JSON-bestand met al je gegevens (zonder NEVO-gegevens)')}</div>
          </div>
        </a>
        <a className="list-row" href="/api/export/diary.csv" download>
          <div className="grow">
            <div className="title">{t('Export the diary as CSV', 'Dagboek exporteren als CSV')}</div>
            <div className="sub">{t('Every logged item, for spreadsheets', 'Alles wat je gelogd hebt, voor spreadsheets')}</div>
          </div>
        </a>
        <button className="list-row" onClick={() => fileRef.current?.click()}>
          <div className="grow">
            <div className="title">{t('Import from an export file', 'Importeren uit exportbestand')}</div>
            <div className="sub">{t('Replaces the current data; NEVO stays', 'Vervangt de huidige gegevens; NEVO blijft staan')}</div>
          </div>
        </button>
        <button className="list-row" disabled={nevoBusy} onClick={() => nevoRef.current?.click()}>
          <div className="grow">
            <div className="title">{nevoBusy ? t('Importing NEVO…', 'NEVO importeren…') : t('Import NEVO file', 'NEVO-bestand importeren')}</div>
            <div className="sub">{t('The CSV (or .zip) from NEVO-online, after accepting RIVM’s conditions', 'De CSV (of .zip) van NEVO-online, na het accepteren van de voorwaarden van het RIVM')}</div>
          </div>
        </button>
      </div>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
      <input
        ref={nevoRef}
        type="file"
        accept=".csv,.txt,.zip,text/csv,application/zip"
        hidden
        aria-label={t('NEVO file', 'NEVO-bestand')}
        onChange={(e) => e.target.files?.[0] && void importNevo(e.target.files[0])}
      />
    </section>
  );
}

function AboutSection() {
  const info = useInfo();
  return (
    <section className="section stack">
      <h2>{t('About the app', 'Over de app')}</h2>
      <div className="list">
        <Link className="list-row" to="/ai">
          <div className="grow">
            <div className="title">{t('AI settings and usage', 'AI-instellingen en verbruik')}</div>
            <div className="sub">
              {info.aiConfigured
                ? t(`On: ${info.aiModel}`, `Aan: ${info.aiModel}`)
                : t('Off: describing or photographing meals is off, the coach shows facts', 'Uit: maaltijden beschrijven of fotograferen staat uit, de coach toont feiten')}
            </div>
          </div>
        </Link>
        <Link className="list-row" to="/recipes">
          <div className="grow">
            <div className="title">{t('My recipes', 'Mijn recepten')}</div>
          </div>
        </Link>
        <Link className="list-row" to="/sources">
          <div className="grow">
            <div className="title">{t('Sources', 'Bronnen')}</div>
            <div className="sub">{t('Open Food Facts, NEVO and your own data', 'Open Food Facts, NEVO en je eigen gegevens')}</div>
          </div>
        </Link>
      </div>
      <div className="panel small muted stack" style={{ gap: 4 }}>
        {info.user && info.authMode !== 'none' && (
          <div>
            {t('Signed in as', 'Ingelogd als')} {info.user.name ?? info.user.username}
          </div>
        )}
        <div>
          {t('Version', 'Versie')} {versionLabel(info.version)}
        </div>
      </div>
      {info.authMode !== 'none' && (
        <button
          className="btn block"
          onClick={async () => {
            const res = await api.logout();
            location.href = res.redirect ?? '/';
          }}
        >
          {t('Sign out', 'Uitloggen')}
        </button>
      )}
    </section>
  );
}
