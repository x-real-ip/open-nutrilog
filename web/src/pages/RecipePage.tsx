import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Product, RecipeInput } from '@shared/types.ts';
import { NUTRIENT_KEYS, quantityOf, round, scale, type Nutrients } from '@shared/nutrition.ts';
import { api, ApiError } from '../api.ts';
import { BarcodeScanner } from '../components/BarcodeScanner.tsx';
import { ProductForm } from '../components/ProductForm.tsx';
import { AddFoodSheet, SourceBadge } from '../components/AddFoodSheet.tsx';
import { IconClose, IconPlus } from '../components/Icons.tsx';
import { ErrorState, Loading, SubpageHead, toast } from '../components/ui.tsx';
import { macroLine, parseNumber } from '../food.ts';
import { kcal, num } from '../format.ts';
import { t } from '../i18n.ts';

interface Line {
  product: Product;
  amount: string;
  unit: 'g' | 'ml' | 'serving';
  servingLabel: string | null;
}

function quantity(l: Line): number {
  return quantityOf(parseNumber(l.amount) ?? 0, l.unit, l.servingLabel, l.product.servings) ?? 0;
}

/** Totals of the ingredients; a nutrient is unknown only when no ingredient gives it (the same rule as the server). */
function totals(lines: Line[]): Nutrients {
  const parts = lines.map((l) => scale(l.product.per100, quantity(l)));
  return Object.fromEntries(
    NUTRIENT_KEYS.map((k) => {
      const known = parts.filter((p) => p[k] !== null);
      return [k, known.length ? round(known.reduce((a, p) => a + (p[k] as number), 0), 1) : null];
    }),
  ) as unknown as Nutrients;
}

