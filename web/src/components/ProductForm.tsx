import { useEffect, useState } from 'react';
import type { Product, ProductInput } from '@shared/types.ts';
import { kcalFromMacros, NUTRIENT_KEYS, type NutrientKey, type Nutrients } from '@shared/nutrition.ts';
import { api } from '../api.ts';
import { parseNumber } from '../food.ts';
import { num } from '../format.ts';
import { getLang, t } from '../i18n.ts';
import { IconClose, IconPlus } from './Icons.tsx';
import { Sheet, toast } from './ui.tsx';

const LABELS = (): Record<NutrientKey, string> => ({
  kcal: t('Energy (kcal)', 'Energie (kcal)'),
  protein: t('Protein', 'Eiwit'),
  carbs: t('Carbohydrates', 'Koolhydraten'),
  sugars: t('of which sugars', 'waarvan suikers'),
  fat: t('Fat', 'Vet'),
  satFat: t('of which saturated', 'waarvan verzadigd'),
  fibre: t('Fibre', 'Vezels'),
  salt: t('Salt', 'Zout'),
});

type Texts = Record<NutrientKey, string>;
const toTexts = (n: Nutrients | null): Texts =>
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, n && n[k] !== null ? num(n[k]!, 2) : ''])) as Texts;

/**
 * Your own product, or a local edit of an OFF/NEVO product (the source data stays as it is; your version stands
 * in for it). Values per 100 g or 100 ml, optional servings and barcode.
 */
