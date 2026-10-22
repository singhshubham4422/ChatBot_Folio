import { ArrowLeft, FileText, LoaderCircle, Search, Send, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Chunk } from './types';
import { loadQuickBotIndex, searchQuickBot, deterministicQuickAnswer, extractiveQuickAnswer, type QuickBotIndex } from './lib/quickBot';

function compactAnswer(value: string, maxChars = 1400) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const clipped = normalized.slice(0, maxChars);
  const boundary = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('? '), clipped.lastIndexOf('! '));
  return `${clipped.slice(0, boundary > 500 ? boundary + 1 : maxChars).trim()}…`;
}

export function QuickBot({ localReady, askLocal, onOpenSettings, onBack }: { localReady: boolean; askLocal: (question: string, evidence: Chunk[]) => Promise<string>; onOpenSettings: () => void; onBack: () => void }) {
  const [index, setIndex] = useState<QuickBotIndex>();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [evidence, setEvidence] = useState<Chunk[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { void loadQuickBotIndex().then(setIndex).catch(cause => setError(cause instanceof Error ? cause.message : 'The quick bot index could not be loaded.')); }, []);

  async function ask() {
    const text = question.trim();
    if (!text || !index || busy) return;
    const deterministic = deterministicQuickAnswer(text, index);
    if (deterministic) { setAnswer(deterministic.answer); setEvidence(deterministic.evidence); setError(''); return; }
    const selected = searchQuickBot(index, text, 5);
    if (!selected.length) { setAnswer('I could not find supporting text in the quick-bot documents.'); setEvidence([]); return; }
    setBusy(true); setError(''); setAnswer(''); setEvidence(selected);
    try {
      if (localReady) setAnswer(compactAnswer(await askLocal(text, selected)));
      else {
        const extracted = extractiveQuickAnswer(text, index);
        setAnswer(compactAnswer(extracted.answer));
        setEvidence(extracted.evidence);
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The local quick bot could not answer right now.'); }
    finally { setBusy(false); }
  }

  return <section className="quick-bot-view">
    <div className="quick-bot-heading"><button className="text-button" onClick={onBack}><ArrowLeft size={14}/> Back to library</button><div className="eyebrow muted">FIXED KNOWLEDGE BASE</div><h1>Quick bot</h1><p>Ask questions across the PDFs prepared for this deployment.</p></div>
    <div className="quick-bot-card">
      <div className="quick-bot-status"><FileText size={16}/><span>{index ? `${index.documents.length} documents · ${index.chunks.length} searchable passages` : 'Loading prepared documents…'}</span></div>
      <textarea value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask about the prepared documents…" disabled={!index || busy} rows={3}/>
      <button className="primary-button" onClick={() => void ask()} disabled={!index || busy || !question.trim()}>{busy ? <LoaderCircle size={16}/> : <Send size={16}/>} {busy ? 'Reading…' : 'Ask quick bot'}</button>
      <p className="quick-bot-note"><ShieldCheck size={14}/> Quick Bot searches only the PDFs packaged from <code>Data/</code> and answers in the browser. It does not use uploaded session PDFs. {!localReady && <button className="text-button" onClick={onOpenSettings}>Load local model</button>}</p>
      {error && <p className="error-note">{error}</p>}
    </div>
    {answer && <article className="quick-bot-answer"><div className="eyebrow muted">ANSWER</div><p>{answer}</p><div className="quick-bot-sources"><b><Search size={13}/> Retrieved sources</b>{evidence.map(chunk => <span key={chunk.id}><FileText size={12}/> {chunk.fileName} · p. {chunk.page}</span>)}</div></article>}
  </section>;
}
