import { useEffect, useRef, useState } from 'react';
import type { LabelReading, Product, ProductInput } from '@shared/types.ts';
import { kcalFromMacros, NUTRIENT_KEYS, type NutrientKey, type Nutrients } from '@shared/nutrition.ts';
import { useInfo } from '../App.tsx';
import { api } from '../api.ts';
import { parseNumber } from '../food.ts';
import { num } from '../format.ts';
import { getLang, t } from '../i18n.ts';
import { resizePhoto } from '../photo.ts';
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
  initialBrand,
  initialUnit,
  hint,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** The product to edit; null for a new one. */
  product: Product | null;
  initialName?: string;
  initialBarcode?: string | null;
  initialBrand?: string;
  initialUnit?: 'g' | 'ml';
  /** Text to copy values from, e.g. Picnic's "Voedingswaarde" section, shown above the values. */
  hint?: { title: string; text: string | null } | null;
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
  const [reading, setReading] = useState(false);
  const [fromLabel, setFromLabel] = useState(false);
  const labelInput = useRef<HTMLInputElement>(null);
  const info = useInfo();

  useEffect(() => {
    if (!open) return;
    setName(product ? (nl ? product.nameNl : product.nameEn) || product.name : (initialName ?? ''));
    setOtherName(product ? ((nl ? product.nameEn : product.nameNl) === product.name ? '' : (nl ? product.nameEn : product.nameNl)) : '');
    setBrand(product?.brand ?? initialBrand ?? '');
    setBarcode(product?.barcode ?? initialBarcode ?? '');
    setUnit(product?.unit ?? initialUnit ?? 'g');
    setValues(toTexts(product?.per100 ?? null));
    setServings((product?.servings ?? []).map((s) => ({ label: s.label, grams: num(s.grams, 1) })));
    setError(null);
    setFromLabel(false);
  }, [open, product, initialName, initialBarcode, initialBrand, initialUnit, nl]);

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

  /** Fills the form from the label; name and brand only where they are still empty. */
  const applyLabel = (l: LabelReading) => {
    setUnit(l.unit);
    setValues(toTexts(l.per100));
    if (!name.trim() && l.name) setName(l.name);
    if (!brand.trim() && l.brand) setBrand(l.brand);
    const serving = l.serving;
    if (serving) setServings((list) => (list.some((s) => s.label.trim() === serving.label) ? list : [...list, { label: serving.label, grams: num(serving.grams, 1) }]));
    setFromLabel(true);
  };

  const readLabel = async (file: File) => {
    setReading(true);
    setError(null);
    try {
      applyLabel((await api.readLabel(await resizePhoto(file, 1568, 0.85))).label);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
      if (labelInput.current) labelInput.current.value = '';
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
          <input className="input" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
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

        {info.aiConfigured && (
          <div className="stack" style={{ gap: 4 }}>
            <button type="button" className="btn block" disabled={reading} onClick={() => labelInput.current?.click()}>
              {reading ? t('Reading the label…', 'Etiket lezen…') : t('Read the label from a photo', 'Etiket lezen van een foto')}
            </button>
            <input
              ref={labelInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label={t('Photo of the nutrition label', 'Foto van het voedingsetiket')}
              onChange={(e) => e.target.files?.[0] && void readLabel(e.target.files[0])}
            />
            <span className="small muted">
              {t(`The photo is sent to your AI provider (${info.aiModel}) and not kept.`, `De foto gaat naar je AI-aanbieder (${info.aiModel}) en wordt niet bewaard.`)}
            </span>
          </div>
        )}
        {fromLabel && (
          <p className="notice small" style={{ margin: 0 }}>
            {t('Read from the photo. Check the values against the pack before you save.', 'Gelezen van de foto. Controleer de waarden met de verpakking voordat je opslaat.')}
          </p>
        )}
        {hint && (
          <div className="panel small stack hint-text" style={{ gap: 6 }}>
            <b>{hint.title}</b>
            {hint.text ? <pre>{hint.text}</pre> : <span className="muted">{t('No nutrition values given; check the pack.', 'Geen voedingswaarden opgegeven; kijk op de verpakking.')}</span>}
          </div>
        )}
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
