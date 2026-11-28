import { api } from '../api.ts';
import { ErrorState, Loading, SubpageHead, useLoad } from '../components/ui.tsx';
import { longDate } from '../format.ts';
import { t } from '../i18n.ts';

/** About / sources: where the food data comes from, with the attributions the sources ask for. */
export default function SourcesPage() {
  const { data, error, loading, reload } = useLoad(() => api.sources());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? ''} onRetry={reload} />;

  return (
    <main className="page">
      <SubpageHead title={t('Sources', 'Bronnen')} fallback="/profile" />

      <section className="stack" aria-label="Open Food Facts">
        <h2>Open Food Facts</h2>
        <p style={{ margin: 0 }}>
          {t('Product data from ', 'Productgegevens van ')}
          <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">
            Open Food Facts
          </a>
          {t(', available under the ', ', beschikbaar onder de ')}
          <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noreferrer">
            Open Database License (ODbL)
          </a>
          .
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          {t(
            `${data.off.products} products from Open Food Facts are stored in this app. Your own products are never sent to Open Food Facts.`,
            `${data.off.products} producten van Open Food Facts staan in deze app. Je eigen producten gaan nooit naar Open Food Facts.`,
          )}
          {data.off.lastImport &&
            t(
              ` Last import of the Dutch and Belgian products: ${longDate(data.off.lastImport.at.slice(0, 10))}.`,
              ` Laatste import van de Nederlandse en Belgische producten: ${longDate(data.off.lastImport.at.slice(0, 10))}.`,
            )}
        </p>
      </section>

      <section className="section stack" aria-label="NEVO">
        <h2>NEVO</h2>
        {data.nevo ? (
          <>
            <p style={{ margin: 0 }}>{data.nevo.attribution}</p>
            <p className="muted small" style={{ margin: 0 }}>
              {t(
                `${data.nevo.count} foods, imported on ${longDate(data.nevo.importedAt.slice(0, 10))}. NEVO data is used unchanged; your changes are kept as your own version.`,
                `${data.nevo.count} voedingsmiddelen, geïmporteerd op ${longDate(data.nevo.importedAt.slice(0, 10))}. NEVO-gegevens worden ongewijzigd gebruikt; jouw aanpassingen worden als eigen versie bewaard.`,
              )}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t(
              'Not imported. NEVO (the Dutch food composition database of RIVM) is free after accepting RIVM’s conditions; download it from NEVO-online and import it under Profile → Data.',
              'Niet geïmporteerd. NEVO (het Nederlands Voedingsstoffenbestand van het RIVM) is gratis na het accepteren van de voorwaarden van het RIVM; download het van NEVO-online en importeer het onder Profiel → Gegevens.',
            )}
          </p>
        )}
        <a className="small" href="https://www.rivm.nl/en/dutch-food-composition-database" target="_blank" rel="noreferrer">
          {t('About NEVO at RIVM', 'Over NEVO bij het RIVM')}
        </a>
      </section>

      <section className="section stack">
        <h2>{t('Your own data', 'Je eigen gegevens')}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {t(
            'Products you add, recipes and what you log stay in this app (and its database). An export never contains NEVO data, only the NEVO codes your entries refer to.',
            'Producten die je toevoegt, recepten en wat je logt blijven in deze app (en de database). Een export bevat nooit NEVO-gegevens, alleen de NEVO-codes waar je logs naar verwijzen.',
          )}
        </p>
      </section>
    </main>
  );
}
