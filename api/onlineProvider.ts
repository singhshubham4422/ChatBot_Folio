import { validateOnlineInput } from '../src/lib/quota.js';

export type OnlineProvider = 'groq' | 'gemini';
export type ProviderConfig = { groqKey?: string; geminiKey?: string; groqModel?: string; geminiModel?: string; primaryProvider?: OnlineProvider };
export type ProviderFailureCode = 'provider_rate_limited' | 'provider_unavailable' | 'provider_timeout' | 'invalid_credentials' | 'invalid_model' | 'provider_failure';
export class ProviderFailure extends Error {
  constructor(readonly code: ProviderFailureCode, readonly retryable: boolean) { super(code); }
}

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 12_000;
const COOLDOWN_MS = 30_000;
const cooldowns = new Map<OnlineProvider, number>();
export function resetProviderCooldowns() { cooldowns.clear(); }

export function getProviderConfig(env: Record<string, string | undefined>): ProviderConfig {
  return {
    groqKey: env.Groq_Api?.trim() || undefined,
    geminiKey: env.Gemini_Api?.trim() || undefined,
    groqModel: env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    geminiModel: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
    primaryProvider: env.ONLINE_PRIMARY_PROVIDER?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'groq',
  };
}

export function onlineAvailability(config: ProviderConfig) {
  const count = Number(Boolean(config.groqKey)) + Number(Boolean(config.geminiKey));
  return count === 2 ? 'Available' : count === 1 ? 'Partially available' : 'Unavailable';
}

export function providerCooldownActive(provider: OnlineProvider, now = Date.now()) {
  return (cooldowns.get(provider) ?? 0) > now;
}

function markCooldown(provider: OnlineProvider) { cooldowns.set(provider, Date.now() + COOLDOWN_MS); }

function classifyFailure(status: number): ProviderFailure {
  if (status === 401 || status === 403) return new ProviderFailure('invalid_credentials', false);
  if (status === 404 || status === 400) return new ProviderFailure('invalid_model', false);
  if (status === 429) return new ProviderFailure('provider_rate_limited', true);
  if (status >= 500) return new ProviderFailure('provider_unavailable', true);
  return new ProviderFailure('provider_failure', false);
}

function prompt(question: string, evidence: { page: number; text: string; fileName?: string }[], context: string[]) {
  return `Use recent conversation only to resolve references. The PDF excerpts are the sole authority for facts. If they do not support an answer, say so. Cite every substantive claim like [filename, p. 2]. Keep the answer concise.\n\nRecent conversation:\n${context.join('\n')}\n\nQuestion: ${question}\n\nPDF excerpts:\n${evidence.map(item => `[${item.fileName ?? 'Document'}, page ${item.page}] ${item.text}`).join('\n\n')}`;
}

async function callProvider(provider: OnlineProvider, config: ProviderConfig, question: string, evidence: { page: number; text: string }[], context: string[], fetcher: typeof fetch): Promise<string> {
  if (providerCooldownActive(provider)) throw new ProviderFailure('provider_rate_limited', true);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const content = prompt(question, evidence, context);
    let response: Response;
    try {
      if (provider === 'groq') {
        response = await fetcher('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (config.groqKey ?? '') }, signal: controller.signal,
          body: JSON.stringify({ model: config.groqModel || DEFAULT_GROQ_MODEL, temperature: 0.15, max_tokens: 700, messages: [{ role: 'user', content }] }),
        });
      } else {
        response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel || DEFAULT_GEMINI_MODEL)}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey ?? '' }, signal: controller.signal,
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: content }] }], generationConfig: { temperature: 0.15, maxOutputTokens: 700 } }),
        });
      }
    } catch {
      markCooldown(provider);
      throw new ProviderFailure(controller.signal.aborted ? 'provider_timeout' : 'provider_unavailable', true);
    }
    if (!response.ok) {
      const failure = classifyFailure(response.status);
      if (failure.retryable) markCooldown(provider);
      throw failure;
    }
    let answer = '';
    try {
      const payload = await response.json() as { choices?: { message?: { content?: string } }[]; candidates?: { content?: { parts?: { text?: string }[] } }[] };
      answer = provider === 'groq'
        ? payload.choices?.[0]?.message?.content ?? ''
        : payload.candidates?.[0]?.content?.parts?.map(part => part.text ?? '').join('') ?? '';
    } catch { throw new ProviderFailure('provider_failure', false); }
    if (!answer.trim()) throw new ProviderFailure('provider_failure', false);
    return answer.trim();
  } finally { clearTimeout(timer); }
}

export async function answerOnline(input: unknown, config: ProviderConfig, fetcher: typeof fetch = fetch): Promise<{ answer: string }> {
  if (!input || typeof input !== 'object') throw new RequestFailure(400, 'invalid_request');
  const body = input as Record<string, unknown>;
  if (body.consent !== true) throw new RequestFailure(403, 'consent_required');
  if (body.mode === 'local' || body.mode === 'offline') throw new RequestFailure(403, 'local_only');
  const question = body.question;
  const evidence = body.evidence;
  const context = body.context;
  if (!validateOnlineInput({ question, evidence, context })) throw new RequestFailure(400, 'invalid_request');
  const totalChars = JSON.stringify(body).length;
  if (totalChars > 24_000) throw new RequestFailure(413, 'payload_too_large');
  const order: OnlineProvider[] = config.primaryProvider === 'gemini' ? ['gemini', 'groq'] : ['groq', 'gemini'];
  const keys = order.filter(provider => provider === 'groq' ? config.groqKey : config.geminiKey);
  if (!keys.length) throw new RequestFailure(503, 'providers_unavailable');
  let lastFailure: ProviderFailure | undefined;
  for (const provider of keys) {
    try { return { answer: await callProvider(provider, config, question as string, evidence as { page: number; text: string; fileName?: string }[], context as string[], fetcher) }; }
    catch (error) {
      if (!(error instanceof ProviderFailure)) throw new RequestFailure(502, 'provider_failure');
      lastFailure = error;
      if (!error.retryable) break;
    }
  }
  throw new RequestFailure(lastFailure?.code === 'invalid_credentials' ? 503 : lastFailure?.code === 'invalid_model' ? 503 : 502, lastFailure?.code ?? 'provider_failure');
}

export class RequestFailure extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
