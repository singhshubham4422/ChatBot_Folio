export function shouldAutoLoadModel(input: { appLoaded: boolean; displayName?: string; enabled?: boolean; state: string }) {
  if (!input.appLoaded) return false;
  if (input.enabled === false) return false;
  if (input.displayName !== undefined && !input.displayName.trim()) return false;
  return input.state === 'not-loaded';
}
