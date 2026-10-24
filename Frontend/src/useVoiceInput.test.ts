import { describe, expect, it } from 'vitest';
import { INITIAL_VOICE_STATE, normalizeVoiceTranscript, voiceErrorMessage, voiceStatusMessage } from './useVoiceInput';

describe('voice input helpers', () => {
  it('starts idle and only labels active voice phases', () => {
    expect(INITIAL_VOICE_STATE).toBe('idle');
    expect(voiceStatusMessage('idle')).toBe('');
    expect(voiceStatusMessage('listening')).toBe('Listening...');
    expect(voiceStatusMessage('processing')).toBe('Processing voice input...');
  });
  it('normalizes spoken BITS terms and years', () => {
    expect(normalizeVoiceTranscript('what is bit sat eligibility')).toBe('What is BITSAT eligibility');
    expect(normalizeVoiceTranscript('m e fees in twenty twenty six')).toBe('M.E. fees in 2026');
    expect(normalizeVoiceTranscript('m pharm')).toBe('M.Pharm');
    expect(normalizeVoiceTranscript('tell me about bits pilani first degree')).toBe('Tell me about BITS Pilani First Degree');
    expect(normalizeVoiceTranscript('higher degree in twenty twenty five')).toBe('Higher Degree in 2025');
  });

  it('maps recognition errors safely', () => {
    expect(voiceErrorMessage('not-allowed')).toMatch(/permission is blocked/i);
    expect(voiceErrorMessage('no-speech')).toMatch(/didn't hear/i);
    expect(voiceErrorMessage('network')).toMatch(/internet connection/i);
    expect(voiceErrorMessage('audio-capture')).toMatch(/microphone found/i);
    expect(voiceErrorMessage('other')).toMatch(/could not start/i);
  });
});
