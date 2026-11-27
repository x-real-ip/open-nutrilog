import { useEffect, useRef, useState } from 'react';
import type { Language, Profile } from '@shared/types.ts';
import { api } from '../api.ts';
import { useInfo, useRefreshInfo, useSetLanguage } from '../App.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { versionLabel } from '../format.ts';
import { getLang, t } from '../i18n.ts';

type ProfileInput = Omit<Profile, 'updatedAt'>;

/** Each language is named in itself, so you can find yours whatever the current language is. */
const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'nl', label: 'Nederlands' },
];

const empty = (): ProfileInput => ({ name: '', language: getLang(), timeZone: '' });

/** Strip server-only fields so a saved profile can be sent back as is. */
function input(p: Profile): ProfileInput {
  const { updatedAt: _updatedAt, ...rest } = p;
  return rest;
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

  return (
    <main className="page">
      <div className="page-head">
        <h1>{isNew ? t('Set up your profile', 'Profiel instellen') : t('Profile', 'Profiel')}</h1>
      </div>
      {isNew && (
        <p className="muted" style={{ marginTop: -8 }}>
          {t('A few details so the app fits you. You can change everything later.', 'Een paar gegevens zodat de app bij je past. Je kunt alles later aanpassen.')}
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
