import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  askBriefing,
  askBuddy,
  chatLabel,
  createChat,
  listChats,
  loadMessages,
  type BuddyChatMessage,
  type BuddyChatSummary,
} from './buddyChatStore';
import { parseKeyStatus } from './buddyThinkResult';
import { localDateString } from './buddyDate';
import BuddyBriefingCard from './BuddyBriefingCard';
import BuddyGreeting from './BuddyGreeting';
import BuddyChanges from './BuddyChanges';
import BuddyReports from './BuddyReports';
import BuddySettingsPanel from './BuddySettings';
import { DEFAULT_SETTINGS, loadSettings, type BuddySettings } from './buddySettingsStore';
import { speak, stopSpeaking } from './buddySpeech';
import './buddy.css';

export const BUDDY_MAX_MESSAGE_CHARS = 1000;
const COUNT_FROM_CHARS = 800;
const NO_KEY_LINE = 'Buddy cannot think yet because no Google key is saved. Add it in Admin under Automation keys, in the box called Google key.';
const CHAT_NOT_REACHED = 'Buddy could not be reached just now. Check the messages below and try again shortly.';
const BRIEFING_NOT_REACHED = 'Buddy could not get your briefing just now. You can still type below.';

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

type KeyState = 'checking' | 'missing' | 'saved' | 'unknown';
/** Greeting first, then the chat. Reports and settings are their own doors and have no composer. */
type Phase = 'greeting' | 'chat' | 'reports' | 'changes' | 'settings';

/**
 * Buddy's private chat. One conversation at a time, past chats in a drawer, and the
 * owner's own messages and Buddy's replies stored only for this owner.
 */
