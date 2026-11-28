import { api } from '../api.ts';
import { FastingCard } from '../components/FastingCard.tsx';
import { ErrorState, Loading, useLoad } from '../components/ui.tsx';
import { t } from '../i18n.ts';

/** The fasting timer with its history: change the start or the goal of a running fast, remove an old one. */
export default function FastingPage() {
  const { data, error, loading, reload } = useLoad(() => api.profile());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? ''} onRetry={reload} />;
  return (
    <main className="page">
      <div className="page-head">
        <h1>{t('Fasting', 'Vasten')}</h1>
      </div>
      <FastingCard defaultGoal={data.profile?.fastingGoalHours ?? 16} full />
      <p className="faint small">
        {t(
          'Fasting only keeps time: it doesn’t change your targets. What you eat still counts for the day you eat it.',
          'Vasten houdt alleen de tijd bij: het verandert je doelen niet. Wat je eet, telt gewoon mee voor de dag waarop je het eet.',
        )}
      </p>
    </main>
  );
}
