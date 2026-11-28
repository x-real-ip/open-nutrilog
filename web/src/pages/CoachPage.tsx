import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CoachMessage, PhaseSuggestion, TargetResponse } from '@shared/types.ts';
import { api } from '../api.ts';
import { useInfo } from '../App.tsx';
import { ErrorState, Loading, toast, useLoad } from '../components/ui.tsx';
import { kcal } from '../format.ts';
import { decimal, t } from '../i18n.ts';

const prompts = () => [
  t('How am I doing?', 'Hoe gaat het?'),
  t('Explain my target', 'Leg mijn doel uit'),
  t('Am I eating enough protein?', 'Eet ik genoeg eiwit?'),
  t('Is my pace right for my training?', 'Past mijn tempo bij mijn training?'),
  t('Ideas for a high-protein lunch', 'Ideeën voor een eiwitrijke lunch'),
];

const phaseLabel = (s: PhaseSuggestion) =>
  s.phase === 'maintain'
    ? t('maintain', 'op gewicht blijven')
    : `${s.phase === 'cut' ? t('lose fat', 'afvallen') : t('build', 'aankomen')}, ${decimal(String(s.ratePctPerWeek))} % ${t('a week', 'per week')}`;

/**
 * A suggestion from the coach: never applied by itself. "Apply" lets the target engine work out the new target,
 * and only "Confirm" saves the new phase in your profile.
 */
function SuggestionCard({ suggestion }: { suggestion: PhaseSuggestion }) {
  const [preview, setPreview] = useState<{ now: TargetResponse; next: TargetResponse } | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const show = async () => {
    setState('busy');
    try {
      const day = (await api.info()).today;
      const [now, next] = await Promise.all([api.target(day), api.previewTarget(suggestion)]);
      setPreview({ now, next });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setState('idle');
    }
  };
  const confirmChange = async () => {
    setState('busy');
    try {
      const { profile } = await api.profile();
      if (!profile) throw new Error(t('Set up your profile first.', 'Stel eerst je profiel in.'));
      const { updatedAt: _u, ...rest } = profile;
      await api.saveProfile({ ...rest, phase: suggestion.phase, ratePctPerWeek: suggestion.phase === 'maintain' ? rest.ratePctPerWeek : suggestion.ratePctPerWeek });
      toast(t('Your phase is changed', 'Je fase is aangepast'));
      setState('done');
    } catch (e) {
      toast((e as Error).message);
      setState('idle');
    }
  };
  if (state === 'done') return <div className="panel small">{t(`Applied: ${phaseLabel(suggestion)}.`, `Toegepast: ${phaseLabel(suggestion)}.`)}</div>;
  return (
    <div className="panel stack suggestion" aria-label={t('Suggestion', 'Voorstel')}>
      <div className="small">
        {t('The coach suggests', 'De coach stelt voor')}: <b>{phaseLabel(suggestion)}</b>
      </div>
      {preview ? (
        <>
          <div className="small muted">
            {preview.next.target && preview.now.target
              ? t(
                  `Your target today would go from ${kcal(preview.now.target.kcal)} to ${kcal(preview.next.target.kcal)} (worked out by the target engine).`,
                  `Je doel van vandaag gaat dan van ${kcal(preview.now.target.kcal)} naar ${kcal(preview.next.target.kcal)} (berekend door de doelberekening).`,
                )
              : t('Complete your profile to see the new target.', 'Vul je profiel aan om het nieuwe doel te zien.')}
          </div>
          <div className="grid-2">
            <button className="btn primary" disabled={state === 'busy'} onClick={() => void confirmChange()}>
              {t('Confirm', 'Bevestigen')}
            </button>
            <button className="btn" onClick={() => setPreview(null)}>
              {t('Cancel', 'Annuleren')}
            </button>
          </div>
        </>
      ) : (
        <button className="btn" disabled={state === 'busy'} onClick={() => void show()}>
          {t('Apply…', 'Toepassen…')}
        </button>
      )}
    </div>
  );
}

/** Tiny markdown subset: **bold**, headings and bullet markers. */
function renderText(text: string): ReactNode {
  return text.split('\n').map((line, i) => {
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const content = heading ? heading[1] : line.replace(/^\s*[-*]\s+/, '• ');
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) => (p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : p));
    return (
      <span key={i}>
        {heading ? <strong>{parts}</strong> : parts}
        {'\n'}
      </span>
    );
  });
}

export default function CoachPage() {
  const info = useInfo();
  const { data, error, loading, reload, setData } = useLoad(() => api.coachMessages());
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const messages: CoachMessage[] = data?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sending]);

  const send = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    const optimistic: CoachMessage = { id: -1, role: 'user', content: trimmed, suggestion: null, createdAt: new Date().toISOString() };
    setData({ messages: [...messages, optimistic] });
    try {
      // The server answers with the whole conversation.
      setData(await api.sendCoach(trimmed));
    } catch (e) {
      setData({ messages });
      setText(trimmed);
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <main className="page" style={{ paddingBottom: 'calc(var(--nav-h) + 150px + var(--safe-b))' }}>
      <div className="page-head">
        <h1>Coach</h1>
        {messages.length > 0 && (
          <button
            className="link-btn small"
            onClick={async () => {
              if (!confirm(t('Clear the conversation?', 'Het gesprek wissen?'))) return;
              await api.clearCoach();
              setData({ messages: [] });
            }}
          >
            {t('Clear', 'Wissen')}
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="panel stack" style={{ marginBottom: 16 }}>
          <p style={{ margin: 0 }}>
            {t(
              'Ask about your intake, your target, protein or your pace. The answers are based on what you logged, your weight and, when linked, your training in Open Strength.',
              'Vraag naar je inname, je doel, eiwit of je tempo. De antwoorden zijn gebaseerd op wat je gelogd hebt, je gewicht en, als die gekoppeld is, je training in Open Strength.',
            )}
          </p>
          <p className="faint small" style={{ margin: 0 }}>
            {t(
              'The coach explains your targets but never sets them; a suggested change goes through the target engine and waits for your confirmation.',
              'De coach legt je doelen uit maar stelt ze nooit vast; een voorgestelde wijziging gaat door de doelberekening en wacht op jouw bevestiging.',
            )}
            {!info.aiConfigured &&
              t(
                ' AI is off, so the coach only shows facts from your data. Turn on AI in Profile → AI settings.',
                ' AI staat uit, dus de coach toont alleen feiten uit je gegevens. Zet AI aan via Profiel → AI-instellingen.',
              )}
          </p>
        </div>
      )}

      <div className="chat">
        {messages.map((m) => (
          <div key={`${m.id}-${m.createdAt}`} className="stack" style={{ gap: 8 }}>
            <div className={`msg ${m.role}`}>{m.role === 'assistant' ? renderText(m.content) : m.content}</div>
            {m.role === 'assistant' && m.suggestion && <SuggestionCard suggestion={m.suggestion} />}
          </div>
        ))}
        {sending && (
          <div className="msg assistant" aria-label={t('The coach is typing', 'De coach typt')}>
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <div className="composer-prompts">
          <div className="prompts">
            {prompts().map((p) => (
              <button key={p} onClick={() => void send(p)} disabled={sending}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={onSubmit}>
          <textarea
            className="textarea"
            rows={1}
            placeholder={t('Ask your coach', 'Vraag het je coach')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
          />
          <button className="btn primary" disabled={sending || !text.trim()}>
            {t('Send', 'Versturen')}
          </button>
        </form>
      </div>
    </main>
  );
}
