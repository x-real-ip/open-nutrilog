import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { DiaryEntry, Meal, Product } from '@shared/types.ts';
import { sumNutrients } from '@shared/nutrition.ts';
import { useInfo } from '../App.tsx';
import { api, ApiError, logSavedMeal, onQueueChange, pendingCount, removeEntry, withPending } from '../api.ts';
import { AddFoodSheet } from '../components/AddFoodSheet.tsx';
import { AmountSheet } from '../components/AmountSheet.tsx';
import { BarcodeScanner } from '../components/BarcodeScanner.tsx';
import { BulkSheet, type BulkScope } from '../components/BulkSheet.tsx';
import { IconBack, IconCheck, IconChevron, IconPlus } from '../components/Icons.tsx';
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
  | { kind: 'bulk'; mode: 'move' | 'copy'; scope: BulkScope; count: number }
  | null;

/** One day of the diary. "Today" comes from the server, so it follows the profile's time zone. */
export default function DiaryPage() {
  const info = useInfo();
  const params = useParams();
  const navigate = useNavigate();
  const day = params.day && DAY.test(params.day) ? params.day : info.today;
  const { data, error, loading, reload } = useLoad(() => api.day(day), [day]);
  const goal = useLoad(() => api.target(day), [day]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [, setTick] = useState(0);
  /** The entries picked for a bulk action; null when not picking. */
  const [selected, setSelected] = useState<Set<string> | null>(null);

  useEffect(() => setSelected(null), [day]);

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
  const dayGoal = goal.data?.target?.kcal ?? null;

  const toggle = (ids: string[], on: boolean) =>
    setSelected((cur) => {
      const next = new Set(cur ?? []);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  const picked = selected ? view.entries.filter((e) => selected.has(e.id)) : [];
  const n = picked.length;
  const items = (k: number) => (k === 1 ? 'item' : 'items');

  const deletePicked = async () => {
    if (!confirm(t(`Delete ${n} ${items(n)}?`, `${n} ${items(n)} verwijderen?`))) return;
    for (const e of picked) await removeEntry(e.id, day);
    setSelected(null);
    toast(t(`Deleted ${n} ${items(n)}`, `${n} ${items(n)} verwijderd`));
  };

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
          {dayGoal ? (
            <span className="value num">
              {Math.round(view.totals.kcal)}
              <span className="of-goal"> / {kcal(dayGoal)}</span>
            </span>
          ) : (
            <span className="value num">{kcal(view.totals.kcal)}</span>
          )}
          <span className="row" style={{ gap: 12 }}>
            {queued > 0 && <span className="tag warn">{t(`${queued} not synced yet`, `${queued} nog niet gesynchroniseerd`)}</span>}
            {view.entries.length > 0 && (
              <button className="link-btn" onClick={() => setSelected(selected ? null : new Set())}>
                {selected ? t('Done', 'Klaar') : t('Select', 'Selecteren')}
              </button>
            )}
          </span>
        </div>
        <div className="muted small">
          {macroLine(view.totals)}
          {dayGoal
            ? ` · ${view.totals.kcal > dayGoal ? t(`${Math.round(view.totals.kcal - dayGoal)} over`, `${Math.round(view.totals.kcal - dayGoal)} te veel`) : t(`${Math.round(dayGoal - view.totals.kcal)} left`, `nog ${Math.round(dayGoal - view.totals.kcal)}`)}`
            : ''}
        </div>
      </section>

      {meals.map((meal) => {
        const entries = view.entries.filter((e) => e.mealId === meal.id);
        const total = sumNutrients(entries.map((e) => e.nutrients));
        const allPicked = entries.length > 0 && entries.every((e) => selected?.has(e.id));
        const mealGoal = goal.data?.meals.find((g) => g.mealId === meal.id);
        return (
          <section key={meal.id} className="section meal" aria-label={meal.name}>
            <div className="spread meal-head">
              <button className="link-btn meal-name" onClick={() => setSheet({ kind: 'meal', meal })} aria-label={t(`${meal.name}: options`, `${meal.name}: opties`)}>
                <h2>{meal.name}</h2>
              </button>
              {selected && entries.length > 0 ? (
                <button
                  className="link-btn"
                  onClick={() => toggle(entries.map((e) => e.id), !allPicked)}
                  aria-label={allPicked ? t(`${meal.name}: select none`, `${meal.name}: niets selecteren`) : t(`${meal.name}: select all`, `${meal.name}: alles selecteren`)}
                >
                  {allPicked ? t('Select none', 'Niets selecteren') : t('Select all', 'Alles selecteren')}
                </button>
              ) : (
                <span className="muted num">
                  {mealGoal ? `${Math.round(total.kcal)} / ${kcal(mealGoal.kcal)}` : entries.length > 0 ? kcal(total.kcal) : ''}
                </span>
              )}
            </div>
            {entries.length > 0 && (
              <div className="list">
                {entries.map((e) => (
                  <button
                    key={e.id}
                    className={`list-row entry${view.pendingIds.has(e.id) ? ' pending' : ''}`}
                    aria-pressed={selected ? selected.has(e.id) : undefined}
                    onClick={() => (selected ? toggle([e.id], !selected.has(e.id)) : void openEntry(e))}
                  >
                    {selected && <span className="pick">{selected.has(e.id) && <IconCheck size={16} />}</span>}
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
            {!selected && (
              <button className="btn add-food" onClick={() => setSheet({ kind: 'add', mealId: meal.id })}>
                <IconPlus size={18} /> {t('Add food', 'Eten toevoegen')}
              </button>
            )}
          </section>
        );
      })}

      {selected && (
        <div className="select-bar" role="toolbar" aria-label={t('Selected items', 'Geselecteerde items')}>
          <div className="select-bar-inner">
            <span className="grow small">
              <strong className="num">{n}</strong> <span className="picked-word">{t('selected', 'geselecteerd')}</span>
            </span>
            <button className="btn small-btn" disabled={!n} onClick={() => setSheet({ kind: 'bulk', mode: 'move', scope: { entryIds: picked.map((e) => e.id) }, count: n })}>
              {t('Move', 'Verplaatsen')}
            </button>
            <button className="btn small-btn" disabled={!n} onClick={() => setSheet({ kind: 'bulk', mode: 'copy', scope: { entryIds: picked.map((e) => e.id) }, count: n })}>
              {t('Copy', 'Kopiëren')}
            </button>
            <button className="btn small-btn danger" disabled={!n} onClick={() => void deletePicked()}>
              {t('Delete', 'Verwijderen')}
            </button>
          </div>
        </div>
      )}

      <section className="section stack" style={selected ? { display: 'none' } : undefined}>
        {view.entries.length === 0 && (
          <button className="btn block" onClick={() => void copyYesterday()}>
            {t('Copy the day before', 'Vorige dag kopiëren')}
          </button>
        )}
        <button className="link-btn" onClick={() => void addMeal()}>
          {t('Add a meal', 'Maaltijd toevoegen')}
        </button>
        {goal.data && (
          <label className="row small muted" style={{ gap: 10 }}>
            <input
              type="checkbox"
              checked={goal.data.mark.incomplete}
              onChange={async (e) => {
                try {
                  goal.setData(await api.setMark(day, { incomplete: e.target.checked }));
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
        onSavedMeal={async (m) => {
          if (sheet?.kind !== 'add') return;
          setSheet(null);
          await logSavedMeal(m, day, sheet.mealId);
          toast(t(`Logged “${m.name}”`, `“${m.name}” gelogd`));
        }}
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
        entryIds={sheet?.kind === 'meal' ? view.entries.filter((e) => e.mealId === sheet.meal.id).map((e) => e.id) : []}
        onClose={() => setSheet(null)}
        onChanged={() => void reload()}
        onCopyToDays={() =>
          sheet?.kind === 'meal' &&
          setSheet({ kind: 'bulk', mode: 'copy', scope: { mealId: sheet.meal.id }, count: view.entries.filter((e) => e.mealId === sheet.meal.id).length })
        }
      />
      <BulkSheet
        open={sheet?.kind === 'bulk'}
        mode={sheet?.kind === 'bulk' ? sheet.mode : 'copy'}
        scope={sheet?.kind === 'bulk' ? sheet.scope : null}
        count={sheet?.kind === 'bulk' ? sheet.count : 0}
        day={day}
        today={info.today}
        meals={view.meals}
        onClose={() => setSheet(null)}
        onDone={() => {
          setSelected(null);
          void reload();
        }}
      />
    </main>
  );
}
