import { nativeTheme } from 'electron';
import type { Display } from 'electron';
import type { WindowManager } from './manager';

const FADE_MS = 360;

/**
 * Full-display, transparent, click-through window with the animated border glow shown while the
 * assistant is listening (spec 5). It never takes focus or mouse input.
 */
export class EdgeGlowController {
  private hideTimer: NodeJS.Timeout | null = null;
  private active = false;
  private clickThrough = false;

  constructor(private readonly windows: WindowManager) {}

  show(display: Display): void {
    this.active = true;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    const win = this.windows.ensure('edgeGlow');
    win.setBounds(display.bounds);
    win.setBounds(display.bounds);
    win.setIgnoreMouseEvents(true, { forward: true });
    this.clickThrough = true;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.showInactive();
    this.windows.send('edgeGlow', 'glow:state', {
      active: true,
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    });
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.windows.send('edgeGlow', 'glow:state', {
      active: false,
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    });
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      if (!this.active) this.windows.get('edgeGlow')?.hide();
    }, FADE_MS);
  }

  /** Hides the glow at once, without its fade-out (e.g. before a screenshot). True when it was on. */
  hideImmediately(): boolean {
    const win = this.windows.get('edgeGlow');
    const wasShown = this.active || Boolean(win?.isVisible());
    if (!wasShown) return false;
    this.active = false;
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.windows.send('edgeGlow', 'glow:state', {
      active: false,
      theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    });
    win?.hide();
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  /** The glow window as it is right now (automated tests and diagnostics). */
  snapshot(): { active: boolean; visible: boolean; focusable: boolean; clickThrough: boolean } {
    const win = this.windows.get('edgeGlow');
    return {
      active: this.active,
      visible: Boolean(win?.isVisible()),
      focusable: win?.isFocusable() ?? false,
      clickThrough: this.clickThrough,
    };
  }
}
