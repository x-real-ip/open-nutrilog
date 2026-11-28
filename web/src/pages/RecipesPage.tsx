import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { IconPlus } from '../components/Icons.tsx';
import { ErrorState, Loading, useLoad } from '../components/ui.tsx';
import { kcal } from '../format.ts';
import { t } from '../i18n.ts';

/** Your recipes. Log one from the diary like any product: as portions or in grams. */
export default function RecipesPage() {
  const { data, error, loading, reload } = useLoad(() => api.productLists());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? ''} onRetry={reload} />;
  const recipes = [...data.mine, ...data.hidden].filter((p) => p.source === 'recipe');

  return (
    <main className="page">
      <div className="page-head">
        <h1>{t('Recipes', 'Recepten')}</h1>
      </div>
      {recipes.length ? (
        <div className="list">
          {recipes.map((r) => (
            <Link key={r.id} className="list-row" to={`/recipes/${r.id}`}>
              <div className="grow">
                <div className="title">{r.name}</div>
                <div className="sub">
                  {r.servings[0] ? t(`${r.portions} portions · ${kcal((r.per100.kcal * r.servings[0].grams) / 100)} each`, `${r.portions} porties · ${kcal((r.per100.kcal * r.servings[0].grams) / 100)} per portie`) : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">
          {t('A recipe adds up its ingredients, so you can log a portion of it.', 'Een recept telt de ingrediënten op, zodat je er een portie van kunt loggen.')}
        </p>
      )}
      <section className="section">
        <Link className="btn primary big block" to="/recipes/new">
          <IconPlus size={20} /> {t('New recipe', 'Nieuw recept')}
        </Link>
      </section>
    </main>
  );
}
