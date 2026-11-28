import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { versionLabel } from '../format.ts';
import { t } from '../i18n.ts';
import { IconCoach, IconDiary, IconProfile, IconProgress, IconToday } from './Icons.tsx';

/** Bottom tab bar on phones; a sidebar with the logo and version on wide screens (see styles.css). */
export function BottomNav({ version }: { version: string }) {
  const items = [
    { to: '/', label: t('Today', 'Vandaag'), icon: <IconToday /> },
    { to: '/diary', label: t('Diary', 'Dagboek'), icon: <IconDiary /> },
    { to: '/progress', label: t('Progress', 'Voortgang'), icon: <IconProgress /> },
    { to: '/coach', label: t('Coach', 'Coach'), icon: <IconCoach /> },
    { to: '/profile', label: t('Profile', 'Profiel'), icon: <IconProfile /> },
  ];
  return (
    <nav className="nav" aria-label={t('Main menu', 'Hoofdmenu')}>
      <div className="nav-brand" aria-hidden="true">
        OPEN NUTRILOG <span className="version">{versionLabel(version)}</span>
      </div>
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          {i.icon}
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Space the on-screen keyboard takes where the browser doesn't shrink the page for it (Safari on iOS). */
function keyboardInset(): number {
  const vv = window.visualViewport;
  return vv ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0;
}

/**
 * A panel that slides up from the bottom. With the on-screen keyboard open it stays above the keyboard (the viewport
 * resizes, see index.html; Safari gets the room through --kb), keeps the focused field in view, and the page behind
 * it doesn't scroll. `tall` gives it a fixed height, so it doesn't jump while its content changes (search results).
 */
export function Sheet({ open, onClose, children, label, tall = false }: { open: boolean; onClose: () => void; children: ReactNode; label: string; tall?: boolean }) {
  const [kb, setKb] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (!open) return;
    const body = document.body.style;
    const before = body.overflow;
    body.overflow = 'hidden';
    const vv = window.visualViewport;
    const update = () => setKb(keyboardInset());
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    // Once the keyboard is up, bring the field you are typing in into view inside the sheet.
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input, textarea')) window.setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 250);
    };
    document.addEventListener('focusin', onFocus);
    return () => {
      body.overflow = before;
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', onFocus);
      setKb(0);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="scrim" style={kb ? ({ '--kb': `${kb}px` } as CSSProperties) : undefined} onClick={onClose}>
      <div className={`sheet${tall ? ' tall' : ''}`} role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        {children}
      </div>
    </div>
  );
}

export function Loading() {
  return (
    <div className="center-screen">
      <div className="spinner" role="status" aria-label={t('Loading', 'Laden')} />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="center-screen">
      <div className="stack" style={{ justifyItems: 'center' }}>
        <p className="error">{message}</p>
        {onRetry && (
          <button className="btn" onClick={onRetry}>
            {t('Try again', 'Opnieuw proberen')}
          </button>
        )}
      </div>
    </div>
  );
}

let toastListener: ((msg: string) => void) | null = null;
export function toast(msg: string) {
  toastListener?.(msg);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    toastListener = (m) => {
      setMsg(m);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMsg(null), 2800);
    };
    return () => {
      toastListener = null;
      window.clearTimeout(timer);
    };
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

/** Minimal data hook: load on mount, expose reload. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    setError(null);
    return loader()
      .then((d) => setData(d))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
