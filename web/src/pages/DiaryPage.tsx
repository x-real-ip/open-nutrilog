import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DiaryEntry, Meal, Product } from '@shared/types.ts';
import { sumNutrients } from '@shared/nutrition.ts';
import { useInfo } from '../App.tsx';
import { api, ApiError, onQueueChange, pendingCount, withPending } from '../api.ts';
import { AddFoodSheet } from '../components/AddFoodSheet.tsx';
import { AmountSheet } from '../components/AmountSheet.tsx';
import { BarcodeScanner } from '../components/BarcodeScanner.tsx';
import { IconBack, IconChevron, IconPlus } from '../components/Icons.tsx';
import { MealAiSheet } from '../components/MealAiSheet.tsx';
import { MealSheet } from '../components/MealSheet.tsx';
import { ProductForm } from '../components/ProductForm.tsx';
import { QuickAddSheet } from '../components/QuickAddSheet.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { amountLabel, macroLine } from '../food.ts';
import { addDaysTo, dayLabel, kcal } from '../format.ts';
import { t } from '../i18n.ts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type SheetState =
  | { kind: 'add'; mealId: number }
  | { kind: 'amount'; mealId: number; product: Product | null; entry: DiaryEntry | null }
  | { kind: 'quick'; mealId: number; entry: DiaryEntry | null }
  | {
      kind: 'product';
      mealId: number;
      product: Product | null;
      name?: string;
      barcode?: string | null;
      brand?: string;
      unit?: 'g' | 'ml';
      hint?: { title: string; text: string | null } | null;
      entry: DiaryEntry | null;
    }
  | { kind: 'scan'; mealId: number }
  | { kind: 'meal'; meal: Meal }
  | { kind: 'ai'; mode: 'text' | 'photo'; mealId: number }
  | null;

