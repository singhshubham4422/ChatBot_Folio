import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { answerOnline, getProviderConfig, onlineAvailability, resetProviderCooldowns } from './onlineProvider';

const input = { question: 'What happened?', consent: true, mode: 'online', context: ['Earlier detail'], evidence: [{ page: 1, text: 'A verified passage.' }] };
const groqAnswer = { choices: [{ message: { content: 'Groq answer [p. 1]' } }] };
const geminiAnswer = { candidates: [{ content: { parts: [{ text: 'Online answer [p. 1]' }] } }] };
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status }); }
beforeEach(() => resetProviderCooldowns());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); resetProviderCooldowns(); });

describe('server-side online providers', () => {
  it('reads the exact server environment variable names and reports generic availability', () => {
    const config = getProviderConfig({ Groq_Api: 'groq-secret', Gemini_Api: 'gemini-secret' });
    expect(config.groqKey).toBe('groq-secret'); expect(config.geminiKey).toBe('gemini-secret');
    expect(onlineAvailability(config)).toBe('Available');
    expect(onlineAvailability(getProviderConfig({ Groq_Api: 'key' }))).toBe('Partially available');
    expect(onlineAvailability(getProviderConfig({}))).toBe('Unavailable');
  });
  it('uses Groq as the deterministic primary provider', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(groqAnswer));
    await expect(answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, fetcher)).resolves.toEqual({ answer: 'Groq answer [p. 1]' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions');
  });
  it('supports Gemini as the primary when it is the only configured provider', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(geminiAnswer));
    await expect(answerOnline(input, { geminiKey: 'm' }, fetcher)).resolves.toEqual({ answer: 'Online answer [p. 1]' });
    expect(String(fetcher.mock.calls[0][0])).toContain('/v1beta/models/gemini-3.8-flash:generateContent');
  });
  it('fails over from Groq to Gemini once on rate limits', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response(geminiAnswer));
    await expect(answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, fetcher)).resolves.toEqual({ answer: 'Online answer [p. 1]' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fails over from Gemini to Groq when the Gemini server fails', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(groqAnswer));
    await expect(answerOnline(input, { groqKey: 'g', geminiKey: 'm', primaryProvider: 'gemini' }, fetcher)).resolves.toEqual({ answer: 'Groq answer [p. 1]' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('fails over after a bounded network timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('api.groq.com')) return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
      return Promise.resolve(response(geminiAnswer));
    });
    const pending = answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, fetcher);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(pending).resolves.toEqual({ answer: 'Online answer [p. 1]' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('skips a provider during its cooldown on the next request', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response(geminiAnswer)).mockResolvedValueOnce(response(geminiAnswer));
    await answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, fetcher);
    await answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[2][0])).toContain('generativelanguage.googleapis.com');
  });
  it('reports unavailable providers and missing or rejected credentials safely', async () => {
    await expect(answerOnline(input, {}, vi.fn())).rejects.toMatchObject({ code: 'providers_unavailable' });
    const fetcher = vi.fn().mockResolvedValue(response({}, 401));
    await expect(answerOnline(input, { groqKey: 'invalid', geminiKey: 'other' }, fetcher)).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not retry an unsupported model and returns safe status for both provider failures', async () => {
    const invalidModel = vi.fn().mockResolvedValue(response({}, 404));
    await expect(answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, invalidModel)).rejects.toMatchObject({ code: 'invalid_model' });
    expect(invalidModel).toHaveBeenCalledTimes(1);
    const bothFail = vi.fn().mockResolvedValue(response({}, 503));
    await expect(answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, bothFail)).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(bothFail).toHaveBeenCalledTimes(2);
  });
  it('enforces server-side consent and local-only mode before making requests', async () => {
    const fetcher = vi.fn();
    await expect(answerOnline({ ...input, consent: false }, { groqKey: 'g' }, fetcher)).rejects.toMatchObject({ code: 'consent_required' });
    await expect(answerOnline({ ...input, mode: 'local' }, { groqKey: 'g' }, fetcher)).rejects.toMatchObject({ code: 'local_only' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('applies a short cooldown to a rate-limited provider and still permits bounded failover', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response(geminiAnswer));
    await answerOnline(input, { groqKey: 'g', geminiKey: 'm' }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not return or log secret values when providers fail', async () => {
    const secret = 'do-not-leak-secret';
    const fetcher = vi.fn().mockResolvedValue(response({ error: { message: secret } }, 401));
    let failure: unknown;
    try { await answerOnline(input, { groqKey: secret }, fetcher); } catch (error) { failure = error; }
    expect((failure as Error).message).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });
  it('handles server requests safely without returning secrets or credentials', async () => {
    const { handleOnline } = await import('./online');
    const { statusPayload } = await import('./online-status');
    const status = statusPayload({ Groq_Api: 'super-secret-groq', Gemini_Api: 'super-secret-gemini' });
    expect(status.availability).toBe('Available');
    expect(JSON.stringify(status)).not.toContain('super-secret');

    const result = await handleOnline({ ...input, consent: false }, { Groq_Api: 'secret-key' });
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: {
        code: 'consent_required',
        message: 'Enable online AI providers in Settings before sending this request.',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });
});
