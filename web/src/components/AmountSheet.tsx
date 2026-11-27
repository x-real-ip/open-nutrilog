import { useEffect, useState } from 'react';
import type { DiaryEntry, EntryInput, Meal, Product } from '@shared/types.ts';
import { quantityOf, scale, type EntryUnit } from '@shared/nutrition.ts';
import { api, newId, removeEntry, saveEntry } from '../api.ts';
import { amountLabel, macroLine, parseNumber, previewEntry } from '../food.ts';
import { kcal, kj, num } from '../format.ts';
import { t } from '../i18n.ts';
import { SourceBadge } from './AddFoodSheet.tsx';
import { IconBan, IconStar } from './Icons.tsx';
import { Sheet, toast } from './ui.tsx';

/** The unit choice: grams/ml, or one of the product's servings. */
type Choice = { unit: 'g' | 'ml' } | { unit: 'serving'; label: string };

function initialChoice(product: Product | null, entry: DiaryEntry | null): Choice {
  if (entry?.unit === 'serving' && entry.servingLabel) return { unit: 'serving', label: entry.servingLabel };
  if (entry && (entry.unit === 'g' || entry.unit === 'ml')) return { unit: entry.unit };
  if (product?.servings.length) return { unit: 'serving', label: product.servings[0].label };
  return { unit: product?.unit ?? 'g' };
}

/**
 * How much: the amount in grams/ml or servings, with the nutrients updating as you type. Logs a new entry, or
 * changes (moves, deletes) an existing one. Also the place to mark a product as favourite or hide it.
 */
