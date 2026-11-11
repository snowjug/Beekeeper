import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, vi } from 'vitest';
import { App } from '@renderer/onboarding/App';
import type { OpenMic } from '@renderer/onboarding/micOpen';
import { createFakeBridge, createFakeMic, type FakeBridge, type FakeMic } from './testUtils';

export type User = ReturnType<typeof userEvent.setup>;

export interface RenderOptions {
  fake?: FakeBridge;
  mic?: FakeMic;
  openMic?: OpenMic;
  /** Footer action cool-down; 0 (default) lets tests click as fast as they like. */
  cooldown?: number;
}

export function renderApp(options: RenderOptions = {}) {
  const fake = options.fake ?? createFakeBridge();
  const mic = options.mic ?? createFakeMic();
  const openMic = vi.fn<OpenMic>(options.openMic ?? (() => Promise.resolve(mic.session)));
  const user = userEvent.setup();
  const view = render(
    <App bridge={fake.bridge} openMic={openMic} actionCooldownMs={options.cooldown ?? 0} />,
  );
  return { fake, mic, openMic, user, ...view };
}

export const heading = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
export const button = (name: string | RegExp) => screen.getByRole('button', { name });
export const liveRegion = () => document.querySelector('[aria-live="polite"]');

export type Target = 'microphone' | 'model' | 'hotkeys' | 'done';

/** Clicks through the footer buttons of the default scenario (nothing downloaded, mic untested). */
export async function goTo(user: User, target: Target): Promise<void> {
  const route: Array<[string, RegExp]> = [
    ['Get started', /try your microphone/i],
    ['Skip for now', /voice model/i],
    ['Not now', /anywhere/i],
    ['Continue', /all set/i],
  ];
  const last = ['microphone', 'model', 'hotkeys', 'done'].indexOf(target);
  await heading('Meet Beekeeper');
  for (const [label, next] of route.slice(0, last + 1)) {
    await user.click(button(label));
    await heading(next);
  }
}

/** jsdom has no canvas: keep it quiet by making the 2D context unavailable. */
export function stubCanvas(): void {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}
