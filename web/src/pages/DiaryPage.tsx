import { Link, useParams } from 'react-router-dom';
import { useInfo } from '../App.tsx';
import { IconBack, IconChevron } from '../components/Icons.tsx';
import { dayLabel } from '../format.ts';
import { t } from '../i18n.ts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function shift(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** One day of the diary. "Today" comes from the server, so it follows the profile's time zone. */
export default function DiaryPage() {
  const info = useInfo();
  const params = useParams();
  const day = params.day && DAY.test(params.day) ? params.day : info.today;

  return (
    <main className="page">
      <div className="page-head spread">
        <Link className="icon-btn" to={`/diary/${shift(day, -1)}`} aria-label={t('Previous day', 'Vorige dag')}>
          <IconBack />
        </Link>
        <h1>{dayLabel(day, info.today)}</h1>
        <Link className="icon-btn" to={`/diary/${shift(day, 1)}`} aria-label={t('Next day', 'Volgende dag')}>
          <IconChevron />
        </Link>
      </div>
      <section className="section panel">
        <p className="muted" style={{ margin: 0 }}>
          {t('Nothing logged on this day yet.', 'Nog niets gelogd op deze dag.')}
        </p>
      </section>
    </main>
  );
}
