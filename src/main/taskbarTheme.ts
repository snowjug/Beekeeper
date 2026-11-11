/** Parses `reg query ... /v SystemUsesLightTheme` output. Pure so it can be unit tested. */
export function parseTaskbarTheme(regOutput: string): 'light' | 'dark' {
  const match = /SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(regOutput);
  if (!match?.[1]) return 'dark';
  return Number.parseInt(match[1], 16) === 0 ? 'dark' : 'light';
}

export const TASKBAR_THEME_QUERY_ARGS = [
  'query',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
  '/v',
  'SystemUsesLightTheme',
] as const;
