import { existsSync, readFileSync } from 'node:fs';

/** Parses KEY=VALUE lines (quotes and # comments supported). Never throws on malformed lines. */
export function parseDotEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1] ?? '';
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    if (value !== '') values[key] = value;
  }
  return values;
}

/** Loads the first existing file; later files do not override earlier ones. */
export function loadDotEnvFiles(paths: readonly string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      for (const [key, value] of Object.entries(parseDotEnv(readFileSync(path, 'utf8')))) {
        if (!(key in merged)) merged[key] = value;
      }
    } catch {
      // Unreadable .env files are ignored: they are optional configuration.
    }
  }
  return merged;
}

export interface AzureEnv {
  speechKey?: string;
  speechRegion?: string;
  openAiEndpoint?: string;
  openAiKey?: string;
  openAiDeployment?: string;
  openAiApiVersion?: string;
}

/** Azure defaults from environment variables / .env (settings entered in the UI take precedence). */
export function readAzureEnv(env: Record<string, string | undefined>): AzureEnv {
  const pick = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };
  const result: AzureEnv = {};
  const entries: Array<[keyof AzureEnv, string]> = [
    ['speechKey', 'AZURE_SPEECH_KEY'],
    ['speechRegion', 'AZURE_SPEECH_REGION'],
    ['openAiEndpoint', 'AZURE_OPENAI_ENDPOINT'],
    ['openAiKey', 'AZURE_OPENAI_KEY'],
    ['openAiDeployment', 'AZURE_OPENAI_DEPLOYMENT'],
    ['openAiApiVersion', 'AZURE_OPENAI_API_VERSION'],
  ];
  for (const [field, name] of entries) {
    const value = pick(name);
    if (value) result[field] = value;
  }
  return result;
}
