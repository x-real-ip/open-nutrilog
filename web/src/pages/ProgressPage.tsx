import { t } from '../i18n.ts';

export default function ProgressPage() {
  return (
    <main className="page">
      <div className="page-head">
        <h1>{t('Progress', 'Voortgang')}</h1>
      </div>
      <section className="section panel">
        <p className="muted" style={{ margin: 0 }}>
          {t(
            'Your weight trend and intake against your target show up here once you log.',
            'Je gewichtstrend en inname ten opzichte van je doel verschijnen hier zodra je logt.',
          )}
        </p>
      </section>
    </main>
  );
}
