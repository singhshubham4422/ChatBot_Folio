import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOnline } from './online';
import type { Chunk } from '../types';

const evidence: Chunk[] = [{ id: 'p1', page: 1, text: 'A verified statement.', start: 0, end: 21, quality: 'good' }];
afterEach(() => vi.restoreAllMocks());

describe('online consent boundary', () => {
  it('checks consent before every online request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(askOnline('What happened?', evidence, false, 'online')).rejects.toThrow(/enable online/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('never contacts a provider in local-only mode', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(askOnline('What happened?', evidence, true, 'local')).rejects.toThrow(/local-only/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('sends only the question, recent context, selected evidence, and consent', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ answer: 'Verified. [p. 1]' }), { status: 200 }));
    await expect(askOnline('What happened?', evidence, true, 'automatic', ['recent'])).resolves.toBe('Verified. [p. 1]');
    const request = fetchSpy.mock.calls[0][1]; const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ question: 'What happened?', consent: true, context: ['recent'], evidence: [{ page: 1, text: 'A verified statement.' }] });
    expect(body).not.toHaveProperty('pdf');
  });
  it('protects secrets by keeping requests keyless from the client', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ answer: 'Clean.' }), { status: 200 }));
    await askOnline('Question', evidence, true, 'online');
    const init = fetchSpy.mock.calls[0][1];
    expect(init?.headers).not.toHaveProperty('Authorization');
    expect(init?.headers).not.toHaveProperty('x-goog-api-key');
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty('apiKey');
    expect(body).not.toHaveProperty('Groq_Api');
    expect(body).not.toHaveProperty('Gemini_Api');
  });
});
