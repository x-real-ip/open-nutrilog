import { useEffect, useRef, useState } from 'react';
import type { Product, ProductLists } from '@shared/types.ts';
import { api } from '../api.ts';
import { sourceLabel } from '../food.ts';
import { kcal } from '../format.ts';
import { t } from '../i18n.ts';
import { IconPlus, IconStar } from './Icons.tsx';
import { Sheet } from './ui.tsx';

type Tab = 'recent' | 'frequent' | 'favorites' | 'mine';

const TABS = (): { id: Tab; label: string }[] => [
  { id: 'recent', label: t('Recent', 'Recent') },
  { id: 'frequent', label: t('Frequent', 'Vaak') },
  { id: 'favorites', label: t('Favourites', 'Favorieten') },
  { id: 'mine', label: t('My foods', 'Mijn producten') },
];

export function SourceBadge({ source }: { source: Product['source'] | null }) {
  if (!source) return null;
  return <span className={`badge ${source}`}>{sourceLabel(source)}</span>;
}

export function ProductRow({ product, onPick }: { product: Product; onPick: (p: Product) => void }) {
  return (
    <button className={`list-row${product.preference === 'hidden' ? ' hidden-row' : ''}`} onClick={() => onPick(product)}>
      <div className="grow">
        <div className="title">
          {product.preference === 'favorite' && (
            <span className="fav-mark" aria-label={t('Favourite', 'Favoriet')}>
              <IconStar size={14} filled />
            </span>
          )}
          {product.name}
        </div>
        <div className="sub">
          {[product.brand, `${kcal(product.per100.kcal)} / 100 ${product.unit}`].filter(Boolean).join(' · ')} <SourceBadge source={product.source} />
        </div>
      </div>
    </button>
  );
}

/**
 * Finding something to log: a search over all products, or one of your lists. Picking a product opens the amount
 * sheet; scanning, quick add and a new product are one tap away.
 */
export function AddFoodSheet({
  open,
  mealName,
  onClose,
  onPick,
  onScan,
  onQuickAdd,
  onNewProduct,
}: {
  open: boolean;
  mealName: string;
  onClose: () => void;
  onPick: (p: Product) => void;
  onScan: () => void;
  onQuickAdd: () => void;
  onNewProduct: (name: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [lists, setLists] = useState<ProductLists | null>(null);
  const [tab, setTab] = useState<Tab>('recent');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults(null);
    setError(null);
    api
      .productLists()
      .then((l) => {
        setLists(l);
        // Start where there is something to pick.
        setTab(l.recent.length ? 'recent' : l.favorites.length ? 'favorites' : l.mine.length ? 'mine' : 'recent');
      })
      .catch((e: Error) => setError(e.message));
  }, [open]);

  // Search as you type, a moment after the last key; answers to older queries are ignored.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const n = ++seq.current;
    const timer = window.setTimeout(() => {
      api
        .search(q)
        .then((r) => n === seq.current && setResults(r.products))
        .catch((e: Error) => n === seq.current && setError(e.message));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const shown = results ?? lists?.[tab] ?? [];
  const empty = results
    ? t('Nothing found. Add it as your own product?', 'Niets gevonden. Als eigen product toevoegen?')
    : {
        recent: t('What you log shows up here.', 'Wat je logt, verschijnt hier.'),
        frequent: t('What you log more than once shows up here.', 'Wat je vaker logt, verschijnt hier.'),
        favorites: t('Tap the star on a product to make it a favourite.', 'Tik op de ster bij een product om het favoriet te maken.'),
        mine: t('Products you add yourself show up here.', 'Producten die je zelf toevoegt, verschijnen hier.'),
      }[tab];

  return (
    <Sheet open={open} onClose={onClose} label={t(`Add to ${mealName}`, `Toevoegen aan ${mealName}`)}>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{t(`Add to ${mealName.toLowerCase()}`, `Toevoegen aan ${mealName.toLowerCase()}`)}</h2>
        <input
          className="input"
          type="search"
          enterKeyHint="search"
          placeholder={t('Search foods', 'Zoek een product')}
          aria-label={t('Search foods', 'Zoek een product')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid-3">
          <button className="btn" onClick={onScan}>
            {t('Scan', 'Scannen')}
          </button>
          <button className="btn" onClick={onQuickAdd}>
            {t('Quick add', 'Snel toevoegen')}
          </button>
          <button className="btn" onClick={() => onNewProduct(query.trim())}>
            <IconPlus size={18} /> {t('New', 'Nieuw')}
          </button>
        </div>

        {!results && (
          <div className="chips" role="tablist">
            {TABS().map((x) => (
              <button key={x.id} role="tab" aria-pressed={tab === x.id} aria-selected={tab === x.id} onClick={() => setTab(x.id)}>
                {x.label}
              </button>
            ))}
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {shown.length > 0 ? (
          <div className="list">
            {shown.map((p) => (
              <ProductRow key={p.id} product={p} onPick={onPick} />
            ))}
          </div>
        ) : (
          (results || lists) && <p className="muted">{empty}</p>
        )}
        {tab === 'mine' && !results && lists && lists.hidden.length > 0 && (
          <>
            <h3 className="small muted" style={{ margin: '8px 0 0' }}>
              {t('Hidden', 'Verborgen')}
            </h3>
            <div className="list">
              {lists.hidden.map((p) => (
                <ProductRow key={p.id} product={p} onPick={onPick} />
              ))}
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
