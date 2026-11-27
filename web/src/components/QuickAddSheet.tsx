import { useEffect, useState } from 'react';
import type { DiaryEntry, EntryInput } from '@shared/types.ts';
import { newId, removeEntry, saveEntry } from '../api.ts';
import { parseNumber, previewEntry } from '../food.ts';
import { num } from '../format.ts';
import { t } from '../i18n.ts';
import { Sheet } from './ui.tsx';

const field = (n: number | null | undefined) => (n === null || n === undefined ? '' : num(n, 1));

/** Energy only, or energy plus macros, without a product: for a restaurant meal or a quick estimate. */
export function QuickAddSheet({
  open,
  day,
  mealId,
  entry,
  onClose,
}: {
  open: boolean;
  day: string;
  mealId: number;
  entry: DiaryEntry | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [energy, setEnergy] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');

  useEffect(() => {
    if (!open) return;
    // A quick add without a name shows the default label; editing it starts empty again.
    const label = entry?.quick?.name ?? entry?.name ?? '';
    setName(label === t('Quick add', 'Snel toevoegen') ? '' : label);
    setEnergy(field(entry?.nutrients.kcal));
    setProtein(field(entry?.nutrients.protein));
    setCarbs(field(entry?.nutrients.carbs));
    setFat(field(entry?.nutrients.fat));
  }, [open, entry]);

  const kcal = parseNumber(energy);
  const macro = (s: string) => {
    const n = parseNumber(s);
    return n !== null && n >= 0 ? n : null;
  };
  const valid = kcal !== null && kcal >= 0 && kcal <= 10_000 && [protein, carbs, fat].every((s) => s.trim() === '' || macro(s) !== null);

  const save = async () => {
    if (!valid) return;
    const quick = { name: name.trim(), kcal: kcal!, protein: macro(protein), carbs: macro(carbs), fat: macro(fat) };
    const input: EntryInput = { day, mealId: entry?.mealId ?? mealId, productId: null, amount: Math.max(kcal!, 0.1), unit: 'kcal', quick };
    const id = entry?.id ?? newId();
    await saveEntry(input, previewEntry(id, input, null, entry?.createdAt));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} label={t('Quick add', 'Snel toevoegen')}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 style={{ margin: 0 }}>{t('Quick add', 'Snel toevoegen')}</h2>
        <label className="field">
          <span>{t('Name (optional)', 'Naam (optioneel)')}</span>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('Energy (kcal)', 'Energie (kcal)')}</span>
          <input className="input num" inputMode="decimal" value={energy} onChange={(e) => setEnergy(e.target.value)} autoFocus />
        </label>
        <div className="grid-3">
          <label className="field">
            <span>{t('Protein (g)', 'Eiwit (g)')}</span>
            <input className="input num" inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('Carbs (g)', 'Koolh. (g)')}</span>
            <input className="input num" inputMode="decimal" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('Fat (g)', 'Vet (g)')}</span>
            <input className="input num" inputMode="decimal" value={fat} onChange={(e) => setFat(e.target.value)} />
          </label>
        </div>
        <button className="btn primary big block" disabled={!valid}>
          {entry ? t('Save', 'Opslaan') : t('Add', 'Toevoegen')}
        </button>
        {entry && (
          <button
            type="button"
            className="btn danger block"
            onClick={async () => {
              await removeEntry(entry.id, entry.day);
              onClose();
            }}
          >
            {t('Delete', 'Verwijderen')}
          </button>
        )}
      </form>
    </Sheet>
  );
}
