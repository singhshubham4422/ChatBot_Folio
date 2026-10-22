import { answerOnline, getProviderConfig, RequestFailure } from './onlineProvider';

type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = { setHeader(name: string, value: string): void; status(code: number): VercelResponse; json(body: unknown): VercelResponse };

export async function handleOnline(body: unknown, env: Record<string, string | undefined> = process.env) {
  try { return { status: 200, body: await answerOnline(body, getProviderConfig(env)) }; }
  catch (error) {
    if (error instanceof RequestFailure) return { status: error.status, body: { error: { code: error.code, message: publicMessage(error.code) } } };
    return { status: 502, body: { error: { code: 'provider_failure', message: publicMessage('provider_failure') } } };
  }
}

export function publicMessage(code: string) {
  const messages: Record<string, string> = {
    consent_required: 'Enable online AI providers in Settings before sending this request.',
    local_only: 'Local-only mode cannot send requests to an online provider.',
    invalid_request: 'The question or selected excerpts could not be accepted.',
    payload_too_large: 'The selected excerpts are too large. Try a shorter question or fewer passages.',
    providers_unavailable: 'Online AI providers are not configured. Load a local model or check Settings later.',
    invalid_credentials: 'The configured online provider credentials were rejected. Check the server environment settings.',
    invalid_model: 'The configured online model is unavailable. Check the server model setting.',
    provider_rate_limited: 'Online providers are rate limited or out of quota. Try again later or use a local model.',
    provider_timeout: 'Online providers took too long to respond. You can retry or use a local model.',
    provider_unavailable: 'Online providers are temporarily unavailable. You can retry or use a local model.',
    provider_failure: 'Online providers could not complete this request. You can retry or use a local model.',
  };
  return messages[code] ?? messages.provider_failure;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  const result = await handleOnline(req.body);
  return res.status(result.status).json(result.body);
}