export function ProductForm({
  open,
  product,
  initialName,
  initialBarcode,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The product to edit; null for a new one. */
  product: Product | null;
  initialName?: string;
  initialBarcode?: string | null;
  onClose: () => void;
  onSaved: (p: Product) => void;
}) {
  const nl = getLang() === 'nl';
  const [name, setName] = useState('');
  const [otherName, setOtherName] = useState('');
  const [brand, setBrand] = useState('');
  const [barcode, setBarcode] = useState('');
  const [unit, setUnit] = useState<'g' | 'ml'>('g');
  const [values, setValues] = useState<Texts>(toTexts(null));
  const [servings, setServings] = useState<{ label: string; grams: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(product ? (nl ? product.nameNl : product.nameEn) || product.name : (initialName ?? ''));
    setOtherName(product ? ((nl ? product.nameEn : product.nameNl) === product.name ? '' : (nl ? product.nameEn : product.nameNl)) : '');
    setBrand(product?.brand ?? '');
    setBarcode(product?.barcode ?? initialBarcode ?? '');
    setUnit(product?.unit ?? 'g');
    setValues(toTexts(product?.per100 ?? null));
    setServings((product?.servings ?? []).map((s) => ({ label: s.label, grams: num(s.grams, 1) })));
    setError(null);
  }, [open, product, initialName, initialBarcode, nl]);

  const parsed = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, parseNumber(values[k])])) as Record<NutrientKey, number | null>;
  const kcalOk = parsed.kcal !== null && parsed.kcal >= 0 && parsed.kcal <= 1000;
  const badValue = NUTRIENT_KEYS.some((k) => values[k].trim() !== '' && (parsed[k] === null || parsed[k]! < 0 || parsed[k]! > 1000));
  const badServing = servings.some((s) => !s.label.trim() || !((parseNumber(s.grams) ?? 0) > 0));
  const valid = name.trim() !== '' && kcalOk && !badValue && !badServing;
  // A gentle check: energy far from what the macros add up to usually means a typo.
  const fromMacros = kcalFromMacros(parsed);
  const mismatch = kcalOk && fromMacros > 0 && Math.abs(fromMacros - parsed.kcal!) > Math.max(40, parsed.kcal! * 0.25);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const main = name.trim();
    const other = otherName.trim();
    const input: ProductInput = {
      nameEn: nl ? other || main : main,
      nameNl: nl ? main : other || main,
      brand: brand.trim(),
      barcode: barcode.trim() || null,
      unit,
      per100: { ...parsed, kcal: parsed.kcal! } as Nutrients,
      servings: servings.map((s) => ({ label: s.label.trim(), grams: parseNumber(s.grams)! })),
    };
    try {
      const res = product ? await api.updateProduct(product.id, input) : await api.createProduct(input);
      toast(product ? t('Product saved', 'Product opgeslagen') : t('Product added', 'Product toegevoegd'));
      onSaved(res.product);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!product || !confirm(t('Delete this product? What you logged stays in the diary.', 'Dit product verwijderen? Wat je gelogd hebt, blijft in het dagboek.'))) return;
    try {
      await api.deleteProduct(product.id);
      toast(product.overrideOf ? t('Your changes are removed', 'Je aanpassingen zijn verwijderd') : t('Product deleted', 'Product verwijderd'));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const fromDatabase = product && product.source !== 'custom';
  const labels = LABELS();

  return (
    <Sheet open={open} onClose={onClose} label={product ? t('Edit product', 'Product bewerken') : t('New product', 'Nieuw product')}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 style={{ margin: 0 }}>{product ? t('Edit product', 'Product bewerken') : t('New product', 'Nieuw product')}</h2>
        {fromDatabase && (
          <p className="notice" style={{ margin: 0 }}>
            {t(
              'Your changes are saved as your own version. The original data stays as it is, and you can go back to it by deleting your version.',
              'Je aanpassingen worden bewaard als je eigen versie. De oorspronkelijke gegevens blijven zoals ze zijn; door je versie te verwijderen ga je terug.',
            )}
          </p>
        )}
        <label className="field">
          <span>{t('Name', 'Naam')}</span>
          <input className="input" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} autoFocus={!product} />
        </label>
        <label className="field">
          <span>{nl ? 'Engelse naam (optioneel)' : 'Dutch name (optional)'}</span>
          <input className="input" value={otherName} maxLength={160} onChange={(e) => setOtherName(e.target.value)} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span>{t('Brand', 'Merk')}</span>
            <input className="input" value={brand} maxLength={120} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('Barcode', 'Barcode')}</span>
            <input className="input num" inputMode="numeric" value={barcode} maxLength={20} onChange={(e) => setBarcode(e.target.value)} />
          </label>
        </div>

        <div className="field">
          <span>{t('Values per', 'Waarden per')}</span>
          <div className="seg">
            <button type="button" aria-pressed={unit === 'g'} onClick={() => setUnit('g')}>
              100 g
            </button>
            <button type="button" aria-pressed={unit === 'ml'} onClick={() => setUnit('ml')}>
              100 ml
            </button>
          </div>
        </div>
        <div className="grid-2">
          {NUTRIENT_KEYS.map((k) => (
            <label key={k} className="field">
              <span>
                {labels[k]}
                {k === 'kcal' ? '' : ' (g)'}
              </span>
              <input
                className="input num"
                inputMode="decimal"
                value={values[k]}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        {mismatch && (
          <p className="notice small" style={{ margin: 0 }}>
            {t(
              `The macros add up to about ${Math.round(fromMacros)} kcal. Check the values?`,
              `De macro's komen uit op ongeveer ${Math.round(fromMacros)} kcal. Kloppen de waarden?`,
            )}
          </p>
        )}

        <div className="field">
          <span>{t('Servings', 'Porties')}</span>
          {servings.map((s, i) => (
            <div key={i} className="row">
              <input
                className="input"
                aria-label={t('Serving name', 'Naam van de portie')}
                placeholder={t('1 slice', '1 snee')}
                value={s.label}
                maxLength={60}
                onChange={(e) => setServings((list) => list.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              />
              <input
                className="input num"
                style={{ maxWidth: 110 }}
                inputMode="decimal"
                aria-label={unit === 'ml' ? 'ml' : t('Grams', 'Gram')}
                placeholder={unit}
                value={s.grams}
                onChange={(e) => setServings((list) => list.map((x, j) => (j === i ? { ...x, grams: e.target.value } : x)))}
              />
              <button type="button" className="icon-btn" aria-label={t('Remove serving', 'Portie verwijderen')} onClick={() => setServings((list) => list.filter((_, j) => j !== i))}>
                <IconClose size={18} />
              </button>
            </div>
          ))}
          {servings.length < 12 && (
            <button type="button" className="btn" onClick={() => setServings((list) => [...list, { label: '', grams: '' }])}>
              <IconPlus size={18} /> {t('Add a serving', 'Portie toevoegen')}
            </button>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        <button className="btn primary big block" disabled={!valid || busy}>
          {t('Save', 'Opslaan')}
        </button>
        {product && product.source === 'custom' && (
          <button type="button" className="btn danger block" onClick={() => void remove()}>
            {product.overrideOf ? t('Remove my changes', 'Mijn aanpassingen verwijderen') : t('Delete product', 'Product verwijderen')}
          </button>
        )}
      </form>
    </Sheet>
  );
}
