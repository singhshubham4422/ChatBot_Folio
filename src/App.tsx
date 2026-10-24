import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, FileText, Gauge, LoaderCircle, MessageSquareText, Mic, MoreHorizontal, PanelLeftClose, Pause, Play, Plus, Search, Send, Settings2, ShieldCheck, Sparkles, Square, Upload, Volume2, X } from 'lucide-react';
import type { Chunk, Citation, DocumentRef, Message, Session, Preferences } from './types';
import { allSessions, clearApplicationData, deleteDocumentData, getChunks, getDocument, getPages, getPreferences, newSession, removeSession, saveDocProgress, saveDocument, savePageAndChunks, savePreferences, saveSession } from './lib/db';
import { deterministicAnswer, hashFile, MAX_PDF_BYTES, MAX_PDF_PAGES, parsePdf, rankChunks, selectChunksForQuestion } from './lib/document';
import { askOnline, OnlineRequestError, onlineCooldownActive } from './lib/online';
import { MODELS, type ModelId } from './lib/modelCatalog';
import type { LocalModel } from './lib/localModel';
import { routeQuestion } from './lib/router';
import { shouldAutoLoadModel } from './lib/modelLoading';
import { QuickBot } from './QuickBot';
import { loadEngine } from './engine/client';

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = Event & { results: { length: number; [index: number]: RecognitionResult } };
type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; abort: () => void; onresult: ((event: RecognitionEvent) => void) | null; onerror: ((event: Event) => void) | null; onend: (() => void) | null };
type RecognitionConstructor = new () => Recognition;
declare global { interface Window { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor; } }

