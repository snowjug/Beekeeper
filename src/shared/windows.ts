/** Every BrowserWindow Beekeeper creates has exactly one role. */
export const WINDOW_ROLES = [
  'assistant',
  'circle',
  'edgeGlow',
  'settings',
  'onboarding',
  'worker',
  'studio',
  'pin',
  'dictation',
] as const;

export type WindowRole = (typeof WINDOW_ROLES)[number];

/** Directory under src/renderer (and out/renderer) that holds each role's page. */
export const ROLE_PAGE: Record<WindowRole, string> = {
  assistant: 'assistant',
  circle: 'circle',
  edgeGlow: 'edge-glow',
  settings: 'settings',
  onboarding: 'onboarding',
  worker: 'worker',
  studio: 'studio',
  pin: 'pin',
  dictation: 'dictation',
};

export function isWindowRole(value: unknown): value is WindowRole {
  return typeof value === 'string' && (WINDOW_ROLES as readonly string[]).includes(value);
}

/** Custom protocol that serves the bundled renderer pages and downloaded models. */
export const APP_SCHEME = 'beekeeper';
export const APP_ORIGIN = `${APP_SCHEME}://app`;

/** Assistant bar geometry in DIPs (spec 4.1: ~720px wide, rounded 28px). */
export const ASSISTANT_BAR_WIDTH = 720;
/** Transparent padding around the bar so shadows are not clipped. */
export const ASSISTANT_WINDOW_PADDING = 36;
export const ASSISTANT_MAX_HEIGHT = 780;
export const ASSISTANT_BOTTOM_MARGIN = 20;
