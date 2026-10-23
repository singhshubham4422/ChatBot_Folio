import { describe, expect, it } from 'vitest';
import { normalizeVoiceTranscript, voiceErrorMessage } from './useVoiceInput';

describe('voice input helpers', () => {
  it('normalizes spoken BITS terms and years', () => {
    expect(normalizeVoiceTranscript('what is bit sat eligibility')).toBe('What is BITSAT eligibility');
    expect(normalizeVoiceTranscript('m e fees in twenty twenty six')).toBe('M.E. fees in 2026');
    expect(normalizeVoiceTranscript('m pharm')).toBe('M.Pharm');
  });

  it('maps recognition errors safely', () => {
    expect(voiceErrorMessage('not-allowed')).toMatch(/permission is blocked/i);
    expect(voiceErrorMessage('no-speech')).toMatch(/didn't hear/i);
    expect(voiceErrorMessage('network')).toMatch(/internet connection/i);
    expect(voiceErrorMessage('audio-capture')).toMatch(/microphone found/i);
    expect(voiceErrorMessage('other')).toMatch(/could not start/i);
  });
});
