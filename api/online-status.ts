import { getProviderConfig, onlineAvailability } from './onlineProvider';

type VercelRequest = { method?: string };
type VercelResponse = { setHeader(name: string, value: string): void; status(code: number): VercelResponse; json(body: unknown): VercelResponse };

export function statusPayload(env: Record<string, string | undefined> = process.env) {
  const availability = onlineAvailability(getProviderConfig(env));
  return { availability, message: availability === 'Unavailable' ? 'Neither online provider is configured.' : 'Configured providers are checked when a request is made.' };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
  return res.status(200).json(statusPayload());
}
