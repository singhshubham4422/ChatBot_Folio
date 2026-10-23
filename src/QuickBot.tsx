import { ArrowLeft, FileText, LoaderCircle, Mic, MicOff, Search, Send, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { askEngine, loadEngine, type AnswerBlock, type EngineResult } from './engine/client';
import { CONFIG } from './engine/config';
import { useVoiceInput } from './useVoiceInput';

function debugEnabled() { return new URLSearchParams(window.location.search).get('debug') === '1'; }

function SourceLink({ block }: { block: AnswerBlock }) {
  return <a href={`${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(block.sourceFile)}#page=${block.pageStart}`} target="_blank" rel="noreferrer"><FileText size={12}/> {block.sourceFile} · p. {block.pageStart}{block.pageEnd !== block.pageStart ? `–${block.pageEnd}` : ''}</a>;
}

function StructuredBlock({ block, detailed }: { block: AnswerBlock; detailed: boolean }) {
  return <section className="answer-block">
    <div className="answer-block-head"><b>{block.sectionTitle}</b><SourceLink block={block}/></div>
    {block.qualifiers.length > 0 && <div className="answer-scope"><b>Applies to:</b> {block.qualifiers.join(', ')}<span>Check the BITS website for current figures where the document year is old.</span></div>}
    {detailed && block.tables.map(table => <div className="answer-table-wrap" key={`${table.heading}-${table.page}`}><table><caption>{table.heading}</caption><thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={`${table.page}-${index}`}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table><small className="table-source"><SourceLink block={{ ...block, pageStart: table.page, pageEnd: table.page }}/></small></div>)}
    {block.bullets.length > 0 && <ul className="answer-bullets">{block.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}
    {detailed && <details className="original-passage"><summary>View original passage</summary><p>{block.originalText}</p></details>}
  </section>;
}

export function QuickBot({ displayName, onBack }: { displayName: string; onBack: () => void }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<EngineResult>();
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [status, setStatus] = useState('Loading prepared documents…');
  const [error, setError] = useState('');
  const [debug] = useState(debugEnabled);
  const voice = useVoiceInput(text => { setQuestion(text); void ask(text); });

  useEffect(() => {
    void loadEngine().then(() => setStatus('3 documents · hybrid search ready')).catch(cause => setError(cause instanceof Error ? cause.message : 'The search engine could not be loaded.'));
  }, []);

  async function ask(text = question) {
    const value = text.trim().slice(0, 300);
    if (!value || busy) return;
    voice.stop(); setBusy(true); setError(''); setResult(undefined); setQuestion(value);
    try { const next = await askEngine(value); setResult(next); setShowDetails(next.mode === 'DETAILED'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The documents could not be searched.'); }
    finally { setBusy(false); }
  }

  const chips = result?.coverage.disambiguationChips.length ? result.coverage.disambiguationChips : result?.coverage.suggestedQuestions ?? [];
  const details = showDetails || result?.mode === 'DETAILED';
  return <section className="quick-bot-view">
    <div className="quick-bot-heading"><button className="text-button" onClick={onBack}><ArrowLeft size={14}/> Back to library</button><div className="eyebrow muted">TRAINED LOCAL KNOWLEDGE BASE</div><h1>Hello, {displayName || 'there'}.</h1><p>Smart Quick Bot is ready to explore the official BITS admission documents with you.</p></div>
    <div className="quick-bot-card">
      <div className="quick-bot-status"><FileText size={16}/><span>{status}</span></div>
      <div className="quick-bot-input-row"><textarea value={voice.transcript || question} maxLength={300} onChange={event => { voice.notifyEdit(); setQuestion(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask about BITS admissions…" disabled={busy} rows={3}/><div className="voice-controls">{voice.supported && <><select value={voice.language} onChange={event => voice.setLanguage(event.target.value)} aria-label="Voice language"><option value="en-IN">English India</option><option value="hi-IN">Hindi</option></select><button type="button" className={`voice-button ${voice.state === 'listening' ? 'listening' : ''}`} onClick={() => voice.state === 'listening' ? voice.stop() : voice.start()} aria-label={voice.state === 'listening' ? 'Stop voice input' : 'Start voice input'} aria-pressed={voice.state === 'listening'}>{voice.state === 'listening' ? <Square size={15}/> : voice.state === 'error' ? <MicOff size={16}/> : <Mic size={16}/>}</button></>}</div></div>
      <button className="primary-button" onClick={() => void ask()} disabled={busy || !question.trim()}>{busy ? <LoaderCircle size={16}/> : <Send size={16}/>} {busy ? 'Searching…' : 'Ask quick bot'}</button>
      {voice.supported && <div className="voice-status" aria-live="polite">{voice.state === 'listening' && 'Listening…'}{voice.state === 'processing' && 'Processing voice input…'}{voice.error && voice.error}<label><input type="checkbox" checked={voice.autoSend} onChange={event => voice.setAutoSend(event.target.checked)}/> Auto-send voice questions</label></div>}
      <p className="quick-bot-note"><ShieldCheck size={14}/> Answers use only the three official BITS documents. Browser voice recognition may send audio to the browser vendor’s service; typed questions stay on this device.</p>
      {!result && <div className="demo-questions"><div><b>Try a question</b><small>Start with one of these document-based examples</small></div><div className="demo-question-grid">{CONFIG.EXAMPLE_QUESTIONS.map(example => <button key={example} onClick={() => void ask(example)} disabled={busy}>{example}<Send size={12}/></button>)}</div></div>}
      {error && <p className="error-note">{error}</p>}
    </div>
    {result && <article className="quick-bot-answer"><div className="eyebrow muted">{result.mode === 'DETAILED' ? 'DETAILED ANSWER' : 'ANSWER'}</div><p className="engine-answer">{result.answer}</p>{result.blocks.map(block => <StructuredBlock key={`${block.sourceFile}-${block.sectionTitle}`} block={block} detailed={details}/>) }<div className="quick-bot-sources"><b><Search size={13}/> Sources</b>{result.blocks.map(block => <SourceLink key={`${block.sourceFile}-${block.pageStart}`} block={block}/>)}</div><button className="details-toggle" onClick={() => setShowDetails(value => !value)}>{details ? 'Show shorter answer' : 'Show more details'}</button>{chips.length > 0 && <div className="quick-bot-suggestions">{chips.slice(0, 3).map(chip => <button key={chip} onClick={() => void ask(chip)}>{chip}</button>)}</div>}{debug && <small className="engine-debug">mode={result.mode} · coverage={result.coverage.type} · score={result.score.toFixed(3)} · passages={result.passages.length}</small>}</article>}
  </section>;
}
