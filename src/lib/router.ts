export type AnswerMode = 'online' | 'offline';
export type Route = 'deterministic' | 'local' | 'online' | 'evidence' | 'ask_consent' | 'model_required' | 'provider_cooldown';
export function routeQuestion(input: { mode: AnswerMode; deterministic: boolean; consent: boolean; modelReady: boolean; onlineAvailable: boolean }): Route {
  if (input.deterministic) return 'deterministic';
  if (input.mode === 'offline') {
    return input.modelReady ? 'local' : 'model_required';
  }
  if (!input.consent) return 'ask_consent';
  if (!input.onlineAvailable) return 'provider_cooldown';
  return 'online';
}
