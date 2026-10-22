import { describe, expect, it } from 'vitest';
import { shouldAutoLoadModel } from './modelLoading';

describe('automatic local model loading preference', () => {
  it('loads in the background after Folio opens when enabled', () => {
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: 'Reader', enabled: true, state: 'not-loaded' })).toBe(true);
  });
  it('does not load when disabled or before the library opens', () => {
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: 'Reader', enabled: false, state: 'not-loaded' })).toBe(false);
    expect(shouldAutoLoadModel({ appLoaded: false, displayName: 'Reader', enabled: true, state: 'not-loaded' })).toBe(false);
  });
  it('does not launch duplicate automatic loads after loading starts or when failed', () => {
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: 'Reader', enabled: true, state: 'downloading' })).toBe(false);
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: 'Reader', enabled: true, state: 'initializing' })).toBe(false);
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: 'Reader', enabled: true, state: 'ready' })).toBe(false);
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: 'Reader', enabled: true, state: 'failed' })).toBe(false);
  });
  it('does not load when displayName is blank or whitespace', () => {
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: '   ', enabled: true, state: 'not-loaded' })).toBe(false);
    expect(shouldAutoLoadModel({ appLoaded: true, displayName: '', enabled: true, state: 'not-loaded' })).toBe(false);
  });
});
