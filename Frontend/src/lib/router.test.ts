import { describe, expect, it } from 'vitest';
import { routeQuestion } from './router';

describe('question routing', () => {
  it('prefers deterministic facts in every mode', () => {
    for (const mode of ['online', 'offline'] as const) {
      expect(routeQuestion({ mode, deterministic: true, consent: false, modelReady: false, onlineAvailable: false })).toBe('deterministic');
    }
  });
  it('routes offline mode strictly to local model without contacting online providers', () => {
    expect(routeQuestion({ mode: 'offline', deterministic: false, consent: true, modelReady: true, onlineAvailable: true })).toBe('local');
    expect(routeQuestion({ mode: 'offline', deterministic: false, consent: true, modelReady: false, onlineAvailable: true })).toBe('model_required');
    expect(routeQuestion({ mode: 'offline', deterministic: false, consent: false, modelReady: true, onlineAvailable: false })).toBe('local');
  });
  it('requires consent and provider availability for online mode', () => {
    expect(routeQuestion({ mode: 'online', deterministic: false, consent: false, modelReady: true, onlineAvailable: true })).toBe('ask_consent');
    expect(routeQuestion({ mode: 'online', deterministic: false, consent: true, modelReady: true, onlineAvailable: false })).toBe('provider_cooldown');
    expect(routeQuestion({ mode: 'online', deterministic: false, consent: true, modelReady: false, onlineAvailable: true })).toBe('online');
  });
  it('never silently switches online mode to local model even when local model is ready', () => {
    expect(routeQuestion({ mode: 'online', deterministic: false, consent: false, modelReady: true, onlineAvailable: false })).toBe('ask_consent');
    expect(routeQuestion({ mode: 'online', deterministic: false, consent: true, modelReady: true, onlineAvailable: false })).toBe('provider_cooldown');
  });
});