/** A recipe: ingredients, the weight after cooking (optional) and the number of portions. */
export default function RecipePage() {
  const { id: idParam } = useParams();
  const id = idParam && idParam !== 'new' ? Number(idParam) : null;
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(id === null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [portions, setPortions] = useState('2');
  const [cooked, setCooked] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** A new product made while building the recipe (unknown barcode, "New", a Picnic draft); it becomes an ingredient. */
  const [newProduct, setNewProduct] = useState<{
    name?: string;
    barcode?: string | null;
    brand?: string;
    unit?: 'g' | 'ml';
    hint?: { title: string; text: string | null } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id === null) return;
    (async () => {
      try {
        const { recipe } = await api.recipe(id);
        const products = await Promise.all(recipe.ingredients.map((i) => api.product(i.productId).then((r) => r.product)));
        setName(recipe.product.name);
        setPortions(num(recipe.portions, 1));
        setCooked(recipe.cookedWeightG ? num(recipe.cookedWeightG, 0) : '');
        setLines(recipe.ingredients.map((i, n) => ({ product: products[n], amount: num(i.amount, 2), unit: i.unit, servingLabel: i.servingLabel })));
        setLoaded(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (error) return <ErrorState message={error} />;
  if (!loaded) return <Loading />;

  const portionCount = parseNumber(portions);
  const cookedWeight = cooked.trim() ? parseNumber(cooked) : null;
  const sum = totals(lines);
  const rawWeight = lines.reduce((a, l) => a + quantity(l), 0);
  const weight = cookedWeight ?? rawWeight;
  const valid =
    name.trim() !== '' &&
    lines.length > 0 &&
    portionCount !== null &&
    portionCount > 0 &&
    (cooked.trim() === '' || (cookedWeight !== null && cookedWeight > 0)) &&
    lines.every((l) => (parseNumber(l.amount) ?? 0) > 0);

  /** A new ingredient: one serving when the product has servings, otherwise 100 g/ml. */
  const addLine = (p: Product) =>
    setLines((ls) => [...ls, { product: p, amount: p.servings.length ? '1' : '100', unit: p.servings.length ? 'serving' : p.unit, servingLabel: p.servings[0]?.label ?? null }]);

  /** A scanned barcode: the product becomes an ingredient; an unknown one opens a new product with the barcode filled in. */
  const scanned = async (code: string) => {
    setScanning(false);
    try {
      const { product } = await api.barcode(code);
      addLine(product);
      toast(t(`Added: ${product.name}`, `Toegevoegd: ${product.name}`));
    } catch (e) {
      toast((e as Error).message);
      if (e instanceof ApiError && e.status === 404) setNewProduct({ barcode: code });
    }
  };

  const setLine = (i: number, change: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...change } : l)));

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const input: RecipeInput = {
      name: name.trim(),
      portions: portionCount!,
      cookedWeightG: cookedWeight,
      ingredients: lines.map((l) => ({ productId: l.product.id, amount: parseNumber(l.amount)!, unit: l.unit, servingLabel: l.unit === 'serving' ? l.servingLabel : null })),
    };
    try {
      const { recipe } = await api.saveRecipe(id, input);
      toast(t('Recipe saved', 'Recept opgeslagen'));
      if (id === null) navigate(`/recipes/${recipe.product.id}`, { replace: true });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (id === null || !confirm(t('Delete this recipe? What you logged stays in the diary.', 'Dit recept verwijderen? Wat je gelogd hebt, blijft in het dagboek.'))) return;
    try {
      await api.deleteProduct(id);
      toast(t('Recipe deleted', 'Recept verwijderd'));
      navigate('/recipes', { replace: true });
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <main className="page">
      <SubpageHead title={id === null ? t('New recipe', 'Nieuw recept') : t('Recipe', 'Recept')} fallback="/recipes" />

      <section className="stack">
        <label className="field">
          <span>{t('Name', 'Naam')}</span>
          <input className="input" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('Portions', 'Porties')}</span>
            <input className="input num" inputMode="decimal" value={portions} onChange={(e) => setPortions(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('Weight cooked (g, optional)', 'Gewicht bereid (g, optioneel)')}</span>
            <input className="input num" inputMode="decimal" placeholder={rawWeight ? num(rawWeight, 0) : ''} value={cooked} onChange={(e) => setCooked(e.target.value)} />
          </label>
        </div>
        <p className="faint small" style={{ margin: 0 }}>
          {t(
            'Weigh the dish after cooking for the right values per 100 g (cooking loses or adds water). Without it the ingredients are added up.',
            'Weeg het gerecht na het koken voor de juiste waarden per 100 g (koken kost of geeft water). Zonder gewicht worden de ingrediënten opgeteld.',
          )}
        </p>
      </section>

      <section className="section stack" aria-label={t('Ingredients', 'Ingrediënten')}>
        <h2>{t('Ingredients', 'Ingrediënten')}</h2>
        {lines.length > 0 && (
          <div className="list">
            {lines.map((l, i) => (
              <div className="list-row ingredient" key={`${l.product.id}-${i}`}>
                <div className="grow stack" style={{ gap: 8 }}>
                  <div className="spread">
                    <div>
                      <div className="title">{l.product.name}</div>
                      <div className="sub">
                        {l.product.brand} <SourceBadge source={l.product.source} /> · {kcal(scale(l.product.per100, quantity(l)).kcal)}
                      </div>
                    </div>
                    <button className="icon-btn" aria-label={t(`Remove ${l.product.name}`, `${l.product.name} verwijderen`)} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <IconClose size={18} />
                    </button>
                  </div>
                  <div className="row">
                    <input
                      className="input num"
                      style={{ maxWidth: 110, minHeight: 44 }}
                      inputMode="decimal"
                      aria-label={t(`Amount of ${l.product.name}`, `Hoeveelheid ${l.product.name}`)}
                      value={l.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value })}
                    />
                    <div className="chips">
                      <button aria-pressed={l.unit !== 'serving'} onClick={() => setLine(i, { unit: l.product.unit, servingLabel: null })}>
                        {l.product.unit}
                      </button>
                      {l.product.servings.map((s) => (
                        <button key={s.label} aria-pressed={l.unit === 'serving' && l.servingLabel === s.label} onClick={() => setLine(i, { unit: 'serving', servingLabel: s.label })}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <button className="btn add-food" onClick={() => setPicking(true)}>
          <IconPlus size={18} /> {t('Add an ingredient', 'Ingrediënt toevoegen')}
        </button>
      </section>

      {lines.length > 0 && portionCount && portionCount > 0 && (
        <section className="section panel stack" aria-label={t('Per portion', 'Per portie')}>
          <div className="spread">
            <span className="small muted">{t('Per portion', 'Per portie')}</span>
            <span className="small muted">
              {num(weight / portionCount, 0)} g · {t('per 100 g', 'per 100 g')} {weight > 0 ? kcal((sum.kcal / weight) * 100) : '–'}
            </span>
          </div>
          <div className="value num big-num">{kcal(sum.kcal / portionCount)}</div>
          <div className="muted small">{macroLine(scale(sum, (1 / portionCount) * 100))}</div>
        </section>
      )}

      <section className="section stack">
        <button className="btn primary big block" disabled={!valid || busy} onClick={() => void save()}>
          {t('Save recipe', 'Recept opslaan')}
        </button>
        {id !== null && (
          <button className="btn danger block" onClick={() => void remove()}>
            {t('Delete recipe', 'Recept verwijderen')}
          </button>
        )}
      </section>

      <AddFoodSheet
        open={picking}
        title={t('Add an ingredient', 'Ingrediënt toevoegen')}
        allowRecipes={false}
        onClose={() => setPicking(false)}
        onPick={(p) => {
          addLine(p);
          setPicking(false);
        }}
        onScan={() => {
          setPicking(false);
          setScanning(true);
        }}
        onNewProduct={(name) => {
          setPicking(false);
          setNewProduct({ name });
        }}
        onPicnicDraft={(d) => {
          setPicking(false);
          setNewProduct({ name: d.name, brand: d.brand, unit: d.unit, hint: { title: t('Picnic says', 'Volgens Picnic'), text: d.nutritionText } });
        }}
      />
      <BarcodeScanner open={scanning} onClose={() => setScanning(false)} onCode={(code) => void scanned(code)} />
      <ProductForm
        open={newProduct !== null}
        product={null}
        initialName={newProduct?.name}
        initialBarcode={newProduct?.barcode}
        initialBrand={newProduct?.brand}
        initialUnit={newProduct?.unit}
        hint={newProduct?.hint}
        onClose={() => setNewProduct(null)}
        onSaved={(p) => {
          setNewProduct(null);
          addLine(p);
        }}
      />
    </main>
  );
}