export function AmountSheet({
  open,
  product: initialProduct,
  entry,
  day,
  mealId,
  meals,
  onClose,
  onEditProduct,
}: {
  open: boolean;
  product: Product | null;
  /** Set when changing an entry that is already in the diary. */
  entry: DiaryEntry | null;
  day: string;
  mealId: number;
  meals: Meal[];
  onClose: () => void;
  onEditProduct: (p: Product) => void;
}) {
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [choice, setChoice] = useState<Choice>(() => initialChoice(initialProduct, entry));
  const [text, setText] = useState('');
  const [meal, setMeal] = useState(mealId);

  useEffect(() => {
    if (!open) return;
    setProduct(initialProduct);
    const c = initialChoice(initialProduct, entry);
    setChoice(c);
    setText(entry ? num(entry.amount, 2) : c.unit === 'serving' ? '1' : '100');
    setMeal(entry?.mealId ?? mealId);
  }, [open, initialProduct, entry, mealId]);

  const amount = parseNumber(text);
  const valid = amount !== null && amount > 0 && amount <= 10_000;
  const unit: EntryUnit = choice.unit;
  const servingLabel = choice.unit === 'serving' ? choice.label : null;

  // Without a product (it was deleted after logging) the entry's own values are scaled.
  const quantity = product
    ? (quantityOf(amount ?? 0, unit, servingLabel, product.servings) ?? 0)
    : entry && entry.amount > 0
      ? (entry.quantity * (amount ?? 0)) / (entry.unit === 'serving' ? entry.amount : entry.quantity)
      : 0;
  const nutrients = product ? scale(product.per100, quantity) : entry ? scale(entry.nutrients, entry.quantity ? (quantity / entry.quantity) * 100 : 0) : null;

  const save = async () => {
    if (!valid) return;
    const input: EntryInput = { day, mealId: meal, productId: product?.id ?? entry?.productId ?? null, amount: amount!, unit, servingLabel };
    const id = entry?.id ?? newId();
    const preview = product ? previewEntry(id, input, product, entry?.createdAt) : { ...entry!, ...input, quantity, nutrients: nutrients! };
    await saveEntry(input, preview);
    onClose();
  };

  const remove = async () => {
    if (!entry) return;
    await removeEntry(entry.id, entry.day);
    onClose();
  };

  const mark = async (pref: 'favorite' | 'hidden') => {
    if (!product) return;
    const next = product.preference === pref ? null : pref;
    try {
      const res = await api.setPreference(product.id, next);
      setProduct(res.product);
      toast(
        next === 'favorite'
          ? t('Added to favourites', 'Toegevoegd aan favorieten')
          : next === 'hidden'
            ? t('Hidden from search and lists', 'Verborgen in zoeken en lijsten')
            : pref === 'favorite'
              ? t('Removed from favourites', 'Verwijderd uit favorieten')
              : t('Shown again', 'Weer zichtbaar'),
      );
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const name = product?.name ?? entry?.name ?? '';
  const base = product?.unit ?? (entry?.unit === 'ml' ? 'ml' : 'g');

  return (
    <Sheet open={open} onClose={onClose} label={name}>
      <div className="stack">
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0 }}>{name}</h2>
            <div className="muted small">
              {[product?.brand ?? entry?.brand].filter(Boolean).join(' · ')} <SourceBadge source={product?.source ?? entry?.source ?? null} />
            </div>
          </div>
          {product && (
            <div className="row">
              <button
                className={`icon-btn${product.preference === 'favorite' ? ' on' : ''}`}
                aria-pressed={product.preference === 'favorite'}
                aria-label={t('Favourite', 'Favoriet')}
                onClick={() => void mark('favorite')}
              >
                <IconStar size={20} filled={product.preference === 'favorite'} />
              </button>
              <button className="icon-btn" aria-pressed={product.preference === 'hidden'} aria-label={t('Hide', 'Verbergen')} onClick={() => void mark('hidden')}>
                <IconBan size={20} />
              </button>
            </div>
          )}
        </div>

        <div className="amount-row">
          <input
            className="input num amount"
            inputMode="decimal"
            aria-label={t('Amount', 'Hoeveelheid')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            autoFocus
          />
          {product ? (
            <div className="chips">
              <button aria-pressed={choice.unit !== 'serving'} onClick={() => setChoice({ unit: product.unit })}>
                {product.unit}
              </button>
              {product.servings.map((s) => (
                <button
                  key={s.label}
                  aria-pressed={choice.unit === 'serving' && choice.label === s.label}
                  onClick={() => setChoice({ unit: 'serving', label: s.label })}
                >
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            entry && <span className="muted">{entry.unit === 'serving' ? `× ${entry.servingLabel}` : entry.unit}</span>
          )}
        </div>

        {nutrients && (
          <div className="panel nutri">
            <div className="spread">
              <span className="value num">{kcal(nutrients.kcal)}</span>
              <span className="faint small">
                {kj(nutrients.kcal)}
                {choice.unit === 'serving' && quantity > 0 ? ` · ${num(quantity, 0)} ${base}` : ''}
              </span>
            </div>
            <div className="muted small">{macroLine(nutrients)}</div>
          </div>
        )}

        {entry && meals.length > 1 && (
          <div className="chips" aria-label={t('Meal', 'Maaltijd')}>
            {meals
              .filter((m) => !m.hidden || m.id === meal)
              .map((m) => (
                <button key={m.id} aria-pressed={meal === m.id} onClick={() => setMeal(m.id)}>
                  {m.name}
                </button>
              ))}
          </div>
        )}

        <button className="btn primary big block" disabled={!valid} onClick={() => void save()}>
          {entry ? t('Save', 'Opslaan') : t('Add', 'Toevoegen')}
        </button>
        <div className="grid-2">
          {product && (
            <button className="btn" onClick={() => onEditProduct(product)}>
              {product.source === 'custom' ? t('Edit product', 'Product bewerken') : t('Edit values', 'Waarden aanpassen')}
            </button>
          )}
          {entry && (
            <button className="btn danger" onClick={() => void remove()}>
              {t('Delete', 'Verwijderen')}
            </button>
          )}
        </div>
        {entry && <p className="faint small" style={{ margin: 0 }}>{t(`Logged: ${amountLabel(entry, base)}`, `Gelogd: ${amountLabel(entry, base)}`)}</p>}
      </div>
    </Sheet>
  );
}
