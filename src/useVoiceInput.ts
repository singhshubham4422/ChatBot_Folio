import { useEffect, useRef, useState } from 'react';
import { CONFIG } from './engine/config';

export type VoiceState = 'unsupported' | 'idle' | 'listening' | 'processing' | 'error';
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

export function useVoiceInput(onFinal: (text: string) => void) {
  const recognitionRef = useRef<Recognition | null>(null);
  const timerRef = useRef<number>();
  const [state, setState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [language, setLanguageState] = useState(() => localStorage.getItem('smartbot-voice-language') ?? 'en-IN');
  const [autoSend, setAutoSendState] = useState(() => localStorage.getItem('smartbot-voice-auto-send') !== 'false');
  const editGeneration = useRef(0);
  const browserWindow = typeof window !== 'undefined' ? window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor } : undefined;
  const supported = Boolean(browserWindow?.SpeechRecognition || browserWindow?.webkitSpeechRecognition);

  useEffect(() => () => { window.clearTimeout(timerRef.current); recognitionRef.current?.abort(); }, []);

  function setLanguage(value: string) { setLanguageState(value); localStorage.setItem('smartbot-voice-language', value); }
  function setAutoSend(value: boolean) { setAutoSendState(value); localStorage.setItem('smartbot-voice-auto-send', String(value)); }
  function stop() { recognitionRef.current?.stop(); setState('processing'); }
  function notifyEdit() { editGeneration.current += 1; setTranscript(''); }
  function start() {
    if (!supported || state === 'listening') return;
    const Constructor = browserWindow?.SpeechRecognition || browserWindow?.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor() as Recognition;
    const startedGeneration = editGeneration.current;
    recognition.continuous = false; recognition.interimResults = true; recognition.maxAlternatives = 1; recognition.lang = language;
    recognition.onresult = event => {
      let interim = '';
      let final = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = event.results[index][0]?.transcript ?? '';
        if (event.results[index].isFinal) final += text; else interim += text;
      }
      setTranscript(normalizeVoiceTranscript(final || interim));
      if (final) {
        const value = normalizeVoiceTranscript(final);
        setState('processing');
        if (autoSend) { window.clearTimeout(timerRef.current); timerRef.current = window.setTimeout(() => { if (editGeneration.current === startedGeneration) onFinal(value); }, 800); }
        else onFinal(value);
      }
    };
    recognition.onerror = event => { setError(voiceErrorMessage(event.error)); setState('error'); };
    recognition.onend = () => setState(current => current === 'error' ? current : 'idle');
    recognitionRef.current = recognition; setError(''); setTranscript(''); setState('listening');
    try { recognition.start(); } catch { setError('Voice recognition could not start. Try again.'); setState('error'); }
  }
  return { supported, state: supported ? state : 'unsupported' as const, transcript, error, language, setLanguage, autoSend, setAutoSend, start, stop, notifyEdit };
}