let modelManagerPromise: Promise<LocalModel> | undefined;
async function getModelManager(): Promise<LocalModel> {
  modelManagerPromise ??= import('./lib/localModel').then(({ LocalModel }) => new LocalModel());
  return modelManagerPromise;
}
const modelManager = { unload: async () => { if (modelManagerPromise) await (await modelManagerPromise).unload(); } };
const makeId = () => crypto.randomUUID();
const fmtTime = (stamp: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(stamp);
const defaultPreferences: Preferences = { displayName: '', modelId: 'SmolLM2-135M-Instruct-q0f16-MLC', modelAutoDownload: false, ocrEnabled: true, onlineConsent: true, readAloud: false, answerMode: 'online' };
function compactMemory(session: Session, messages: Message[]) {
  const through = Math.max(session.summaryThrough ?? 0, messages.length - 6);
  if (through <= (session.summaryThrough ?? 0)) return { summary: session.summary, summaryThrough: session.summaryThrough };
  const added = messages.slice(session.summaryThrough ?? 0, through).map(m => `${m.role === 'user' ? 'Reader' : 'Assistant'}: ${m.content.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n');
  const summary = [session.summary, added].filter(Boolean).join('\n').slice(-900);
  return { summary, summaryThrough: through };
}

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelId, setModelId] = useState<ModelId>(defaultPreferences.modelId as ModelId);
  const [modelState, setModelState] = useState<'not-loaded' | 'downloading' | 'initializing' | 'ready' | 'failed'>('not-loaded');
  const [modelProgress, setModelProgress] = useState({ text: '', value: 0 });
  const [modelError, setModelError] = useState('');
  const [onlineConsent, setOnlineConsent] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [speechPaused, setSpeechPaused] = useState(false);
  const [engine, setEngine] = useState<'online' | 'offline'>('online');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState({ phase: 'idle', completed: 0, total: 0 });
  const [activePdf, setActivePdf] = useState<Blob | null>(null);
  const controller = useRef<AbortController | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [toast, setToast] = useState('');
  const [sidebar, setSidebar] = useState(true);
  const [quickBotOpen, setQuickBotOpen] = useState(false);
  const [menuSessionId, setMenuSessionId] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerDocumentId, setViewerDocumentId] = useState<string | undefined>();
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceRows, setEvidenceRows] = useState<Chunk[]>([]);
  const [viewerPage, setViewerPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [ocr, setOcr] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const activeSessionRef = useRef<Session | null>(null);
  const modelLoadPromise = useRef<Promise<void> | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const spokenMessageId = useRef<string | null>(null);

  useEffect(() => {
    // Warm the prepared BITS search index and embedding worker after the Folio
    // shell mounts. This is deliberately non-blocking; Smart Quick Bot still
    // reports a normal loading/error state if the browser or network declines.
    void loadEngine().catch(() => undefined);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [all, storedPrefs] = await Promise.all([allSessions(), getPreferences()]);
        const legacy = storedPrefs as (Omit<Preferences, 'answerMode'> & { geminiConsent?: boolean; answerMode?: string }) | undefined;
        const resolvedMode: 'online' | 'offline' = (legacy?.answerMode === 'offline' || legacy?.answerMode === 'local') ? 'offline' : 'online';
        const nextPrefs: Preferences = {
          ...defaultPreferences,
          ...(storedPrefs ?? {}),
          modelAutoDownload: storedPrefs?.modelAutoDownload ?? false,
          onlineConsent: legacy?.onlineConsent ?? legacy?.geminiConsent ?? true,
          answerMode: resolvedMode,
          displayName: storedPrefs?.displayName ?? localStorage.getItem('folio-name') ?? '',
        };
        setPrefs(nextPrefs); setDisplayName(nextPrefs.displayName); setModelId(nextPrefs.modelId as ModelId); setOcr(nextPrefs.ocrEnabled); setOnlineConsent(nextPrefs.onlineConsent); setReadAloud(nextPrefs.readAloud ?? false); setEngine(resolvedMode);
        const recovered: Session[] = [];
        for (const session of all) {
          if (session.status === 'processing') {
            const doc = session.documentId ? await getDocument(session.documentId) : undefined;
            const pages = session.documentId ? await getPages(session.documentId) : [];
            const total = doc?.pageCount ?? session.pageCount ?? 0;
            const failedPages = pages.filter(page => page.quality === 'failed').map(page => page.page);
            const lowQualityPages = pages.filter(page => page.quality === 'thin').map(page => page.page);
            const complete = Boolean(doc?.pdf && total > 0 && pages.length >= total && !failedPages.length && !lowQualityPages.length);
            session.status = !doc?.pdf ? 'error' : complete ? 'ready' : 'partial';
            session.pageCount = total || session.pageCount;
            session.processing = { ...(session.processing ?? { phase: 'paused', completedPages: pages.length, totalPages: total, failedPages, updatedAt: Date.now() }), phase: complete ? 'complete' : 'paused', completedPages: pages.length, totalPages: total, failedPages, lowQualityPages };
            if (!doc?.pdf) session.processing.failedPages = [...new Set([...session.processing.failedPages, 0])];
            await saveSession(session);
          } else if (session.documentId) {
            const doc = await getDocument(session.documentId);
            if (!doc?.pdf) session.status = 'error';
          }
          recovered.push(session);
        }
        setSessions(recovered);
        const selected = recovered.find(s => s.id === nextPrefs.selectedSessionId);
        if (selected) setActive(selected);
      } catch { setToast('Local storage could not be restored. You can still start a new session.'); }
      finally { setLoaded(true); }
    })();
  }, []);
  useEffect(() => { if (loaded && 'storage' in navigator && navigator.storage?.persist) void navigator.storage.persist().catch(() => false); }, [loaded]);
  useEffect(() => { if (shouldAutoLoadModel({ appLoaded: loaded, displayName, enabled: prefs.modelAutoDownload, state: modelState })) void loadModel(modelId); }, [loaded, displayName, prefs.modelAutoDownload, modelState, modelId]);
  useEffect(() => { if (active) chatEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [active?.messages.length, busy]);
  useEffect(() => { activeIdRef.current = active?.id ?? null; activeSessionRef.current = active; }, [active]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3600); return () => clearTimeout(timer); } }, [toast]);
  useEffect(() => () => { recognition.current?.abort(); window.speechSynthesis?.cancel(); }, []);

  const primaryDocumentId = active?.documentId ?? active?.documents?.[0]?.id;
  const selectedViewerDocumentId = viewerDocumentId ?? primaryDocumentId;
  const viewerDocument = active?.documents?.find(doc => doc.id === selectedViewerDocumentId);
  useEffect(() => { let valid = true; setActivePdf(null); if (selectedViewerDocumentId) void getDocument(selectedViewerDocumentId).then(doc => { if (valid) setActivePdf(doc?.pdf ?? null); }).catch(() => setActivePdf(null)); return () => { valid = false; }; }, [selectedViewerDocumentId]);
  const currentUrl = useMemo(() => activePdf ? URL.createObjectURL(activePdf) : '', [selectedViewerDocumentId, activePdf]);
  useEffect(() => () => { if (currentUrl) URL.revokeObjectURL(currentUrl); }, [currentUrl]);

  function updateSession(next: Session, select = true) {
    next.updatedAt = Date.now();
    if (select) { activeSessionRef.current = next; setActive(next); } setSessions(prev => [next, ...prev.filter(s => s.id !== next.id)]);
    void saveSession(next).catch(() => setToast('This browser could not save the session locally.'));
    const nextPrefs = { ...prefs, selectedSessionId: select ? next.id : prefs.selectedSessionId, displayName, modelId, ocrEnabled: ocr, onlineConsent, readAloud, answerMode: engine };
    setPrefs(nextPrefs); void savePreferences(nextPrefs).catch(() => setToast('Could not save your preferences locally.'));
  }
  function startSession() {
    const created = newSession('New conversation'); updateSession(created); setQuickBotOpen(false); setSidebar(false); setViewerOpen(false); setQuery('');
    requestAnimationFrame(() => fileRef.current?.click());
  }
  async function uploadFiles(files: File[]) {
    for (const file of files) await upload(file);
  }
  async function upload(file?: File) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setToast('Choose a PDF file to continue.'); return; }
    if (file.size > MAX_PDF_BYTES) { setToast('PDFs can be up to 100 MB.'); return; }
    const target = activeSessionRef.current ?? active ?? newSession(file.name.replace(/\.pdf$/i, '') || 'New document');
    const hash = await hashFile(file);
    const existing = [...sessions.flatMap(session => session.documents ?? []), ...(target.documents ?? [])].find(doc => doc.hash === hash || doc.fileName.toLowerCase() === file.name.toLowerCase());
    if (existing) { setToast(`${file.name} is already imported.`); return; }
    const documentId = makeId();
    const ref: DocumentRef = { id: documentId, fileName: file.name, hash, status: 'processing', processing: { phase: 'parsing', completedPages: 0, totalPages: 0, failedPages: [], updatedAt: Date.now() } };
    const documents = [...(target.documents ?? (target.documentId ? [{ id: target.documentId, fileName: target.fileName ?? 'document.pdf', pageCount: target.pageCount, status: target.status, processing: target.processing }] : [])), ref];
    const next = { ...target, documentId: target.documentId ?? documentId, name: target.name === 'New conversation' ? file.name.replace(/\.pdf$/i, '') : target.name, fileName: target.fileName ?? file.name, documents, selectedDocumentIds: [...new Set([...(target.selectedDocumentIds ?? []), documentId])], status: 'processing' as const, pageCount: target.pageCount, processing: ref.processing };
    controller.current?.abort(); const operation = new AbortController(); controller.current = operation;
    setProcessing({ phase: 'parsing', completed: 0, total: 0 });
    try {
      await saveDocument(documentId, file, hash, ref);
      updateSession(next);
      const result = await parsePdf(file, async (page, chunks, completed, total) => {
        await savePageAndChunks(documentId, page, chunks);
        const phase = page.quality === 'thin' || page.quality === 'failed' ? 'ocr' : 'indexing';
        const processingState = { phase: phase as 'ocr' | 'indexing', completedPages: completed, totalPages: total, failedPages: page.quality === 'failed' ? [...(next.processing?.failedPages ?? []), page.page] : (next.processing?.failedPages ?? []), updatedAt: Date.now() };
        await saveDocProgress(documentId, total, processingState);
        const updatedDocuments = next.documents?.map(doc => doc.id === documentId ? { ...doc, pageCount: total, processing: processingState } : doc);
        const live = { ...next, documents: updatedDocuments, pageCount: total, processing: processingState };
        if (activeIdRef.current === live.id) { setActive(live); setProcessing({ phase, completed, total }); }
        setSessions(prev => [live, ...prev.filter(s => s.id !== live.id)]);
        if (completed === total || completed % 5 === 0) await saveSession(live);
      }, ocr, operation.signal, (phase, page, total) => { if (activeIdRef.current === next.id) setProcessing({ phase, completed: page - 1, total }); });
      const status = result.failedPages.length || result.lowQualityPages.length ? 'partial' as const : 'ready' as const;
      const finalProcessing = { phase: 'complete' as const, completedPages: result.pageCount, totalPages: result.pageCount, failedPages: result.failedPages, lowQualityPages: result.lowQualityPages, updatedAt: Date.now() };
      const finalDocuments = next.documents?.map(doc => doc.id === documentId ? { ...doc, pageCount: result.pageCount, status, processing: finalProcessing } : doc);
      const finalSession = { ...next, documents: finalDocuments, pageCount: result.pageCount, status, processing: finalProcessing };
      await saveDocProgress(documentId, result.pageCount, finalSession.processing); updateSession(finalSession, activeIdRef.current === finalSession.id);
      setToast(status === 'partial' ? `Indexed with warnings: ${result.failedPages.length} failed and ${result.lowQualityPages.length} low-text page(s). Review or retry with OCR.` : `Ready to explore · ${result.pageCount} pages indexed on this device${result.ocrPages ? ` · OCR on ${result.ocrPages} scanned page(s)` : ''}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const pages = next.documentId ? await getPages(next.documentId).catch(() => []) : [];
        const paused = { ...next, status: pages.length ? 'partial' as const : 'error' as const, processing: { phase: 'paused' as const, completedPages: pages.length, totalPages: next.pageCount ?? 0, failedPages: [], updatedAt: Date.now() } };
        updateSession(paused, activeIdRef.current === paused.id); setToast('Processing paused. Completed pages are saved; choose Retry to continue.');
      } else {
        const failedProcessing = { phase: 'error' as const, completedPages: 0, totalPages: next.pageCount ?? 0, failedPages: [], updatedAt: Date.now() };
        const failed = { ...next, status: 'error' as const, documents: next.documents?.map(doc => doc.id === documentId ? { ...doc, status: 'error' as const, processing: failedProcessing, error: error instanceof Error ? error.message : 'Could not process this PDF.' } : doc), processing: failedProcessing }; updateSession(failed, activeIdRef.current === failed.id);
        setToast(error instanceof Error ? error.message : 'Could not process this PDF.');
      }
    } finally { if (controller.current === operation) { setProcessing({ phase: 'idle', completed: 0, total: 0 }); controller.current = null; } }
  }
  async function retryProcessing(session = active) {
    if (!session?.documentId) { fileRef.current?.click(); return; }
    const doc = await getDocument(session.documentId); if (!doc?.pdf) { setToast('The cached PDF is missing. Choose the file again to retry.'); fileRef.current?.click(); return; }
    const pages = await getPages(session.documentId); const done = new Set(pages.filter(p => p.quality === 'good' || p.quality === 'ocr').map(p => p.page));
    const operation = new AbortController(); controller.current?.abort(); controller.current = operation; setProcessing({ phase: 'parsing', completed: done.size, total: session.pageCount ?? 0 });
    const next = { ...session, status: 'processing' as const }; updateSession(next);
    try {
      const result = await parsePdf(doc.pdf, async (page, chunks, completed, total) => {
        await savePageAndChunks(session.documentId!, page, chunks);
        const failedPages = page.quality === 'failed' ? [...(session.processing?.failedPages ?? []), page.page] : (session.processing?.failedPages ?? []).filter(p => p !== page.page);
        const progress = { phase: page.quality === 'thin' || page.quality === 'failed' ? 'ocr' as const : 'indexing' as const, completedPages: completed, totalPages: total, failedPages, updatedAt: Date.now() };
        await saveDocProgress(session.documentId!, total, progress); if (activeIdRef.current === session.id) setProcessing({ phase: progress.phase, completed, total });
      }, ocr, operation.signal, (phase, page, total) => { if (activeIdRef.current === session.id) setProcessing({ phase, completed: page - 1, total }); }, done);
      const nextStatus = result.failedPages.length || result.lowQualityPages.length ? 'partial' as const : 'ready' as const;
      const complete = { ...next, status: nextStatus, pageCount: result.pageCount, processing: { phase: 'complete' as const, completedPages: result.pageCount, totalPages: result.pageCount, failedPages: result.failedPages, lowQualityPages: result.lowQualityPages, updatedAt: Date.now() } };
      await saveDocProgress(session.documentId, result.pageCount, complete.processing); updateSession(complete, activeIdRef.current === complete.id);
      setToast(nextStatus === 'partial' ? `${result.failedPages.length} failed and ${result.lowQualityPages.length} low-text page(s) still need review.` : 'Document processing completed.');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        const completedPages = await getPages(session.documentId).then(found => found.length).catch(() => 0);
        updateSession({ ...next, status: completedPages ? 'partial' : 'error', processing: { phase: 'paused', completedPages, totalPages: session.pageCount ?? 0, failedPages: session.processing?.failedPages ?? [], lowQualityPages: session.processing?.lowQualityPages, updatedAt: Date.now() } }, activeIdRef.current === next.id);
        setToast('Processing paused. Completed pages are saved; choose Retry to continue.');
      } else {
        updateSession({ ...next, status: 'error', processing: { phase: 'error', completedPages: session.processing?.completedPages ?? 0, totalPages: session.pageCount ?? 0, failedPages: session.processing?.failedPages ?? [], updatedAt: Date.now() } }, activeIdRef.current === next.id);
        setToast(error instanceof Error ? error.message : 'Retry failed.');
      }
    }
    finally { if (controller.current === operation) { setProcessing({ phase: 'idle', completed: 0, total: 0 }); controller.current = null; } }
  }
  function cancelProcessing() { controller.current?.abort(); }
  async function loadModel(targetModelId?: ModelId) {
    const requestedModel = targetModelId ?? modelId;
    const modelManager = await getModelManager();
    if (modelManager.isReady(requestedModel)) {
      setModelState('ready');
      setModelProgress({ text: 'Model is ready in this tab', value: 1 });
      return;
    }
    setModelState('downloading'); setModelError(''); setModelProgress({ text: 'Downloading…', value: 0 });
    try {
      const operation = modelManager.load(requestedModel, (text, value) => {
        setModelProgress({ text, value });
        setModelState(value >= 1 ? 'ready' : /initializ|compil|shader/i.test(text) ? 'initializing' : 'downloading');
      });
      modelLoadPromise.current = operation;
      await operation;
      setModelState('ready');
      setModelProgress({ text: 'Model is ready in this tab', value: 1 });
      setToast('Local model is ready on this device.');
    } catch (err) {
      setModelState('failed');
      setModelError(err instanceof Error ? err.message : 'Model could not be loaded.');
      setModelProgress({ text: '', value: 0 });
    } finally {
      modelLoadPromise.current = null;
    }
  }
  function setConsent(value: boolean) { setOnlineConsent(value); const next = { ...prefs, displayName, selectedSessionId: active?.id, modelId, ocrEnabled: ocr, onlineConsent: value, answerMode: engine }; setPrefs(next); void savePreferences(next); }

  async function sendMessage(text = query, retry = false) {
    if (!active || busy || !text.trim()) return;
    if (!active.documentId || !['ready', 'partial'].includes(active.status)) {
      const exact = deterministicAnswer(text, active);
      if (exact) { const user: Message = { id: makeId(), role: 'user', content: text.trim(), createdAt: Date.now() }; const answer: Message = { id: makeId(), role: 'assistant', content: exact, createdAt: Date.now() }; updateSession({ ...active, messages: [...active.messages, user, answer] }); setQuery(''); return; }
      setToast('Add a PDF and wait for it to finish processing first.'); return;
    }
    if (engine === 'online' && !onlineConsent) { setSettingsOpen(true); setToast('Enable online AI in Settings to use Online mode, or switch to Offline mode.'); return; }
    if (engine === 'offline' && modelState !== 'ready') {
      if (modelState === 'downloading' || modelState === 'initializing') { setToast('Preparing local model… Please wait for initialization to complete.'); return; }
      if (modelState === 'failed') { setToast('Local model failed to load. Click Retry to reload.'); return; }
      void loadModel(modelId);
      setToast('Preparing local model…');
      return;
    }
    const previousUser = [...active.messages].reverse().find(message => message.role === 'user');
    const userMessage: Message = retry && previousUser ? previousUser : { id: makeId(), role: 'user', content: text.trim(), createdAt: Date.now() };
    const nextMessages = retry && active.messages.at(-1)?.error ? active.messages.slice(0, -1) : [...active.messages];
    if (!retry) nextMessages.push(userMessage);
    updateSession({ ...active, messages: nextMessages, ...compactMemory(active, nextMessages) }); setQuery(''); setBusy(true); setStreamingText('');
    requestController.current = new AbortController();
    try {
      const deterministic = deterministicAnswer(userMessage.content, active);
      if (deterministic) {
        const assistant: Message = { id: makeId(), role: 'assistant', content: deterministic, createdAt: Date.now() };
        updateSession({ ...active, messages: [...nextMessages, assistant] }); return;
      }
      const documentRefs = active.documents?.length ? active.documents : active.documentId ? [{ id: active.documentId, fileName: active.fileName ?? 'document.pdf', pageCount: active.pageCount, status: active.status }] : [];
      const selectedIds = new Set(active.selectedDocumentIds?.length ? active.selectedDocumentIds : documentRefs.map(doc => doc.id));
      const selectedRefs = documentRefs.filter(doc => selectedIds.has(doc.id) && ['ready', 'partial'].includes(doc.status));
      const storedChunks = (await Promise.all(selectedRefs.map(async doc => (await getChunks(doc.id)).map(chunk => ({ ...chunk, documentId: doc.id, fileName: doc.fileName }))))).flat();
      const evidence = selectChunksForQuestion(userMessage.content, storedChunks, 18_000);
      if (!evidence.length) throw new Error(selectedRefs.length ? 'I could not find supporting text in the selected PDFs. Try a more specific phrase or select another document.' : 'The selected PDFs have no readable indexed text. Check processing or enable OCR, then retry.');
      setEvidenceRows(evidence);
      const context = [active.summary ?? '', ...active.messages.slice(-6).map(m => `${m.role === 'user' ? 'Reader' : 'Assistant'}: ${m.content.slice(0, 500)}`)].filter(Boolean);
      let answer = '';
      const modelManager = routeQuestion({ mode: engine, deterministic: false, consent: onlineConsent, modelReady: false, onlineAvailable: !onlineCooldownActive() }) === 'local' ? await getModelManager() : undefined;
      const isLocalReady = modelState === 'ready' && Boolean(modelManager?.isReady(modelId));
      const route = routeQuestion({ mode: engine, deterministic: false, consent: onlineConsent, modelReady: isLocalReady, onlineAvailable: !onlineCooldownActive() });
      let answerMode: 'online' | 'offline' = engine;
      if (route === 'local') {
        answer = await modelManager!.ask(userMessage.content, evidence, context, token => setStreamingText(current => current + token));
        answerMode = 'offline';
      } else if (route === 'online') {
        try {
          answer = await askOnline(userMessage.content, evidence, onlineConsent, engine, context, requestController.current.signal);
          answerMode = 'online';
        } catch (cloudError) {
          throw new Error(cloudError instanceof Error ? `Online provider error: ${cloudError.message}. You can retry or switch to Offline mode.` : 'Online AI providers are unavailable. You can retry or switch to Offline mode.');
        }
      } else if (route === 'provider_cooldown') {
        throw new OnlineRequestError('Online AI providers are temporarily unavailable or cooling down. Retry shortly or manually switch to Offline mode.', 'provider_unavailable');
      } else if (route === 'ask_consent') {
        throw new Error('Online consent is required. Enable online AI in Settings, or switch to Offline mode.');
      } else if (route === 'model_required') {
        throw new Error('The selected local model is not ready. Wait for initialization or click Retry in the status indicator.');
      }
      const citations: Citation[] = [...new Map(evidence.map((chunk: Chunk) => [`${chunk.documentId ?? 'legacy'}:${chunk.page}`, { documentId: chunk.documentId ?? '', fileName: chunk.fileName ?? active.fileName ?? 'document.pdf', page: chunk.page }])).values()];
      const assistant: Message = { id: makeId(), role: 'assistant', content: answer, createdAt: Date.now(), citations, mode: answerMode };
      const completeMessages = [...nextMessages, assistant]; updateSession({ ...active, messages: completeMessages, ...compactMemory(active, completeMessages) });
      if (readAloud && !window.speechSynthesis?.speaking) speakResponse(answer, assistant.id);
    } catch (err) {
      const assistant: Message = { id: makeId(), role: 'assistant', content: err instanceof Error ? err.message : 'Something went wrong while answering.', createdAt: Date.now(), error: true };
      const completeMessages = [...nextMessages, assistant]; updateSession({ ...active, messages: completeMessages, ...compactMemory(active, completeMessages) });
    } finally { setBusy(false); setStreamingText(''); requestController.current = null; inputRef.current?.focus(); }
  }
  function speakResponse(text: string, messageId: string) {
    if (!('speechSynthesis' in window)) { setVoiceError('Speech synthesis is not supported in this browser.'); return; }
    if (spokenMessageId.current === messageId) return;
    spokenMessageId.current = messageId;
    const clean = text.replace(/\[p\.\s*\d+\]/gi, '').replace(/https?:\/\/\S+/g, '').replace(/```[\s\S]*?```/g, ' code omitted ').trim();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.onstart = () => { setSpeaking(true); setSpeechPaused(false); };
    utterance.onend = () => { setSpeaking(false); setSpeechPaused(false); };
    utterance.onerror = () => { setSpeaking(false); setVoiceError('The browser could not read this response aloud.'); };
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
  }
  function toggleListening() {
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) { setVoiceError('Voice input is not supported in this browser. You can still type normally.'); return; }
    if (listening) { recognition.current?.stop(); setListening(false); return; }
    const instance = new Constructor(); recognition.current = instance; setVoiceError('');
    instance.continuous = false; instance.interimResults = true; instance.lang = navigator.language || 'en-US';
    instance.onresult = event => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => event.results[index][0]?.transcript ?? '').join(' ');
      setQuery(transcript.trim());
    };
    instance.onerror = () => { setListening(false); setVoiceError('Microphone or speech recognition failed. Check permission and try again.'); };
    instance.onend = () => setListening(false);
    try { instance.start(); setListening(true); } catch { setVoiceError('The microphone could not be started.'); }
  }
  function stopSpeaking() { window.speechSynthesis?.cancel(); setSpeaking(false); setSpeechPaused(false); }
  async function stopGeneration() {
    requestController.current?.abort(); if (modelManagerPromise) (await modelManagerPromise).stop(); setStreamingText('');
  }
  async function openEvidence() {
    if (!active?.documentId) return;
    const lastUser = [...active.messages].reverse().find(message => message.role === 'user');
    if (lastUser) setEvidenceRows(rankChunks(lastUser.content, await getChunks(active.documentId), 4));
    setViewerOpen(false); setEvidenceOpen(true);
  }
  async function chooseSession(session: Session) {
    setQuickBotOpen(false); setSidebar(false); setActive(session); setViewerOpen(false); setEvidenceOpen(false); setSettingsOpen(false); setQuery(''); setViewerPage(1);
    const next = { ...prefs, selectedSessionId: session.id }; setPrefs(next); void savePreferences(next);
  }
  async function deleteSession(session: Session) {
    if (!window.confirm(`Delete “${session.name}” and its PDF data from this device?`)) return;
    await removeSession(session.id); setSessions(prev => prev.filter(s => s.id !== session.id));
    if (active?.id === session.id) setActive(null);
    setToast('Session deleted from this device.');
  }
  async function clearAllData() {
    if (!window.confirm('Delete every PDF, conversation, extracted page, and preference stored by Folio on this device?')) return;
    controller.current?.abort(); await clearApplicationData(); setSessions([]); setActive(null); setActivePdf(null);
    localStorage.removeItem('folio-name'); setDisplayName(''); setPrefs(defaultPreferences); setSettingsOpen(false); setToast('Local application data cleared.');
  }
  async function renameSession(session: Session) {
    const name = window.prompt('Name this session', session.name)?.trim();
    if (name) { const changed = { ...session, name }; updateSession(changed, active?.id === session.id); }
  }
  function toggleDocument(documentId: string) {
    if (!active) return;
    const current = active.selectedDocumentIds?.length ? active.selectedDocumentIds : (active.documents ?? []).map(doc => doc.id);
    const selectedDocumentIds = current.includes(documentId) ? current.filter(id => id !== documentId) : [...current, documentId];
    if (!selectedDocumentIds.length) { setToast('Select at least one readable PDF before asking a question.'); return; }
    updateSession({ ...active, selectedDocumentIds });
  }
  async function removeDocument(documentId: string) {
    if (!active) return;
    const doc = active.documents?.find(item => item.id === documentId);
    if (!doc || !window.confirm(`Remove “${doc.fileName}” and its indexed text from this device?`)) return;
    controller.current?.abort();
    await deleteDocumentData(documentId);
    const documents = (active.documents ?? []).filter(item => item.id !== documentId);
    const selectedDocumentIds = (active.selectedDocumentIds ?? documents.map(item => item.id)).filter(id => id !== documentId);
    const primary = documents[0];
    const next = { ...active, documents, selectedDocumentIds, documentId: primary?.id, fileName: primary?.fileName, pageCount: primary?.pageCount, status: primary?.status ?? 'empty', processing: primary?.processing };
    updateSession(next);
    setToast(`${doc.fileName} removed from this conversation.`);
  }
  const visibleSessions = sessions.filter(s => `${s.name} ${s.fileName ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  const lastQuestion = [...(active?.messages ?? [])].reverse().find(message => message.role === 'user')?.content ?? '';

  if (!loaded) return <div className="splash"><div className="brand-mark">f</div><span>Opening your library…</span></div>;
  if (!displayName) return <main className="welcome-shell"><div className="welcome-orb orb-a"/><div className="welcome-orb orb-b"/><header className="welcome-top"><Logo/><div className="local-pill"><span/>Local-first by design</div></header><section className="welcome-main"><div className="eyebrow"><Sparkles size={14}/> YOUR DOCUMENTS, IN FOCUS</div><h1>Good ideas deserve<br/><em>good questions.</em></h1><p className="welcome-copy">A quieter way to understand what you read.<br/>PDFs stay in this browser unless you choose cloud reasoning.</p><form className="name-card" onSubmit={e => { e.preventDefault(); const name = nameDraft.trim(); if (name) { localStorage.setItem('folio-name', name); setDisplayName(name); const next = { ...prefs, displayName: name }; setPrefs(next); void savePreferences(next); } }}><label htmlFor="name">What should we call you?</label><div className="name-input-row"><input id="name" autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder="Your name" maxLength={40}/><button aria-label="Continue" disabled={!nameDraft.trim()}><ArrowRight size={19}/></button></div><small>No account needed. Just a name for your library.</small></form><div className="welcome-features"><span><ShieldCheck size={16}/> Private by default</span><span><BookOpen size={16}/> Up to 100 MB per PDF</span><span><Sparkles size={16}/> AI when you want it</span></div></section><footer className="welcome-footer"><span>Made for reading with intention.</span><span>Private · Personal · Yours</span></footer></main>;

  return <div className="app-shell">
    <aside className={`sidebar ${sidebar ? '' : 'sidebar-hidden'}`}>
      <div className="sidebar-head"><Logo/><button className="icon-button subtle" onClick={() => setSidebar(false)} aria-label="Hide sidebar"><PanelLeftClose size={17}/></button></div>
      <button className="new-chat" onClick={startSession}><Plus size={17}/> New conversation <span>⌘ K</span></button>
      <button className="new-chat quick-bot-nav" onClick={() => { setQuickBotOpen(true); setSidebar(false); }}><Sparkles size={16}/> Smart Quick Bot</button>
      <div className="nav-label">YOUR LIBRARY <button aria-label="Search sessions" onClick={() => setSearchOpen(!searchOpen)}><Search size={15}/></button></div>
      {searchOpen && <input className="session-search" autoFocus placeholder="Search sessions" value={filter} onChange={e => setFilter(e.target.value)}/>}
      <div className="session-list">{visibleSessions.map(s => <div key={s.id} className={`session-item ${active?.id === s.id ? 'selected' : ''}`}><button className="session-pick" onClick={() => void chooseSession(s)}><FileText size={16}/><span><b>{s.name}</b><small>{s.fileName || 'No PDF yet'}</small></span></button><button className="session-more" aria-label={`Options for ${s.name}`} onClick={() => setMenuSessionId(menuSessionId === s.id ? '' : s.id)}><MoreHorizontal size={16}/></button>{menuSessionId === s.id && <div className="session-menu"><button onClick={() => { setMenuSessionId(''); void renameSession(s); }}>Rename</button><button className="danger" onClick={() => { setMenuSessionId(''); void deleteSession(s); }}>Delete</button></div>}</div>)}{!visibleSessions.length && <div className="no-sessions">{filter ? 'No matching sessions' : 'Your recent conversations will appear here.'}</div>}</div>
      <div className="sidebar-spacer"/>
      <button className="privacy-card" onClick={() => setSettingsOpen(true)}><div className="privacy-icon"><ShieldCheck size={18}/></div><span><b>Your space stays yours</b><small>PDFs and chats live on this device.</small></span><ArrowRight size={15}/></button>
      <div className="profile-row"><div className="avatar">{displayName.slice(0,1).toUpperCase()}</div><div><b>{displayName}</b><small>Personal library</small></div><button className="icon-button subtle" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={17}/></button></div>
    </aside>
    {sidebar && <button type="button" className="sidebar-scrim" onClick={() => setSidebar(false)} aria-label="Close navigation" />}

    <main className="main-area">
      <header className="topbar">{!sidebar && <button className="icon-button" onClick={() => setSidebar(true)} aria-label="Show sidebar"><ArrowRight size={18}/></button>}<div className="breadcrumbs"><span>Library</span><span className="crumb-slash">/</span><b>{active?.name ?? 'Your reading space'}</b></div><div className="top-actions">{active?.fileName && <button className={`file-chip ${viewerOpen ? 'on' : ''}`} onClick={() => { setEvidenceOpen(false); setViewerOpen(!viewerOpen); }}><FileText size={15}/><span>{active.fileName}</span><ChevronDown size={14}/></button>}{active?.fileName && <button className="file-chip" onClick={() => void openEvidence()}><Search size={14}/>Evidence</button>}<button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings2 size={18}/></button></div></header>
      {quickBotOpen ? <QuickBot onBack={() => setQuickBotOpen(false)}/> : active ? <div className={`workspace ${viewerOpen || evidenceOpen ? 'with-viewer' : ''}`}>
        <section className="chat-column">
          {active.messages.length === 0 ? <div className="empty-chat"><div className="doc-icon"><FileText size={24}/><span>PDF</span></div><div className="eyebrow muted">A NEW READING SESSION</div><h2>{active.fileName ? `Let’s explore ${active.fileName}` : 'Bring a document into focus.'}</h2><p>{active.fileName ? 'Ask a question, find a detail, or get the shape of the whole thing.' : 'Add a PDF and start asking better questions.'}</p>{!active.fileName && <button className="primary-button upload-button" onClick={() => fileRef.current?.click()}><Upload size={16}/> Choose a PDF</button>}{active.fileName && active.status === 'processing' && <div className="progress-wrap"><div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={processing.total || 100} aria-valuenow={processing.completed}><span style={{ width: `${processing.total ? Math.round(processing.completed / processing.total * 100) : 0}%` }}/></div><span>Reading your PDF · {processing.total ? Math.round(processing.completed / processing.total * 100) : 0}%</span></div>}{active.fileName && active.status === 'ready' && <div className="suggestions"><button onClick={() => void sendMessage('Summarize the main ideas in this document.')}>Give me the key takeaways <ArrowRight size={14}/></button><button onClick={() => void sendMessage('What are the most important points I should remember?')}>What should I remember? <ArrowRight size={14}/></button><button onClick={() => void sendMessage('What evidence or examples does this document provide?')}>Find evidence and examples <ArrowRight size={14}/></button></div>}<div className="private-note"><ShieldCheck size={15}/> PDFs stay in this browser; selected excerpts go to an online model only with consent. Limit: 100 MB · {MAX_PDF_PAGES.toLocaleString()} pages.</div></div> : <div className="messages"><div className="thread-heading"><span className="thread-icon"><MessageSquareText size={16}/></span><div><b>{active.name}</b><small>{active.fileName ? `${active.pageCount ?? '…'} pages · ${active.status === 'ready' ? 'Ready to ask' : 'Processing'}` : 'Conversation'}</small></div><button className="icon-button" onClick={() => { setViewerDocumentId(primaryDocumentId); setViewerPage(1); setEvidenceOpen(false); setViewerOpen(true); }} title="Open PDF"><BookOpen size={17}/></button></div><DocumentPicker documents={active.documents ?? (active.documentId ? [{ id: active.documentId, fileName: active.fileName ?? '', pageCount: active.pageCount, status: active.status }] : [])} selected={active.selectedDocumentIds ?? (active.documents ?? []).map(doc => doc.id)} onToggle={toggleDocument} onRemove={id => void removeDocument(id)} onAdd={() => fileRef.current?.click()} />{active.messages.map(m => <article className={`message-row ${m.role}`} key={m.id}><div className={`message-avatar ${m.role}`}>{m.role === 'assistant' ? <span className="mini-mark">f</span> : displayName.slice(0,1).toUpperCase()}</div><div className="message-body"><div className="message-meta"><b>{m.role === 'assistant' ? 'Folio' : 'You'}</b><span>{fmtTime(m.createdAt)}</span>{m.role === 'assistant' && <span className="source-mode"><Sparkles size={12}/>{m.mode === 'offline' ? 'Offline' : 'Online'}</span>}</div><p>{m.content}</p>{m.error && active.messages.at(-1)?.id === m.id && <button className="retry-answer" onClick={() => void sendMessage(lastQuestion, true)}>Retry answer</button>}{m.citations?.length ? <div className="citation-row"><span>Sources</span>{          m.citations.map(citation => <button key={`${citation.documentId}:${citation.page}`} onClick={() => { setViewerDocumentId(citation.documentId || primaryDocumentId); setViewerPage(citation.page); setEvidenceOpen(false); setViewerOpen(true); }}>{citation.fileName} · p. {citation.page}</button>)}</div> : null}</div></article>)}{busy && <div className="thinking">{streamingText ? <span>{streamingText}</span> : <><LoaderCircle size={16}/> Reading relevant passages…</>}<button onClick={() => void stopGeneration()}>Stop</button></div>}<div ref={chatEnd}/></div>}
          {active.status === 'processing' && <div className="processing-banner"><div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={processing.total || 100} aria-valuenow={processing.completed}><span style={{ width: `${processing.total ? Math.round(processing.completed / processing.total * 100) : 0}%` }}/></div><span>{processing.phase === 'ocr' ? 'OCR' : processing.phase === 'indexing' ? 'Indexing' : 'Parsing'} · {processing.completed}/{processing.total || '…'} pages</span><button onClick={cancelProcessing}>Cancel</button></div>}
          {(active.status === 'partial' || active.status === 'error') && <div className="processing-banner warning"><span>{active.status === 'partial' ? `${(active.processing?.failedPages.length ?? 0) + (active.processing?.lowQualityPages?.length ?? 0)} page(s) need review. Some text may be missing.` : 'Processing stopped or cached document data is missing.'}</span><button onClick={() => void retryProcessing()}>Retry processing</button><button onClick={() => fileRef.current?.click()}>Choose PDF again</button></div>}
          <div className="composer-wrap"><div className="composer"><textarea ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendMessage(); } }} placeholder={['ready','partial'].includes(active.status) ? 'Ask anything about this document…' : 'Add a PDF to get started…'} disabled={!['ready','partial'].includes(active.status) || busy} rows={1}/><div className="composer-tools"><div className="mode-toggle-group" role="radiogroup" aria-label="Chat mode"><button type="button" className={`mode-toggle-btn ${engine === 'online' ? 'active' : ''}`} onClick={() => { setEngine('online'); const updated = { ...prefs, answerMode: 'online' as const }; setPrefs(updated); void savePreferences(updated); }} aria-checked={engine === 'online'} role="radio">Online</button><button type="button" className={`mode-toggle-btn ${engine === 'offline' ? 'active' : ''}`} onClick={() => { setEngine('offline'); const updated = { ...prefs, answerMode: 'offline' as const }; setPrefs(updated); void savePreferences(updated); }} aria-checked={engine === 'offline'} role="radio">Offline</button>          </div><div className="voice-controls"><button type="button" className={`icon-button ${listening ? 'active' : ''}`} onClick={toggleListening} disabled={busy} aria-label={listening ? 'Stop recording' : 'Start voice input'} title={listening ? 'Stop recording' : 'Voice input'}>{listening ? <Square size={15}/> : <Mic size={15}/>}</button><button type="button" className={`icon-button ${readAloud ? 'active' : ''}`} onClick={() => { const value = !readAloud; setReadAloud(value); const next = { ...prefs, readAloud: value }; setPrefs(next); void savePreferences(next); }} aria-pressed={readAloud} aria-label="Read responses aloud" title="Read responses aloud"><Volume2 size={15}/></button>{speaking && <button type="button" className="icon-button" onClick={stopSpeaking} aria-label="Stop speaking" title="Stop speaking"><Square size={14}/></button>}{speaking && <button type="button" className="icon-button" onClick={() => { if (speechPaused) { window.speechSynthesis.resume(); setSpeechPaused(false); } else { window.speechSynthesis.pause(); setSpeechPaused(true); } }} aria-label={speechPaused ? 'Resume speaking' : 'Pause speaking'} title={speechPaused ? 'Resume speaking' : 'Pause speaking'}>{speechPaused ? <Play size={14}/> : <Pause size={14}/>}</button>}</div><div className="local-status-badge" aria-live="polite"><span className={`local-status-dot ${modelState}`} /><span className="local-status-text">{modelState === 'ready' && 'Local model: Ready'}{modelState === 'downloading' && (modelProgress.value > 0 ? `Local model: Downloading… ${Math.round(modelProgress.value * 100)}%` : 'Local model: Downloading…')}{modelState === 'initializing' && 'Local model: Initializing…'}{modelState === 'failed' && <>Local model: Failed — <button type="button" className="local-retry-btn" onClick={() => void loadModel(modelId)}>Retry</button></>}{modelState === 'not-loaded' && 'Local model: Not started'}</span></div><div className="composer-right">{engine === 'offline' && (modelState === 'downloading' || modelState === 'initializing') ? <span className="enter-hint preparing">Preparing local model…</span> : <span className="enter-hint">↵ to ask</span>}<button className="send-button" onClick={() => void sendMessage()} disabled={!query.trim() || busy || !['ready','partial'].includes(active.status) || (engine === 'offline' && modelState !== 'ready')} aria-label="Send question"><Send size={16}/></button></div></div>          </div>{voiceError && <div className="voice-error" role="status">{voiceError}</div>}<div className="composer-caption"><ShieldCheck size={13}/>{engine === 'online' ? 'Online mode: Selected excerpts are sent to configured provider with consent.' : 'Offline mode: answers use the selected on-device model. Browser voice services may have their own processing.'}<button onClick={() => setSettingsOpen(true)}>Privacy settings</button></div></div>
        </section>
        {viewerOpen && <aside className="viewer-panel"><div className="viewer-head"><div><FileText size={16}/><b>{viewerDocument?.fileName ?? active.fileName}</b></div><button className="icon-button" onClick={() => setViewerOpen(false)} aria-label="Close PDF"><X size={17}/></button></div>{currentUrl ? <><div className="pdf-page-nav"><button onClick={() => setViewerPage(p => Math.max(1, p - 1))} aria-label="Previous page">‹</button><span>Page {viewerPage} of {viewerDocument?.pageCount ?? active.pageCount ?? '…'}</span><button onClick={() => setViewerPage(p => Math.min(viewerDocument?.pageCount ?? active.pageCount ?? p + 1, p + 1))} aria-label="Next page">›</button><input aria-label="Go to page" type="number" min="1" max={viewerDocument?.pageCount ?? active.pageCount} value={viewerPage} onChange={e => setViewerPage(Math.max(1, Math.min(viewerDocument?.pageCount ?? active.pageCount ?? 1, Number(e.target.value) || 1)))}/></div><iframe title="PDF preview" src={`${currentUrl}#page=${viewerPage}`} /></> : <div className="viewer-empty">Upload a PDF to preview it here.</div>}</aside>}
        {evidenceOpen && <aside className="viewer-panel evidence-panel"><div className="viewer-head"><div><Search size={15}/><b>Relevant passages</b></div><button className="icon-button" onClick={() => setEvidenceOpen(false)} aria-label="Close evidence"><X size={17}/></button></div><div className="evidence-list">{evidenceRows.length ? evidenceRows.map((chunk, index) => <article className="evidence-card" key={chunk.id}><div><span>PASSAGE {index + 1}</span><button onClick={() => { setEvidenceOpen(false); setViewerPage(chunk.page); setViewerOpen(true); }}>p. {chunk.page}</button></div><p>{chunk.text}</p>{chunk.section && <small>{chunk.section}</small>}</article>) : <div className="viewer-empty">Ask a question to see the passages used for retrieval.</div>}</div><div className="evidence-note"><ShieldCheck size={14}/> Excerpts are stored on this device. Open a page to inspect the source.</div></aside>}
      </div> : <div className="home-view"><div className="home-welcome"><div className="eyebrow muted">YOUR PERSONAL READING SPACE</div><h1>What are we <em>reading,</em><br/> {displayName}?</h1><p>Drop in a document. We’ll help you find what matters.</p><button className="primary-button" onClick={startSession}><Plus size={17}/> Start a conversation</button></div><div className="library-heading"><div><b>Recent conversations</b><small>Your library is stored on this device</small></div><button className="text-button" onClick={() => setSettingsOpen(true)}>Privacy details <ArrowRight size={14}/></button></div>{sessions.length ? <div className="recent-grid">{sessions.slice(0, 6).map(s => <button className="recent-card" key={s.id} onClick={() => void chooseSession(s)}><div className="recent-card-top"><div className="recent-file-icon"><FileText size={19}/></div><span className={`status-pill ${s.status}`}>{s.status === 'ready' ? <><Check size={11}/> Ready</> : s.status === 'processing' ? 'Processing' : s.status === 'error' ? 'Needs attention' : 'New'}</span><span className="recent-time">{fmtTime(s.updatedAt)}</span></div><b>{s.name}</b><small>{s.fileName ? `${s.fileName}${s.pageCount ? ` · ${s.pageCount} pages` : ''}` : 'No document added yet'}</small><div className="recent-card-bottom"><span>{s.messages.length} {s.messages.length === 1 ? 'message' : 'messages'}</span><ArrowRight size={15}/></div></button>)}</div> : <div className="empty-library"><div className="library-illustration"><FileText size={26}/><span/></div><b>Your library is ready when you are</b><p>Start with a paper, a report, or a book you’ve been meaning to understand.</p></div>}</div>}
    </main>
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e => { void uploadFiles([...e.target.files ?? []]); e.currentTarget.value = ''; }}/>

    {settingsOpen && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false); }}><section className="settings-modal"><header><div><div className="eyebrow muted">YOUR PREFERENCES</div><h2>Settings & privacy</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={18}/></button></header><div className="setting-section"><div className="setting-title"><div className="setting-icon green"><ShieldCheck size={18}/></div><div><b>Stored on this device</b><small>PDFs, conversations and extracted text use this browser’s IndexedDB.</small></div></div><div className="setting-row"><span>Run OCR on pages without selectable text</span><button className={`toggle ${ocr ? 'active' : ''}`} onClick={() => { const value = !ocr; setOcr(value); const next = { ...prefs, ocrEnabled: value }; setPrefs(next); void savePreferences(next); }} aria-label="Toggle OCR"><span/></button></div><p className="fine-print">OCR downloads its language data when first used. Scanned pages are processed in your browser. Current limits: 100 MB and {MAX_PDF_PAGES.toLocaleString()} pages per PDF.</p></div><div className="setting-divider"/><div className="setting-section"><div className="setting-title"><div className="setting-icon violet"><Gauge size={18}/></div><div><b>Local model</b><small>Runs on your device. The first download may be several hundred MB.</small></div></div><div className="setting-row"><span>Status</span><span className="model-status-text">{modelState === 'ready' && 'Ready'}{modelState === 'downloading' && (modelProgress.value > 0 ? `Downloading ${Math.round(modelProgress.value * 100)}%` : 'Downloading…')}{modelState === 'initializing' && 'Initializing…'}{modelState === 'failed' && <>Failed — <button className="inline-action" onClick={() => void loadModel(modelId)}>Retry</button></>}{modelState === 'not-loaded' && <>Not started — <button className="inline-action" onClick={() => void loadModel(modelId)}>Start</button></>}</span></div><div className="setting-row" style={{ marginTop: '8px' }}><label htmlFor="model">Model</label><select id="model" style={{ width: 'auto', flex: 1, marginLeft: '12px' }} value={modelId} onChange={e => { const value = e.target.value as ModelId; setModelId(value); setModelState('not-loaded'); setModelError(''); void modelManager.unload(); const next = { ...prefs, modelId: value }; setPrefs(next); void savePreferences(next); void loadModel(value); }} disabled={modelState === 'downloading' || modelState === 'initializing'}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label} · {m.size}</option>)}</select></div>{(modelState === 'downloading' || modelState === 'initializing') && <div className="progress-track model-progress" role="progressbar" aria-valuenow={Math.round(modelProgress.value * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.round(modelProgress.value * 100)}%` }}/></div>}{modelError && <p className="error-note">{modelError}</p>}</div><div className="setting-divider"/><div className="setting-section"><div className="setting-title"><div className="setting-icon amber"><Sparkles size={18}/></div><div><b>Online privacy</b><small>Online mode sends your question and selected PDF excerpts only after you allow it.</small></div></div><div className="consent-box"><div><b>Allow online AI providers</b><small>Relevant content may be processed by the configured provider. You can revoke consent at any time.</small></div><button className={`toggle ${onlineConsent ? 'active' : ''}`} onClick={() => setConsent(!onlineConsent)} aria-label="Allow online AI providers"><span/></button></div></div><footer><button className="text-button" onClick={() => { localStorage.removeItem('folio-name'); setDisplayName(''); setActive(null); const next = { ...prefs, displayName: '', selectedSessionId: undefined }; setPrefs(next); void savePreferences(next); setSettingsOpen(false); }}>Change display name</button><button className="primary-button" onClick={() => setSettingsOpen(false)}>Done</button><button className="text-button" onClick={() => void clearAllData()}>Clear all local data</button></footer></section></div>}
    {toast && <div className="toast"><Check size={15}/>{toast}</div>}
  </div>;
}

function Logo() { return <div className="brand"><div className="brand-mark">f</div><span>folio<span className="brand-dot">.</span></span></div>; }

function DocumentPicker({ documents, selected, onToggle, onRemove, onAdd }: { documents: DocumentRef[]; selected: string[]; onToggle: (id: string) => void; onRemove: (id: string) => void; onAdd: () => void }) {
  if (!documents.length) return null;
  return <section className="document-picker" aria-label="Selected PDFs">
    <div className="document-picker-head"><b>PDF library</b><button className="text-button" onClick={onAdd}><Plus size={13}/> Add PDFs</button></div>
    <div className="document-picker-list">{documents.map(doc => <div className={`document-picker-row ${selected.includes(doc.id) ? 'selected' : ''}`} key={doc.id}>
      <label><input type="checkbox" checked={selected.includes(doc.id)} onChange={() => onToggle(doc.id)} disabled={!['ready', 'partial'].includes(doc.status)}/><FileText size={14}/><span><b>{doc.fileName}</b><small>{doc.pageCount ? `${doc.pageCount} pages` : 'Processing'} · {doc.status}</small></span></label>
      <button className="icon-button subtle" onClick={() => onRemove(doc.id)} aria-label={`Remove ${doc.fileName}`}><X size={14}/></button>
    </div>)}</div>
    <small className="document-picker-note">Selected PDFs are searched together for the next question.</small>
  </section>;
}
