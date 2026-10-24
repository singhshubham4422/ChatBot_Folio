import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads the same optional .env convention used by the Vite config, without logging values. */
export function loadLocalEnv(file = resolve(process.cwd(), '.env')): void {
  try {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, '').trim();
      process.env[match[1]] = value;
    }
  } catch {
    // Local .env is optional. Missing keys are reported as unconfigured by the caller.
  }
}
