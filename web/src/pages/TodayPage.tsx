import { Link } from 'react-router-dom';
import { useInfo } from '../App.tsx';
import { api } from '../api.ts';
import { ErrorState, Loading, useLoad } from '../components/ui.tsx';
import { longDate, versionLabel } from '../format.ts';
import { t } from '../i18n.ts';

export default function TodayPage() {
  const info = useInfo();
  const { data, error, loading, reload } = useLoad(() => api.profile());

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

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

      {!data?.profile && (
        <section className="section panel stack">
          <p style={{ margin: 0 }}>{t('Welcome! Set up your profile to get started.', 'Welkom! Stel je profiel in om te beginnen.')}</p>
          <Link className="btn primary block" to="/profile">
            {t('Set up your profile', 'Profiel instellen')}
          </Link>
        </section>
      )}

      <section className="section stack">
        <Link className="btn block" to="/diary">
          {t('Open the diary', 'Dagboek openen')}
        </Link>
      </section>
    </main>
  );
}
