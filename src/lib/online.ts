import type { Chunk } from '../types';

export class OnlineRequestError extends Error { constructor(message: string, readonly code: string) { super(message); } }
let unavailableUntil = 0;
export function onlineCooldownActive() { return Date.now() < unavailableUntil; }

export async function getOnlineStatus(): Promise<'Available' | 'Partially available' | 'Unavailable'> {
  const response = await fetch('/api/online/status', { cache: 'no-store' });
  if (!response.ok) return 'Unavailable';
  const payload = await response.json() as { availability?: string };
  return payload.availability === 'Available' || payload.availability === 'Partially available' ? payload.availability : 'Unavailable';
}

export async function askOnline(question: string, evidence: Chunk[], consent: boolean, mode: 'online' | 'offline' | 'local' | 'automatic', context: string[] = [], signal?: AbortSignal): Promise<string> {
  if (!consent) throw new OnlineRequestError('Enable online AI providers before sharing document excerpts.', 'consent_required');
  if (mode === 'offline' || mode === 'local') throw new OnlineRequestError('Offline (local-only) mode cannot contact an online provider.', 'local_only');
  const response = await fetch('/api/online', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ question, consent, mode, context: context.slice(-6).map(item => item.slice(0, 500)), evidence: evidence.map(c => ({ page: c.page, text: c.text })) }),
  });
  const payload = await response.json() as { answer?: string; error?: { code?: string; message?: string } };
  if (!response.ok) {
    const code = payload.error?.code ?? 'provider_failure';
    const message = payload.error?.message ?? 'Online providers could not complete this request.';
    if (['provider_rate_limited', 'provider_timeout', 'provider_unavailable', 'provider_failure'].includes(code)) unavailableUntil = Date.now() + 30_000;
    throw new OnlineRequestError(message, code);
  }
  return payload.answer ?? 'No answer returned.';
}
