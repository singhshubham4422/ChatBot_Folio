import { ArrowLeft, Copy, FileText, LoaderCircle, Mic, MicOff, Search, Send, ShieldCheck, Square, ThumbsDown, ThumbsUp, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { askConversational, loadEngine, localModelPlan, prepareLocalModel, sanitizeMarkdown, stopLocalGeneration, unloadLocalModel, type AnswerBlock, type EngineResult } from './engine/client';
import { CONFIG } from './engine/config';
import { useVoiceInput } from './useVoiceInput';

function debugEnabled() { return new URLSearchParams(window.location.search).get('debug') === '1'; }
function SourceLink({ block }: { block: AnswerBlock }) { return <a href={`${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(block.sourceFile)}#page=${block.pageStart}`} target="_blank" rel="noreferrer"><FileText size={12}/> {block.sourceFile} - p. {block.pageStart}{block.pageEnd !== block.pageStart ? `-${block.pageEnd}` : ''}</a>; }
function StructuredBlock({ block, detailed }: { block: AnswerBlock; detailed: boolean }) {
  return <section className="answer-block"><div className="answer-block-head"><b>{block.sectionTitle}</b><SourceLink block={block}/></div>{block.qualifiers.length > 0 && <div className="answer-scope"><b>Applies to:</b> {block.qualifiers.join(', ')}<span>Check the BITS website for current figures where the document year is old.</span></div>}{detailed && block.tables.map(table => <div className="answer-table-wrap" key={`${table.heading}-${table.page}`}><table><caption>{table.heading}</caption><thead><tr>{table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={`${table.page}-${index}`}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table><small className="table-source"><SourceLink block={{ ...block, pageStart: table.page, pageEnd: table.page }}/></small></div>)}{block.bullets.length > 0 && <ul className="answer-bullets">{block.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}{detailed && <details className="original-passage"><summary>View original passage</summary><p>{block.originalText}</p></details>}</section>;
}

export function QuickBot({ displayName, onBack }: { displayName: string; onBack: () => void }) {
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<EngineResult>();
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(true);
  const [status, setStatus] = useState('Loading prepared documents...');
  const [error, setError] = useState('');
  const [localReady, setLocalReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [modelProgress, setModelProgress] = useState({ text: '', value: 0 });
  const [modelPlan, setModelPlan] = useState<{ id: string; label: string; download: string; size: string }>();
  const [debug] = useState(debugEnabled);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>(() => { try { return JSON.parse(localStorage.getItem('folio-smartbot-history') || '[]').slice(-6); } catch { return []; } });
  const [controller, setController] = useState<AbortController>();
  const voice = useVoiceInput(text => { setQuestion(text); void ask(text); });

  useEffect(() => { void loadEngine().then(() => setStatus('3 documents - local search ready')).catch(cause => setError(cause instanceof Error ? cause.message : 'The search engine could not be loaded.')); return () => { void unloadLocalModel(); }; }, []);
  useEffect(() => { void localModelPlan().then(setModelPlan).catch(() => undefined); }, []);

  async function prepareModel(retry = false) {
    if (preparing || localReady) return;
    setPreparing(true); setError(''); setStatus('Preparing local model...');
    try {
      const id = await prepareLocalModel((text, value) => setModelProgress({ text, value }), retry);
      setLocalReady(true); setStatus(`Local model ready: ${id}`);
    } catch (cause) {
      setLocalReady(false); setStatus('Document-only fallback available'); setError(cause instanceof Error ? cause.message : 'The local model could not be prepared.');
    } finally { setPreparing(false); }
  }

  async function ask(text = question) {
    const value = text.trim().slice(0, 300);
    if (!value || busy) return;
    voice.stop(); setBusy(true); setError(''); setResult(undefined); setQuestion(value);
    const nextController = new AbortController(); setController(nextController);
    try {
      const next = await askConversational(value, history, nextController.signal);
      setResult(next); setShowDetails(next.mode === 'DETAILED' && !next.fallback);
      const nextHistory = [...history, { role: 'user' as const, text: value }, { role: 'assistant' as const, text: next.answer }].slice(-6);
      setHistory(nextHistory); localStorage.setItem('folio-smartbot-history', JSON.stringify(nextHistory));
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') setError(cause instanceof Error ? cause.message : 'The documents could not be searched.');
    } finally { setBusy(false); setController(undefined); }
  }

  function speak() { if (result?.answer && 'speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(result.answer)); }
  const chips = result?.coverage.disambiguationChips.length ? result.coverage.disambiguationChips : result?.coverage.suggestedQuestions ?? [];
  const details = showDetails;

  return <section className="quick-bot-view">
    <div className="quick-bot-heading"><button className="text-button" onClick={onBack}><ArrowLeft size={14}/> Back to library</button><div className="eyebrow muted">CONVERSATIONAL KNOWLEDGE BASE</div><h1>Hello, {displayName || 'there'}.</h1><p>Smart Quick Bot answers from the three official BITS admission documents using local browser inference.</p></div>
    <div className="quick-bot-card">
      <div className="quick-bot-status"><FileText size={16}/><span>{status}</span></div>
      <div className="quick-bot-local-control"><button className="details-toggle" onClick={() => void prepareModel(Boolean(error))} disabled={preparing || localReady}>{preparing ? 'Preparing local model…' : localReady ? 'Local model is ready' : 'Prepare local model'}</button><small>{modelPlan ? `${modelPlan.label} · ${modelPlan.download} first download · ${modelPlan.size} runtime estimate. Cached by this browser.` : 'Selecting a lightweight local model…'}</small>{preparing && <div className="progress-track model-progress" role="progressbar" aria-valuenow={Math.round(modelProgress.value * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.round(modelProgress.value * 100)}%` }}/><small>{modelProgress.text || 'Initializing…'}</small></div>}</div>
      <div className="quick-bot-input-row"><textarea value={voice.transcript || question} maxLength={300} onChange={event => { voice.notifyEdit(); setQuestion(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void ask(); } }} placeholder="Ask about BITS admissions..." disabled={busy} rows={3}/><div className="voice-controls">{voice.supported && <><select value={voice.language} onChange={event => voice.setLanguage(event.target.value)} aria-label="Voice language"><option value="en-IN">English India</option><option value="hi-IN">Hindi</option></select><button type="button" className={`voice-button ${voice.state === 'listening' ? 'listening' : ''}`} onClick={() => voice.state === 'listening' ? voice.stop() : voice.start()} aria-label={voice.state === 'listening' ? 'Stop voice input' : 'Start voice input'}>{voice.state === 'listening' ? <Square size={15}/> : voice.state === 'error' ? <MicOff size={16}/> : <Mic size={16}/>}</button></>}</div></div>
      <button className="primary-button" onClick={() => void ask()} disabled={busy || !question.trim()}>{busy ? <LoaderCircle size={16}/> : <Send size={16}/>} {busy ? 'Smart Bot is thinking...' : 'Ask quick bot'}</button>{busy && <button className="details-toggle" onClick={() => { controller?.abort(); void stopLocalGeneration(); }}><Square size={13}/> Stop</button>}
      {voice.supported && <div className="voice-status" aria-live="polite">{voice.state === 'listening' && 'Listening...'}{voice.state === 'processing' && 'Processing voice input...'}{voice.error && voice.error}<label><input type="checkbox" checked={voice.autoSend} onChange={event => voice.setAutoSend(event.target.checked)}/> Auto-send voice questions</label></div>}
      <p className="quick-bot-note"><ShieldCheck size={14}/> Answers use only the three official BITS documents. Browser voice recognition may send audio to the browser vendor service; typed questions and local generation stay on this device after required assets are cached.</p>
      {!result && history.length === 0 && <div className="demo-questions"><div><b>Try a question</b><small>Start with one of these document-based examples</small></div><div className="demo-question-grid">{CONFIG.EXAMPLE_QUESTIONS.slice(0, 3).map(example => <button key={example} onClick={() => void ask(example)} disabled={busy}>{example}<Send size={12}/></button>)}</div></div>}{error && <p className="error-note">{error}</p>}
    </div>
    {result && <article className="quick-bot-answer"><div className="eyebrow muted">{result.mode === 'DETAILED' ? 'DETAILED ANSWER' : 'ANSWER'}</div><div className="engine-answer">{sanitizeMarkdown(result.answer).map((part, index) => part.type === 'bullet' ? <li key={index}>{part.text}</li> : part.type === 'break' ? <br key={index}/> : <p key={index}>{part.text}</p>)}</div><div className="message-actions"><button title="Copy" onClick={() => void navigator.clipboard?.writeText(result.answer)}><Copy size={14}/></button><button title="Helpful"><ThumbsUp size={14}/></button><button title="Not helpful"><ThumbsDown size={14}/></button><button title="Read aloud" onClick={speak}><Volume2 size={14}/></button></div>{result.blocks.map(block => <StructuredBlock key={`${block.sourceFile}-${block.sectionTitle}`} block={block} detailed={details}/>) }{result.generatedCitations?.length ? <div className="quick-bot-sources"><b><Search size={13}/> Sources</b>{result.generatedCitations.map(source => <a key={`${source.fileName}-${source.page}`} href={`${import.meta.env.BASE_URL}pdfs/${encodeURIComponent(source.fileName)}#page=${source.page}`} target="_blank" rel="noreferrer"><FileText size={12}/> {source.fileName} - p. {source.page}</a>)}</div> : result.blocks.length > 0 && <div className="quick-bot-sources"><b><Search size={13}/> Sources</b>{result.blocks.map(block => <SourceLink key={`${block.sourceFile}-${block.pageStart}`} block={block}/>)}</div>}{result.fallback && <p className="quick-bot-note">Local generation was unavailable or failed validation; the response above uses only verified document evidence.</p>}<button className="details-toggle" onClick={() => setShowDetails(value => !value)}>{details ? 'Show shorter answer' : 'Show more details'}</button>{chips.length > 0 && <div className="quick-bot-suggestions">{chips.slice(0, 3).map(chip => <button key={chip} onClick={() => void ask(chip)}>{chip}</button>)}{result.nextQuestion && <button onClick={() => void ask(result.nextQuestion!)}>{result.nextQuestion}</button>}<button onClick={() => void ask('explain that simply in 3 bullets')}>Simplify</button></div>}{debug && <small className="engine-debug">intent={result.intent} - query={result.rewrittenQuery ?? ''} - coverage={result.coverage.type} - provider={result.provider ?? 'none'} - passages={result.passages.length}</small>}</article>}
  </section>;
}
