import { useEffect, useRef, useState } from 'react';
import { CONFIG } from './engine/config';

export type VoiceState = 'unsupported' | 'idle' | 'listening' | 'processing' | 'error';
export const INITIAL_VOICE_STATE: VoiceState = 'idle';

export function voiceStatusMessage(state: VoiceState): string {
  if (state === 'listening') return 'Listening...';
  if (state === 'processing') return 'Processing voice input...';
  return '';
}

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = Event & { resultIndex: number; results: { length: number; [index: number]: SpeechResult } };
type Recognition = {
  continuous: boolean; interimResults: boolean; maxAlternatives: number; lang: string;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: SpeechEvent) => void) | null; onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => Recognition;

export function normalizeVoiceTranscript(value: string): string {
  let normalized = value.replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of CONFIG.VOICE_NORMALIZATION) normalized = normalized.replace(pattern, replacement);
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : normalized;
}

export function voiceErrorMessage(code: string): string {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone permission is blocked. Allow it in the browser’s site settings.';
  if (code === 'no-speech') return "I didn't hear anything, try again.";
  if (code === 'network') return 'Voice recognition needs an internet connection.';
  if (code === 'audio-capture') return 'No microphone found.';
  return 'Voice recognition could not start. Try again.';
}

export interface UseVoiceInputOptions {
  onInterim?: (text: string) => void;
}

