import { FileText, LoaderCircle, Mic, MicOff, Plus, Search, Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { askConversational, type AnswerBlock, type EngineResult } from './engine/client';
import { loadFaqKnowledge } from './engine/faq';
import { useVoiceInput, voiceStatusMessage } from './useVoiceInput';

type ChatMessage = { role: 'user' | 'assistant'; text: string; result?: EngineResult };
const STORAGE_KEY = 'bot-admissions-history';
const SUGGESTIONS = [
  'What is BITSAT-2026 used for?',
  'What are the eligibility requirements?',
  'What fees and scholarships are available?',
  'How does Higher-Degree admission work?',
];

function SourceLink({ block }: { block: AnswerBlock }) {
  return <a href={`${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(block.sourceFile)}#page=${block.pageStart}`} target="_blank" rel="noreferrer">
    <FileText size={13} /> {block.sourceFile} · p. {block.pageStart}{block.pageEnd !== block.pageStart ? `–${block.pageEnd}` : ''}
  </a>;
}

function Sources({ result }: { result: EngineResult }) {
  const faqSources = result.faqSources ?? [];
  const retrievalSources = result.sources;
  if (!faqSources.length && !retrievalSources.length) return null;
  return <div className="bot-sources">
    <strong><Search size={13} /> Sources</strong>
    {faqSources.map((source, index) => {
      const fileName = source.file.replace(/ \(1\)(?=\.pdf$)/i, '');
      const page = source.pages.match(/p\.\s*(\d+)/i)?.[1] ?? source.pages.match(/\b(\d+)\b/)?.[1] ?? '1';
      return <a key={`${source.file}-${index}`} href={`${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(fileName)}#page=${page}`} target="_blank" rel="noreferrer">
        <FileText size={13} /> {fileName} · {source.pages} · {source.admission_year}
      </a>;
    })}
    {!faqSources.length && retrievalSources.map(source => <SourceLink key={`${source.fileName}-${source.page}`} block={{ sourceFile: source.fileName, sectionTitle: source.sectionTitle, pageStart: source.page, pageEnd: source.pageEnd, type: 'text', tables: [], bullets: [], qualifiers: [], originalText: '' }} />)}
  </div>;
}

function AnswerExtras({ result, onSuggestion }: { result: EngineResult; onSuggestion: (text: string) => void }) {
  const suggestions = (result.faqSuggestions?.length ? result.faqSuggestions : result.coverage.disambiguationChips.length ? result.coverage.disambiguationChips : result.coverage.suggestedQuestions).slice(0, 3);
  return <>
    <Sources result={result} />
    {result.faqSources?.some(source => source.admission_year !== '2026-27') && <p className="bot-note">This answer is from a different admission cycle. Check the official BITS admissions website for current dates, fees, and rules.</p>}
    {suggestions.length > 0 && <div className="bot-followups">{suggestions.map(suggestion => <button key={suggestion} onClick={() => onSuggestion(suggestion)}>{suggestion}</button>)}</div>}
  </>;
}

export function QuickBot() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').slice(-12); } catch { return []; }
  });
  const [busy, setBusy] = useState(false);
  const [faqError, setFaqError] = useState('');
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController>();
  const requestId = useRef(0);
  const lastQuestion = useRef('');
  const voice = useVoiceInput(
    text => { setQuestion(text); return ask(text, true); },
    { onInterim: text => setQuestion(text) }
  );
  const history = messages.map(message => ({ role: message.role, text: message.text }));

  async function loadFaq() {
    setFaqError('');
    try {
      await loadFaqKnowledge();
    } catch (cause) {
      setFaqError(cause instanceof Error ? cause.message : 'The verified FAQ dataset could not be loaded.');
    }
  }

  useEffect(() => { void loadFaq(); return () => { voice.stop(); controllerRef.current?.abort(); }; }, []);

  async function ask(input = question, fromVoice = false) {
    const value = input.trim().slice(0, 300);
    if (!value || busy) return;
    lastQuestion.current = value;
    if (!fromVoice) voice.stop();
    setQuestion(''); setError(''); setBusy(true);
    const currentRequest = ++requestId.current;
    const nextController = new AbortController();
    controllerRef.current = nextController;
    setMessages(previous => [...previous, { role: 'user' as const, text: value }].slice(-12));
    try {
      const result = await askConversational(value, history, nextController.signal);
      if (currentRequest !== requestId.current) return;
      setMessages(previous => [...previous, { role: 'assistant' as const, text: result.answer, result }].slice(-12));
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError' && currentRequest === requestId.current) setError(cause instanceof Error ? cause.message : 'I could not search the official documents.');
    } finally {
      if (currentRequest === requestId.current) { setBusy(false); controllerRef.current = undefined; }
    }
  }

  function newChat() {
    requestId.current += 1; controllerRef.current?.abort(); voice.stop(); setMessages([]); setQuestion(''); setError(''); setBusy(false); controllerRef.current = undefined; localStorage.removeItem(STORAGE_KEY);
  }

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.map(({ role, text }) => ({ role, text })))); }, [messages]);

  return <div className="bot-app">
    <header className="bot-header"><div><div className="bot-logo">Bot</div><span>BITS admissions assistant</span></div>{messages.length > 0 && <button className="bot-new-chat" onClick={newChat}><Plus size={15} /> New chat</button>}</header>
    <main className="bot-main">
      {messages.length === 0 ? <section className="bot-welcome" aria-labelledby="welcome-title">
        <div className="bot-mark">B</div><h1 id="welcome-title">Hi! I’m Bot. How can I help you with BITS admissions?</h1>
        <p>Ask about BITSAT, eligibility, programmes, fees, scholarships, and admission procedures. Answers come from the verified admission documents.</p>
        <div className="bot-suggestion-grid">{SUGGESTIONS.map(suggestion => <button key={suggestion} onClick={() => void ask(suggestion)}>{suggestion}<Send size={14} /></button>)}</div>
      </section> : <section className="bot-messages" aria-live="polite">{messages.map((message, index) => <div className={`bot-message ${message.role}`} key={`${message.role}-${index}`}><div className="bot-bubble">{message.text}</div>{message.role === 'assistant' && message.result && <AnswerExtras result={message.result} onSuggestion={suggestion => void ask(suggestion)} />}</div>)}{busy && <div className="bot-message assistant"><div className="bot-loading"><LoaderCircle size={15} /> Looking through the official answers…</div></div>}{error && <div className="bot-error">{error}<button onClick={() => void ask(lastQuestion.current)}>Retry</button></div>}</section>}
      {faqError && <div className="bot-faq-error">{faqError}<button onClick={() => void loadFaq()}>Retry</button></div>}
    </main>
    <form className="bot-composer" onSubmit={event => { event.preventDefault(); void ask((question || voice.transcript).trim()); }}>
      <div className="bot-input-row"><textarea value={question} onChange={event => { voice.notifyEdit(); setQuestion(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask((question || voice.transcript).trim()); } }} placeholder={voice.state === 'listening' ? 'Listening to your voice...' : 'Ask about BITS admissions…'} maxLength={300} rows={1} disabled={busy} aria-label="Your question" />
        <div className="bot-actions">{voice.supported && <><select aria-label="Voice language" value={voice.language} onChange={event => voice.setLanguage(event.target.value)}><option value="en-IN">EN</option><option value="hi-IN">HI</option></select><button type="button" className={voice.state === 'listening' ? 'active recording' : ''} onClick={() => voice.state === 'listening' ? voice.stop() : voice.start()} aria-label={voice.state === 'listening' ? 'Stop listening' : 'Start voice input'} title={voice.state === 'listening' ? 'Stop listening' : 'Start voice input'}>{voice.state === 'listening' ? <Square size={18} /> : voice.state === 'error' ? <MicOff size={18} /> : <Mic size={18} />}</button></>}{busy && <button type="button" onClick={() => { requestId.current += 1; controllerRef.current?.abort(); setBusy(false); controllerRef.current = undefined; }} aria-label="Stop request"><Square size={17} /></button>}<button className="bot-send" type="submit" disabled={busy || !(question || voice.transcript).trim()} aria-label="Send question"><Send size={18} /></button></div>
      </div>
      {voice.supported && (voice.state !== 'idle' || voice.error) && <div className={`bot-voice-status ${voice.error ? 'has-error' : ''}`} aria-live="polite"><span className="bot-voice-indicator">{voice.state === 'listening' && <span className="bot-voice-pulse" />}{voiceStatusMessage(voice.state)}</span>{voice.error ? <span className="bot-voice-error-text"> {voice.error}</span> : null}<label title="Automatically send your question after you finish speaking"><input type="checkbox" checked={voice.autoSend} onChange={event => voice.setAutoSend(event.target.checked)} /> auto-send</label></div>}
      <div className="bot-footer-status"><span>Enter to send · Shift+Enter for a new line</span></div>
    </form>
  </div>;
}
