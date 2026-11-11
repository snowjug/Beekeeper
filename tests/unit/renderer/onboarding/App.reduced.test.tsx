import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { button, goTo, heading, renderApp, stubCanvas } from './appHarness';

vi.mock('@renderer/motion/useMotionPrefs', () => ({
  useReduceMotion: () => true,
  useMotionTransition: (transition: unknown) => transition,
}));

stubCanvas();

describe('reduced motion', () => {
  it('keeps the ambient light still and shows the orb settled from the first frame', async () => {
    const { container } = renderApp();
    await heading('Meet Beekeeper');
    expect(container.querySelectorAll('.ob-blob')).toHaveLength(4);
    expect(container.querySelector('[class*="ob-drift"]')).toBeNull();
    expect(container.querySelector('[data-orb-state]')?.getAttribute('data-orb-state')).toBe(
      'idle',
    );
  });

  it('keeps the level meter (an instrument) but drops the decorative waveform', async () => {
    const { user, container } = renderApp();
    await heading('Meet Beekeeper');
    await user.click(button('Get started'));
    await heading(/language & voice/i);
    await user.click(button('Skip for now'));
    await heading(/try your microphone/i);
    expect(screen.getByRole('meter', { name: 'Input level' })).toBeInTheDocument();
    expect(container.querySelector('canvas')).toBeNull();
    await user.click(button('Allow & test microphone'));
    await screen.findByText('Say something…');
    expect(screen.getByText('Microphone on').previousElementSibling?.className).not.toContain(
      'ob-live',
    );
  });

  it('shows static key caps without the pressing loop', async () => {
    const { user, container } = renderApp();
    await goTo(user, 'hotkeys');
    expect(container.querySelectorAll('kbd').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelector('.ob-press')).toBeNull();
  });

  it('replaces the confetti with a static sparkle', async () => {
    const { user, container } = renderApp();
    await goTo(user, 'done');
    expect(document.querySelector('[data-celebration="confetti"]')).toBeNull();
    expect(document.querySelector('canvas')).toBeNull();
    await waitFor(() =>
      expect(container.querySelector('[data-celebration="sparkle"]')).not.toBeNull(),
    );
  });
});