export function useVoiceInput(
  onFinal: (text: string) => void | Promise<void>,
  options?: UseVoiceInputOptions
) {
  const recognitionRef = useRef<Recognition | null>(null);
  const timerRef = useRef<number>();
  const runRef = useRef(0);
  const phaseRef = useRef<VoiceState>('idle');
  const mountedRef = useRef(true);
  const lastTranscriptRef = useRef('');
  const isProcessingRef = useRef(false);

  const [state, setState] = useState<VoiceState>(INITIAL_VOICE_STATE);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [language, setLanguageState] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('smartbot-voice-language') ?? 'en-IN';
    }
    return 'en-IN';
  });
  const [autoSend, setAutoSendState] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('smartbot-voice-auto-send') !== 'false';
    }
    return true;
  });

  const browserWindow = typeof window !== 'undefined'
    ? (window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor })
    : undefined;
  const supported = Boolean(browserWindow?.SpeechRecognition || browserWindow?.webkitSpeechRecognition);

  useEffect(() => () => {
    mountedRef.current = false;
    runRef.current += 1;
    window.clearTimeout(timerRef.current);
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
  }, []);

  function setLanguage(value: string) {
    setLanguageState(value);
    try { localStorage.setItem('smartbot-voice-language', value); } catch { /* ignore */ }
    if (phaseRef.current === 'listening' && recognitionRef.current) {
      recognitionRef.current.lang = value;
    }
  }

  function setAutoSend(value: boolean) {
    setAutoSendState(value);
    try { localStorage.setItem('smartbot-voice-auto-send', String(value)); } catch { /* ignore */ }
  }

  function commitAndProcess(finalText: string, currentRun: number) {
    if (!mountedRef.current || currentRun !== runRef.current || isProcessingRef.current) return;
    const value = normalizeVoiceTranscript(finalText);
    if (!value) {
      phaseRef.current = 'idle';
      setState('idle');
      return;
    }
    isProcessingRef.current = true;
    window.clearTimeout(timerRef.current);
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;
    phaseRef.current = 'processing';
    setState('processing');

    Promise.resolve(onFinal(value)).finally(() => {
      if (mountedRef.current && currentRun === runRef.current) {
        phaseRef.current = 'idle';
        setState('idle');
        setTranscript('');
        lastTranscriptRef.current = '';
        isProcessingRef.current = false;
      }
    });
  }

  function stop() {
    window.clearTimeout(timerRef.current);
    const run = runRef.current;
    const recognizedText = (lastTranscriptRef.current || transcript).trim();
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;

    if (recognizedText) {
      if (autoSend) {
        commitAndProcess(recognizedText, run);
      } else {
        options?.onInterim?.(normalizeVoiceTranscript(recognizedText));
        phaseRef.current = 'idle';
        setState('idle');
        setTranscript('');
        lastTranscriptRef.current = '';
      }
    } else {
      phaseRef.current = 'idle';
      setState('idle');
      setTranscript('');
      lastTranscriptRef.current = '';
    }
  }

  function notifyEdit() {
    runRef.current += 1;
    window.clearTimeout(timerRef.current);
    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    recognitionRef.current = null;
    isProcessingRef.current = false;
    lastTranscriptRef.current = '';
    phaseRef.current = 'idle';
    if (mountedRef.current) {
      setTranscript('');
      setState('idle');
    }
  }

  function start() {
    if (!supported || state === 'listening' || state === 'processing') return;
    const Constructor = browserWindow?.SpeechRecognition || browserWindow?.webkitSpeechRecognition;
    if (!Constructor) return;

    try { recognitionRef.current?.abort(); } catch { /* ignore */ }
    window.clearTimeout(timerRef.current);

    const run = ++runRef.current;
    const recognition = new Constructor() as Recognition;
    recognitionRef.current = recognition;
    isProcessingRef.current = false;
    lastTranscriptRef.current = '';
    setError('');
    setTranscript('');
    phaseRef.current = 'listening';
    setState('listening');

    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = language;

    recognition.onresult = event => {
      if (!mountedRef.current || run !== runRef.current || isProcessingRef.current) return;

      const finalParts: string[] = [];
      const interimParts: string[] = [];

      for (let i = 0; i < event.results.length; i++) {
        const item = event.results[i];
        const text = item[0]?.transcript?.trim() ?? '';
        if (!text) continue;
        if (item.isFinal) {
          finalParts.push(text);
        } else {
          interimParts.push(text);
        }
      }

      const combined = [...finalParts, ...interimParts].join(' ').trim();
      if (!combined) return;

      const normalized = normalizeVoiceTranscript(combined);
      setTranscript(normalized);
      lastTranscriptRef.current = normalized;
      options?.onInterim?.(normalized);

      window.clearTimeout(timerRef.current);
      if (autoSend && finalParts.length > 0) {
        timerRef.current = window.setTimeout(() => {
          if (!mountedRef.current || run !== runRef.current || isProcessingRef.current) return;
          commitAndProcess(normalized, run);
        }, 1300);
      }
    };

    recognition.onerror = event => {
      if (!mountedRef.current || run !== runRef.current || isProcessingRef.current) return;
      window.clearTimeout(timerRef.current);

      const captured = (lastTranscriptRef.current || transcript).trim();
      if (event.error === 'no-speech') {
        if (captured) {
          if (autoSend) {
            commitAndProcess(captured, run);
          } else {
            options?.onInterim?.(normalizeVoiceTranscript(captured));
            phaseRef.current = 'idle';
            setState('idle');
          }
          return;
        }
        phaseRef.current = 'idle';
        setError("I didn't hear anything, try again.");
        setState('idle');
        return;
      }

      if (event.error === 'aborted') {
        phaseRef.current = 'idle';
        setState('idle');
        return;
      }

      phaseRef.current = 'idle';
      setError(voiceErrorMessage(event.error));
      setState('idle');
    };

    recognition.onend = () => {
      if (!mountedRef.current || run !== runRef.current || isProcessingRef.current) return;
      const captured = (lastTranscriptRef.current || transcript).trim();
      if (captured) {
        if (autoSend) {
          commitAndProcess(captured, run);
        } else {
          options?.onInterim?.(normalizeVoiceTranscript(captured));
          phaseRef.current = 'idle';
          setState('idle');
        }
      } else {
        phaseRef.current = 'idle';
        setState('idle');
      }
    };

    try {
      recognition.start();
    } catch {
      phaseRef.current = 'idle';
      setError('Voice recognition could not start. Try again.');
      setState('idle');
    }
  }

  return {
    supported,
    state: supported ? state : ('unsupported' as const),
    transcript,
    error,
    language,
    setLanguage,
    autoSend,
    setAutoSend,
    start,
    stop,
    notifyEdit,
  };
}
