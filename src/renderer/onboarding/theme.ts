export type Theme = 'light' | 'dark';

/** The OS colour scheme as Chromium reports it (Electron follows nativeTheme). */
export function systemTheme(): Theme {
  if (typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The design tokens switch on `data-theme` of the root element. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
}
