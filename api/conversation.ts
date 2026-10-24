import { answerOnline, getProviderConfig, RequestFailure } from './onlineProvider.js';

type Req = { method?: string; body?: unknown; headers?: Record<string, string | string[] | undefined> };
type Res = { setHeader(name: string, value: string): void; status(code: number): Res; json(body: unknown): Res; write(chunk: string): void; end(): void };
const ipWindows = new Map<string, { start: number; count: number }>();
const WINDOW_MS = 60_000;
const MAX_PER_IP = 20;

function originAllowed(req: Req) {
  const origin = req.headers?.origin;
  const value = String(origin ?? '');
  return !origin || value.includes('chat-bot-folio.vercel.app') || (value.startsWith('https://') && value.endsWith('.vercel.app')) || value.startsWith('http://localhost:') || value.startsWith('http://127.0.0.1:');
}

function sse(res: Res, event: string, data: unknown) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Vary', 'Origin');
  if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  if (!originAllowed(req)) return res.status(403).json({ error: { code: 'origin_not_allowed', message: 'Request origin not allowed.' } });
  const ip = String(req.headers?.['x-forwarded-for'] ?? 'unknown').split(',')[0].trim();
  const now = Date.now(); const current = ipWindows.get(ip);
  if (!current || now - current.start > WINDOW_MS) ipWindows.set(ip, { start: now, count: 1 });
  else if (++current.count > MAX_PER_IP) return res.status(429).json({ error: { code: 'rate_limited', message: 'Please try again shortly.' } });
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, 300) : '';
  const history = Array.isArray(body.history) ? body.history.filter(item => typeof item === 'string').slice(-4).map(item => String(item).slice(0, 500)) : [];
  const passages = Array.isArray(body.passages) ? body.passages.slice(0, 6).map((item, index) => {
    const p = item as Record<string, unknown>;
    const table = typeof p.table === 'string' ? `\nTable:\n${p.table}` : '';
    return { page: Number.isInteger(p.page) ? Number(p.page) : 1, text: `${String(p.section ?? '')}\n${String(p.text ?? '')}${table}`, fileName: String(p.file ?? 'Document') };
  }) : [];
  if (!question || !passages.length || JSON.stringify({ question, history, passages }).length > 24_000) return res.status(400).json({ error: { code: 'invalid_request', message: 'The question or evidence could not be accepted.' } });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Connection', 'keep-alive');
  try {
    const started = Date.now();
    const result = await answerOnline({ question, context: history, evidence: passages, consent: true, mode: 'online' }, getProviderConfig(process.env));
    console.info('[smart-bot-conversation]', JSON.stringify({ status: 'generated', latencyMs: Date.now() - started, evidenceCount: passages.length }));
    const words = result.answer.split(/(\s+)/);
    sse(res, 'start', {});
    for (const word of words) sse(res, 'token', word);
    sse(res, 'done', { provider: 'online' });
  } catch (error) {
    const code = error instanceof RequestFailure ? error.code : 'provider_failure';
    console.info('[smart-bot-conversation]', JSON.stringify({ status: 'failed', code, evidenceCount: passages.length }));
    sse(res, 'error', { code });
  }
  res.end();
}
