import { ArrowLeft, FileText, LoaderCircle, Search, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { askEngine, loadEngine, type EngineResult } from './engine/client';

function debugEnabled() { return new URLSearchParams(window.location.search).get('debug') === '1'; }

export function QuickBot({ onBack }: { onBack: () => void }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<EngineResult>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Loading prepared documents…');
  const [error, setError] = useState('');
  const [debug] = useState(debugEnabled);

  useEffect(() => {
    void loadEngine().then(() => setStatus('3 documents · hybrid search ready')).catch(cause => setError(cause instanceof Error ? cause.message : 'The search engine could not be loaded.'));
  }, []);

  async function ask(text = question) {
    const value = text.trim().slice(0, 300);
    if (!value || busy) return;
    setBusy(true); setError(''); setResult(undefined); setQuestion(value);
    try { setResult(await askEngine(value)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The documents could not be searched.'); }
    finally { setBusy(false); }
  }

  const chips = result?.coverage.disambiguationChips.length ? result.coverage.disambiguationChips : result?.coverage.suggestedQuestions ?? [];
  return <section className="quick-bot-view">
    <div className="quick-bot-heading"><button className="text-button" onClick={onBack}><ArrowLeft size={14}/> Back to library</button><div className="eyebrow muted">TRAINED LOCAL KNOWLEDGE BASE</div><h1>Smart Quick Bot</h1><p>Ask questions across the official BITS admission documents.</p></div>
    <div className="quick-bot-card">
      <div className="quick-bot-status"><FileText size={16}/><span>{status}</span></div>
      <textarea value={question} maxLength={300} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask about BITS admissions…" disabled={busy} rows={3}/>
      <button className="primary-button" onClick={() => void ask()} disabled={busy || !question.trim()}>{busy ? <LoaderCircle size={16}/> : <Send size={16}/>} {busy ? 'Searching…' : 'Ask quick bot'}</button>
      <p className="quick-bot-note"><ShieldCheck size={14}/> Answers use only the three official BITS documents packaged with this deployment.</p>
      {error && <p className="error-note">{error}</p>}
    </div>
    {result && <article className="quick-bot-answer"><div className="eyebrow muted">ANSWER</div><p className="engine-answer">{result.answer}</p><div className="quick-bot-sources"><b><Search size={13}/> Retrieved sources</b>{result.sources.map(source => <a key={`${source.fileName}-${source.page}`} href={`${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(source.fileName)}#page=${source.page}`} target="_blank" rel="noreferrer"><FileText size={12}/> {source.fileName} · p. {source.page}</a>)}</div>{chips.length > 0 && <div className="quick-bot-suggestions">{chips.map(chip => <button key={chip} onClick={() => void ask(chip)}>{chip}</button>)}</div>}{debug && <small className="engine-debug">coverage={result.coverage.type} · score={result.score.toFixed(3)} · passages={result.passages.length}</small>}</article>}
  </section>;
}
