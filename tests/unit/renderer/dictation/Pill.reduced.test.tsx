import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pill, type PillController } from '@renderer/dictation/Pill';
import { resetPillStore, usePillStore } from '@renderer/dictation/store';

vi.mock('@renderer/motion/useMotionPrefs', () => ({
  useReduceMotion: () => true,
  useMotionTransition: (transition: unknown) => transition,
}));

const controller: PillController = {
  levelRef: { current: 0 },
  finishNow: vi.fn(),
  cancel: vi.fn(),
};

beforeEach(() => {
  resetPillStore();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Pill with reduced motion', () => {
  it('keeps the words instead of the decorative waveform while the speaker talks', () => {
    const { container } = render(<Pill controller={controller} />);
    act(() => {
      usePillStore.setState({ visible: true, session: 1, phase: 'listening', speaking: true });
    });
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Listening…');
  });

  it('still shows every phase', () => {
    render(<Pill controller={controller} />);
    act(() => {
      usePillStore.setState({ visible: true, session: 1, phase: 'transcribing' });
    });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Transcribing…');
  });
});