export default function BuddyChat() {
  const [phase, setPhase] = useState<Phase>('greeting');
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [settings, setSettings] = useState<BuddySettings>(DEFAULT_SETTINGS);
  const [keyState, setKeyState] = useState<KeyState>('checking');
  const [chats, setChats] = useState<BuddyChatSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BuddyChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('buddy-think', { body: { action: 'status' } });
        if (cancelled) return;
        const configured = error ? null : parseKeyStatus(data);
        setKeyState(configured === null ? 'unknown' : configured ? 'saved' : 'missing');
      } catch {
        if (!cancelled) setKeyState('unknown');
      }
      const list = await listChats();
      if (!cancelled && list) setChats(list);
    })();
    (async () => {
      const saved = await loadSettings();
      if (!cancelled && saved) setSettings(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop any read-aloud when the owner leaves Buddy.
  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, pendingText, sending]);

  const refreshChats = async () => {
    const list = await listChats();
    if (list) setChats(list);
  };

  /** Continue after the greeting: open today's briefing thread, then show the chat with it. */
  const continueFromGreeting = async () => {
    setPhase('chat');
    setBriefingBusy(true);
    setNotice('');
    const result = await askBriefing(localDateString());
    if (result?.ok) {
      setActiveId(result.chatId);
      const rows = await loadMessages(result.chatId);
      if (rows) setMessages(rows);
      else setNotice('Today\u2019s briefing could not be opened just now. Try again shortly.');
      await refreshChats();
      if (settings.speakReplies) speak(result.text);
    } else {
      setNotice(result && !result.ok ? result.message : BRIEFING_NOT_REACHED);
    }
    setBriefingBusy(false);
  };

  const startNewChat = () => {
    setActiveId(null);
    setMessages([]);
    setDraft('');
    setNotice('');
    setDrawerOpen(false);
  };

  const openChat = async (chat: BuddyChatSummary) => {
    setDrawerOpen(false);
    setNotice('');
    setActiveId(chat.id);
    setMessages([]);
    const rows = await loadMessages(chat.id);
    if (rows) setMessages(rows);
    else setNotice('That chat could not be opened just now. Try again shortly.');
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setNotice('');
    setDraft('');
    setPendingText(text);

    let chatId = activeId;
    if (!chatId) {
      const created = await createChat();
      if (!created) {
        setPendingText(null);
        setSending(false);
        setDraft(text);
        setNotice('Buddy could not start a new chat. Your message is still in the box.');
        return;
      }
      chatId = created.id;
      setActiveId(created.id);
      setChats((previous) => [created, ...previous.filter((chat) => chat.id !== created.id)]);
    }

    const result = await askBuddy(chatId, text);
    const rows = await loadMessages(chatId);
    if (rows) setMessages(rows);
    if (!result) setNotice(CHAT_NOT_REACHED);
    else if (!result.ok && result.reason !== 'no_key') setNotice(result.message);
    if (result?.ok && settings.speakReplies) speak(result.reply);
    setPendingText(null);
    setSending(false);
    await refreshChats();
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  if (phase === 'reports') {
    return <BuddyReports vibe={settings.vibe} onBack={() => setPhase('chat')} />;
  }
  if (phase === 'changes') {
    return <BuddyChanges vibe={settings.vibe} onBack={() => setPhase('chat')} />;
  }

  if (phase === 'settings') {
    return (
      <BuddySettingsPanel
        saved={settings}
        onBack={() => setPhase('chat')}
        onSaved={(next) => setSettings(next)}
      />
    );
  }

  if (phase === 'greeting') {
    return (
      <div className="buddy-app buddy-app--single" data-vibe={settings.vibe} data-testid="buddy-chat">
        <BuddyGreeting onContinue={() => void continueFromGreeting()} />
      </div>
    );
  }

  const empty = messages.length === 0 && !pendingText && !briefingBusy;

  return (
    <div className="buddy-app" data-vibe={settings.vibe} data-testid="buddy-chat">
      <header className="buddy-top">
        <h1 className="buddy-name">Buddy</h1>
        <div className="buddy-top-actions">
          <button type="button" className="buddy-button buddy-button--solid" onClick={startNewChat}>
            New chat
          </button>
          <button
            type="button"
            className="buddy-button"
            aria-expanded={drawerOpen}
            aria-controls="buddy-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            Chats
          </button>
          <button type="button" className="buddy-button" onClick={() => setPhase('reports')}>
            Reports
          </button>
          <button type="button" className="buddy-button" onClick={() => setPhase('changes')}>
            Changes
          </button>
          <button type="button" className="buddy-button" onClick={() => setPhase('settings')}>
            Settings
          </button>
        </div>
      </header>

      <main className="buddy-log" aria-label="Conversation" aria-live="polite">
        <div className="buddy-log-inner">
          {keyState === 'missing' && <p className="buddy-banner" role="status">{NO_KEY_LINE}</p>}
          {empty && (
            <div className="buddy-empty">
              <strong>Ask Buddy anything.</strong>
              Buddy can read your published article titles and shop products, and what you tell it. It cannot change any of them.
            </div>
          )}
          {messages.map((message) =>
            message.kind === 'briefing' && message.role === 'buddy' ? (
              <BuddyBriefingCard key={message.id} content={message.content} sections={message.sections} />
            ) : (
              <div
                key={message.id}
                className={`buddy-msg buddy-msg--${message.role === 'owner' ? 'owner' : message.kind === 'notice' ? 'notice' : 'buddy'}`}
              >
                {message.content}
              </div>
            ),
          )}
          {pendingText && <div className="buddy-msg buddy-msg--owner buddy-msg--pending">{pendingText}</div>}
          {(sending || briefingBusy) && (
            <div className="buddy-thinking" role="status" aria-label={briefingBusy ? 'Buddy is getting your briefing' : 'Buddy is thinking'}>
              <span className="buddy-dot" />
              <span className="buddy-dot" />
              <span className="buddy-dot" />
            </div>
          )}
          {notice && <p className="buddy-banner buddy-error" role="alert">{notice}</p>}
          <div ref={logEnd} />
        </div>
      </main>

      <form className="buddy-composer" onSubmit={onSubmit}>
        <div className="buddy-composer-inner">
          <div className="buddy-input-wrap">
            <textarea
              className="buddy-input"
              aria-label="Message Buddy"
              placeholder="Type to Buddy"
              rows={1}
              value={draft}
              maxLength={BUDDY_MAX_MESSAGE_CHARS}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              disabled={sending || briefingBusy}
            />
          </div>
          <button type="submit" className="buddy-button buddy-button--solid buddy-send" disabled={sending || briefingBusy || !draft.trim()}>
            Send
          </button>
        </div>
        {draft.length >= COUNT_FROM_CHARS && (
          <div className="buddy-composer-inner">
            <span className="buddy-count" style={{ marginLeft: 'auto' }}>{draft.length}/{BUDDY_MAX_MESSAGE_CHARS}</span>
          </div>
        )}
      </form>

      {drawerOpen && (
        <div className="buddy-drawer" id="buddy-drawer" role="dialog" aria-modal="true" aria-label="Past chats">
          <button type="button" className="buddy-drawer-scrim" aria-label="Close past chats" onClick={() => setDrawerOpen(false)} />
          <div className="buddy-drawer-panel">
            <div className="buddy-drawer-head">
              <h2>Past chats</h2>
              <button type="button" className="buddy-button" onClick={() => setDrawerOpen(false)}>Close</button>
            </div>
            {chats.length === 0 ? (
              <p className="buddy-empty" style={{ margin: '24px 16px' }}>No past chats yet.</p>
            ) : (
              <ul className="buddy-chat-list">
                {chats.map((chat) => (
                  <li key={chat.id}>
                    <button
                      type="button"
                      className="buddy-chat-item"
                      aria-current={chat.id === activeId ? 'true' : undefined}
                      onClick={() => void openChat(chat)}
                    >
                      <span className="buddy-chat-title">{chatLabel(chat)}</span>
                      <span className="buddy-chat-time">{formatTime(chat.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