/** One day of the diary. "Today" comes from the server, so it follows the profile's time zone. */
export default function DiaryPage() {
  const info = useInfo();
  const params = useParams();
  const navigate = useNavigate();
  const day = params.day && DAY.test(params.day) ? params.day : info.today;
  const { data, error, loading, reload } = useLoad(() => api.day(day), [day]);
  const marks = useLoad(() => api.target(day).then((r) => r.mark), [day]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [, setTick] = useState(0);

  // Queued changes show right away (the overlay); after each send, reload what the server has.
  useEffect(
    () =>
      onQueueChange(() => {
        setTick((n) => n + 1);
        void reload();
      }),
    [day],
  );

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const view = withPending(data);
  const meals = view.meals.filter((m) => !m.hidden || view.entries.some((e) => e.mealId === m.id));
  const mealName = (id: number) => view.meals.find((m) => m.id === id)?.name ?? '';
  const queued = pendingCount();

  const openEntry = async (e: DiaryEntry) => {
    if (e.unit === 'kcal') return setSheet({ kind: 'quick', mealId: e.mealId, entry: e });
    let product: Product | null = null;
    if (e.productId) product = await api.product(e.productId).then((r) => r.product).catch(() => null);
    setSheet({ kind: 'amount', mealId: e.mealId, product, entry: e });
  };

  const onBarcode = async (code: string, mealId: number) => {
    setSheet(null);
    try {
      const { product } = await api.barcode(code);
      setSheet({ kind: 'amount', mealId, product, entry: null });
    } catch (e) {
      toast((e as Error).message);
      // Unknown barcode: add it yourself, with the barcode filled in.
      if (e instanceof ApiError && e.status === 404) setSheet({ kind: 'product', mealId, product: null, barcode: code, entry: null });
    }
  };

  const copyYesterday = async () => {
    try {
      await api.copy({ from: addDaysTo(day, -1), to: day });
      toast(t('Copied', 'Gekopieerd'));
      void reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const addMeal = async () => {
    const name = prompt(t('Name of the new meal', 'Naam van de nieuwe maaltijd'))?.trim();
    if (!name) return;
    try {
      await api.addMeal(name);
      void reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <main className="page">
      <div className="page-head day-head">
        <Link className="icon-btn" to={`/diary/${addDaysTo(day, -1)}`} aria-label={t('Previous day', 'Vorige dag')}>
          <IconBack />
        </Link>
        <label className="date-pick">
          <h1>{dayLabel(day, info.today)}</h1>
          <input
            type="date"
            aria-label={t('Pick a day', 'Kies een dag')}
            value={day}
            onChange={(e) => DAY.test(e.target.value) && navigate(`/diary/${e.target.value}`)}
          />
        </label>
        <Link className="icon-btn" to={`/diary/${addDaysTo(day, 1)}`} aria-label={t('Next day', 'Volgende dag')}>
          <IconChevron />
        </Link>
      </div>

      <section className="panel day-total" aria-label={t('Total of the day', 'Totaal van de dag')}>
        <div className="spread">
          <span className="value num">{kcal(view.totals.kcal)}</span>
          {queued > 0 && <span className="tag warn">{t(`${queued} not synced yet`, `${queued} nog niet gesynchroniseerd`)}</span>}
        </div>
        <div className="muted small">{macroLine(view.totals)}</div>
      </section>

      {meals.map((meal) => {
        const entries = view.entries.filter((e) => e.mealId === meal.id);
        const total = sumNutrients(entries.map((e) => e.nutrients));
        return (
          <section key={meal.id} className="section meal" aria-label={meal.name}>
            <div className="spread meal-head">
              <button className="link-btn meal-name" onClick={() => setSheet({ kind: 'meal', meal })} aria-label={t(`${meal.name}: options`, `${meal.name}: opties`)}>
                <h2>{meal.name}</h2>
              </button>
              <span className="muted num">{entries.length > 0 ? kcal(total.kcal) : ''}</span>
            </div>
            {entries.length > 0 && (
              <div className="list">
                {entries.map((e) => (
                  <button key={e.id} className={`list-row entry${view.pendingIds.has(e.id) ? ' pending' : ''}`} onClick={() => void openEntry(e)}>
                    <div className="grow">
                      <div className="title">{e.name}</div>
                      <div className="sub">
                        {[amountLabel(e), e.brand].filter(Boolean).join(' · ')}
                        {e.aiEstimate && <span className="badge estimate">{t('AI estimate', 'AI-schatting')}</span>}
                      </div>
                    </div>
                    <span className="num">{Math.round(e.nutrients.kcal)}</span>
                  </button>
                ))}
              </div>
            )}
            <button className="btn add-food" onClick={() => setSheet({ kind: 'add', mealId: meal.id })}>
              <IconPlus size={18} /> {t('Add food', 'Eten toevoegen')}
            </button>
          </section>
        );
      })}

      <section className="section stack">
        {view.entries.length === 0 && (
          <button className="btn block" onClick={() => void copyYesterday()}>
            {t('Copy the day before', 'Vorige dag kopiëren')}
          </button>
        )}
        <button className="link-btn" onClick={() => void addMeal()}>
          {t('Add a meal', 'Maaltijd toevoegen')}
        </button>
        {marks.data && (
          <label className="row small muted" style={{ gap: 10 }}>
            <input
              type="checkbox"
              checked={marks.data.incomplete}
              onChange={async (e) => {
                try {
                  marks.setData((await api.setMark(day, { incomplete: e.target.checked })).mark);
                } catch (err) {
                  toast((err as Error).message);
                }
              }}
            />
            <span>
              {t(
                'I didn’t log everything this day (it then doesn’t count for your own maintenance)',
                'Ik heb deze dag niet alles gelogd (hij telt dan niet mee voor je eigen onderhoud)',
              )}
            </span>
          </label>
        )}
      </section>

      <AddFoodSheet
        open={sheet?.kind === 'add'}
        title={sheet?.kind === 'add' ? t(`Add to ${mealName(sheet.mealId).toLowerCase()}`, `Toevoegen aan ${mealName(sheet.mealId).toLowerCase()}`) : ''}
        onClose={() => setSheet(null)}
        onPick={(product) => sheet?.kind === 'add' && setSheet({ kind: 'amount', mealId: sheet.mealId, product, entry: null })}
        onScan={() => sheet?.kind === 'add' && setSheet({ kind: 'scan', mealId: sheet.mealId })}
        onQuickAdd={() => sheet?.kind === 'add' && setSheet({ kind: 'quick', mealId: sheet.mealId, entry: null })}
        onNewProduct={(name) => sheet?.kind === 'add' && setSheet({ kind: 'product', mealId: sheet.mealId, product: null, name, entry: null })}
        onPicnicDraft={(d) =>
          sheet?.kind === 'add' &&
          setSheet({
            kind: 'product',
            mealId: sheet.mealId,
            product: null,
            name: d.name,
            brand: d.brand,
            unit: d.unit,
            hint: { title: t('Picnic says', 'Volgens Picnic'), text: d.nutritionText },
            entry: null,
          })
        }
        onDescribe={info.aiConfigured ? () => sheet?.kind === 'add' && setSheet({ kind: 'ai', mode: 'text', mealId: sheet.mealId }) : undefined}
        onPhoto={info.aiConfigured ? () => sheet?.kind === 'add' && setSheet({ kind: 'ai', mode: 'photo', mealId: sheet.mealId }) : undefined}
      />
      <AmountSheet
        open={sheet?.kind === 'amount'}
        product={sheet?.kind === 'amount' ? sheet.product : null}
        entry={sheet?.kind === 'amount' ? sheet.entry : null}
        day={day}
        mealId={sheet?.kind === 'amount' ? sheet.mealId : 1}
        meals={view.meals}
        onClose={() => setSheet(null)}
        onEditProduct={(product) => sheet?.kind === 'amount' && setSheet({ kind: 'product', mealId: sheet.mealId, product, entry: sheet.entry })}
      />
      <QuickAddSheet
        open={sheet?.kind === 'quick'}
        day={day}
        mealId={sheet?.kind === 'quick' ? sheet.mealId : 1}
        entry={sheet?.kind === 'quick' ? sheet.entry : null}
        onClose={() => setSheet(null)}
      />
      <ProductForm
        open={sheet?.kind === 'product'}
        product={sheet?.kind === 'product' ? sheet.product : null}
        initialName={sheet?.kind === 'product' ? sheet.name : undefined}
        initialBarcode={sheet?.kind === 'product' ? sheet.barcode : undefined}
        initialBrand={sheet?.kind === 'product' ? sheet.brand : undefined}
        initialUnit={sheet?.kind === 'product' ? sheet.unit : undefined}
        hint={sheet?.kind === 'product' ? sheet.hint : undefined}
        onClose={() => setSheet(null)}
        onSaved={(product) => sheet?.kind === 'product' && setSheet({ kind: 'amount', mealId: sheet.mealId, product, entry: sheet.entry })}
      />
      <BarcodeScanner open={sheet?.kind === 'scan'} onClose={() => setSheet(null)} onCode={(code) => sheet?.kind === 'scan' && void onBarcode(code, sheet.mealId)} />
      <MealAiSheet
        open={sheet?.kind === 'ai'}
        mode={sheet?.kind === 'ai' ? sheet.mode : 'text'}
        day={day}
        mealId={sheet?.kind === 'ai' ? sheet.mealId : 1}
        mealName={sheet?.kind === 'ai' ? mealName(sheet.mealId) : ''}
        onClose={() => setSheet(null)}
      />
      <MealSheet
        open={sheet?.kind === 'meal'}
        meal={sheet?.kind === 'meal' ? sheet.meal : null}
        day={day}
        today={info.today}
        hasEntries={sheet?.kind === 'meal' ? view.entries.some((e) => e.mealId === sheet.meal.id) : false}
        onClose={() => setSheet(null)}
        onChanged={() => void reload()}
      />
    </main>
  );
}
