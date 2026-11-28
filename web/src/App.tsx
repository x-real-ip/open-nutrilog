import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { AppInfo, Language } from '@shared/types.ts';
import { api } from './api.ts';
import { getLang, setLang } from './i18n.ts';
import { BottomNav, ErrorState, Loading, ToastHost } from './components/ui.tsx';
import AiPage from './pages/AiPage.tsx';
import CoachPage from './pages/CoachPage.tsx';
import DiaryPage from './pages/DiaryPage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import ProfilePage from './pages/ProfilePage.tsx';
import ProgressPage from './pages/ProgressPage.tsx';
import RecipePage from './pages/RecipePage.tsx';
import RecipesPage from './pages/RecipesPage.tsx';
import SourcesPage from './pages/SourcesPage.tsx';
import TargetsPage from './pages/TargetsPage.tsx';
import TodayPage from './pages/TodayPage.tsx';

const InfoContext = createContext<AppInfo | null>(null);
export const useInfo = () => useContext(InfoContext)!;
const RefreshInfoContext = createContext<() => void>(() => {});
/** Reload /api/info, e.g. after the profile changed. */
export const useRefreshInfo = () => useContext(RefreshInfoContext);
const SetLanguageContext = createContext<(lang: Language) => void>(() => {});
/** Switch the UI language right away; every screen remounts in the new language. */
export const useSetLanguage = () => useContext(SetLanguageContext);

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  // Bumped when the language changes, so every screen remounts and reloads its text.
  const [lang, setLangState] = useState(getLang());
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .info()
      .then((i) => {
        if (i.language !== getLang()) {
          setLang(i.language);
          setLangState(i.language);
        }
        setInfo(i);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(() => {
    load();
    const onUnauthorized = () => setInfo((i) => (i ? { ...i, authenticated: false } : i));
    window.addEventListener('open-nutrilog:unauthorized', onUnauthorized);
    return () => window.removeEventListener('open-nutrilog:unauthorized', onUnauthorized);
  }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!info) return <Loading />;
  if (info.authRequired && !info.authenticated) return <LoginPage info={info} onSuccess={load} />;

  return (
    <InfoContext.Provider value={info}>
      <RefreshInfoContext.Provider value={load}>
        <SetLanguageContext.Provider
          value={(l) => {
            setLang(l);
            setLangState(l);
          }}
        >
          <div className="shell with-nav">
            <Routes key={lang}>
              <Route path="/" element={<TodayPage />} />
              <Route path="/diary" element={<DiaryPage />} />
              <Route path="/diary/:day" element={<DiaryPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/targets" element={<TargetsPage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/recipes/:id" element={<RecipePage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/coach" element={<CoachPage />} />
              <Route path="/ai" element={<AiPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <BottomNav version={info.version} />
          <ToastHost />
        </SetLanguageContext.Provider>
      </RefreshInfoContext.Provider>
    </InfoContext.Provider>
  );
}
