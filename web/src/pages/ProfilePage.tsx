import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Language, Phase, Profile, Sex } from '@shared/types.ts';
import { api } from '../api.ts';
import { useInfo, useRefreshInfo, useSetLanguage } from '../App.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { parseNumber } from '../food.ts';
import { kg, num, versionLabel } from '../format.ts';
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
});

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

  const save = async () => {
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

      <DataSection />
      <AboutSection />
    </main>
  );
}

function DataSection() {
  const fileRef = useRef<HTMLInputElement>(null);

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
            <div className="sub">{t('JSON file with all your data', 'JSON-bestand met al je gegevens')}</div>
          </div>
        </a>
        <button className="list-row" onClick={() => fileRef.current?.click()}>
          <div className="grow">
            <div className="title">{t('Import from an export file', 'Importeren uit exportbestand')}</div>
            <div className="sub">{t('Replaces the current data', 'Vervangt de huidige gegevens')}</div>
          </div>
        </button>
      </div>
      <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
    </section>
  );
}

function AboutSection() {
  const info = useInfo();
  return (
    <section className="section stack">
      <h2>{t('About the app', 'Over de app')}</h2>
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
