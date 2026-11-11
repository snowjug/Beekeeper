/** Windows 11 system backdrop helpers (pure parsing; the BrowserWindow calls live in manager.ts). */
import type { WindowRole } from '@shared/windows';

/** "10.0.26100" -> 26100. Returns 0 when unknown (non-Windows or unparsable). */
export function parseWindowsBuild(release: string): number {
  const match = /^10\.0\.(\d+)/.exec(release);
  return match?.[1] ? Number(match[1]) : 0;
}

/** Mica / Acrylic need Windows 11 22H2 (build 22621) or newer. */
export const MIN_BACKDROP_BUILD = 22621;

export function supportsBackdrop(build: number): boolean {
  return build >= MIN_BACKDROP_BUILD;
}

export type BackdropMaterial = 'mica' | 'acrylic' | 'none';

/**
 * Settings and onboarding are framed windows and use Mica (the native Windows 11 look). The
 * assistant bar is a transparent, 28px-rounded pill that animates its own shape, which a system
 * backdrop cannot follow, so it always uses the CSS glass fallback.
 */
export function backdropFor(role: WindowRole, build: number): BackdropMaterial {
  if (!supportsBackdrop(build)) return 'none';
  return role === 'settings' || role === 'onboarding' ? 'mica' : 'none';
}
