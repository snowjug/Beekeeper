import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describePill,
  firstWords,
  hintFor,
  languageBadge,
  languageName,
} from '@renderer/dictation/copy';
import { Pill, type PillController } from '@renderer/dictation/Pill';
import { resetPillStore, usePillStore } from '@renderer/dictation/store';

function fakeController() {
  const finishNow = vi.fn();
  const cancel = vi.fn();
  const controller: PillController = { levelRef: { current: 0 }, finishNow, cancel };
  return { controller, finishNow, cancel };
}

function show(patch: Partial<ReturnType<typeof usePillStore.getState>> = {}): void {
  act(() => {
    usePillStore.setState({ visible: true, session: 1, ...patch });
  });
}

beforeEach(() => {
  resetPillStore();
  // jsdom has no canvas: keep the waveform quiet.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('copy', () => {
  it('shortens a transcript to its first words', () => {
    expect(firstWords('')).toBe('');
    expect(firstWords('  one two  ')).toBe('one two');
    expect(firstWords('one two three four five six seven')).toBe(
      'one two three four five six seven',
    );
    expect(firstWords('one two three four five six seven eight')).toBe(
      'one two three four five six seven…',
    );
    expect(firstWords('नमस्ते दुनिया कैसे हो', 2)).toBe('नमस्ते दुनिया…');
  });

  it('names the languages', () => {
    expect([languageBadge('en'), languageBadge('hi'), languageBadge('auto')]).toEqual([
      'EN',
      'हि',
      'Auto',
    ]);
    expect([languageName('en'), languageName('hi'), languageName('auto')]).toEqual([
      'English',
      'Hindi',
      'Automatic language',
    ]);
  });

  it('shows the hotkey that works, or the button when there is none', () => {
    expect(hintFor('Ctrl+Alt+D')).toBe('Press Ctrl+Alt+D to finish · Esc to cancel');
    expect(hintFor(null)).toBe('Click the microphone to finish · Esc to cancel');
  });

  it.each([
    [{ phase: 'listening', preparing: true }, 'Starting the microphone…'],
    [{ phase: 'listening', speaking: false }, 'Listening… speak now'],
    [{ phase: 'listening', speaking: true }, 'Listening…'],
    [{ phase: 'transcribing' }, 'Transcribing…'],
    [{ phase: 'typing', text: 'hi there' }, 'Typing…'],
    [{ phase: 'done', text: 'hi there' }, 'Typed'],
    [{ phase: 'done', text: 'hi', message: 'Copied — press Ctrl+V' }, 'Copied — press Ctrl+V'],
    [{ phase: 'error', message: 'No microphone found.' }, 'No microphone found.'],
    [{ phase: 'error' }, 'Dictation hit a problem. Try again'],
    [{ phase: 'cancelled' }, 'Cancelled'],
  ] as const)('titles %j as %s', (patch, title) => {
    expect(
      describePill({ speaking: false, hotkey: null, text: '', message: '', ...patch }).title,
    ).toBe(title);
  });
});

describe('Pill', () => {
  it('shows nothing until a dictation starts', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    expect(screen.queryByTestId('dictation-pill')).toBeNull();
  });

  it('invites the user to speak, with the real hotkey and the language', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'listening', language: 'hi', hotkey: 'Alt+Shift+D' });

    const pill = screen.getByTestId('dictation-pill');
    expect(pill).toHaveAttribute('data-phase', 'listening');
    expect(pill).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Listening… speak now');
    expect(screen.getByTestId('pill-subtitle')).toHaveTextContent(
      'Press Alt+Shift+D to finish · Esc to cancel',
    );
    expect(screen.getByTestId('pill-language')).toHaveTextContent('हि');
    expect(screen.getByTestId('pill-language')).toHaveAttribute('title', 'Hindi');
  });

  it('does not invite the user to speak before the microphone is open', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'listening', preparing: true, hotkey: 'Alt+Shift+D' });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Starting the microphone…');
    expect(screen.getByTestId('pill-subtitle')).toHaveTextContent('Esc to cancel');

    show({ phase: 'listening', preparing: false });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Listening… speak now');
  });

  it('points to the microphone button when the hotkey is not available', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'listening', language: 'auto', hotkey: null });
    expect(screen.getByTestId('pill-subtitle')).toHaveTextContent(
      'Click the microphone to finish · Esc to cancel',
    );
    expect(screen.getByTestId('pill-language')).toHaveTextContent('Auto');
  });

  it('finishes with the microphone button and cancels with the close button', async () => {
    const user = userEvent.setup();
    const { controller, finishNow, cancel } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'listening' });

    await user.click(screen.getByRole('button', { name: 'Finish dictation' }));
    expect(finishNow).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Cancel dictation' }));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels with Esc', async () => {
    const user = userEvent.setup();
    const { controller, cancel } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'listening' });
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('stops listening for Esc when it is unmounted', async () => {
    const user = userEvent.setup();
    const { controller, cancel } = fakeController();
    const { unmount } = render(<Pill controller={controller} />);
    unmount();
    await user.keyboard('{Escape}');
    expect(cancel).not.toHaveBeenCalled();
  });

  it('adds a live waveform to the title once the speaker talks', () => {
    const { controller } = fakeController();
    const { container } = render(<Pill controller={controller} />);
    show({ phase: 'listening', speaking: false });
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Listening… speak now');

    show({ phase: 'listening', speaking: true });
    expect(screen.getByTestId('pill-title')).toHaveTextContent(/^Listening…$/);
    expect(container.querySelector('canvas')).not.toBeNull();
    // The hint and the language stay.
    expect(screen.getByTestId('pill-subtitle')).toHaveTextContent('Esc to cancel');
    expect(screen.getByTestId('pill-language')).toBeInTheDocument();
  });

  it('shows that it is transcribing and still lets the user cancel', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'transcribing' });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Transcribing…');
    expect(screen.queryByRole('button', { name: 'Finish dictation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel dictation' })).toBeInTheDocument();
    expect(screen.queryByTestId('pill-language')).toBeNull();
  });

  it('shows what is being typed', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'typing', text: 'Hello, how are you today my friend and colleague' });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Typing…');
    expect(screen.getByTestId('pill-subtitle')).toHaveTextContent(
      'Hello, how are you today my friend…',
    );
    expect(screen.queryByRole('button', { name: 'Cancel dictation' })).toBeNull();
  });

  it('confirms with the first words once typed', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'done', text: 'नमस्ते दुनिया' });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Typed');
    expect(screen.getByTestId('pill-subtitle')).toHaveTextContent('नमस्ते दुनिया');
  });

  it('tells the user to paste when the text was copied instead', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'done', text: 'Hello', message: 'Copied — press Ctrl+V' });
    expect(screen.getByTestId('pill-title')).toHaveTextContent('Copied — press Ctrl+V');
  });

  it('shows an error message', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'error', message: 'Download the voice model in Settings > Voice' });
    const pill = screen.getByTestId('dictation-pill');
    expect(within(pill).getByTestId('pill-title')).toHaveTextContent(
      'Download the voice model in Settings > Voice',
    );
    expect(within(pill).queryByRole('button')).toBeNull();
  });

  it('plays its exit when the dictation is cancelled', async () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    show({ phase: 'listening' });
    act(() => {
      usePillStore.getState().setStatus({ phase: 'cancelled' });
    });
    await vi.waitFor(() => expect(screen.queryByTestId('dictation-pill')).toBeNull());
  });

  it('starts a fresh pill for every dictation', () => {
    const { controller } = fakeController();
    render(<Pill controller={controller} />);
    act(() => {
      usePillStore.getState().begin({ language: 'en', hotkey: 'Alt+Shift+D' });
    });
    expect(screen.getByTestId('dictation-pill')).toBeInTheDocument();
    expect(usePillStore.getState().session).toBe(1);
    act(() => {
      usePillStore.getState().begin({ language: 'en', hotkey: 'Alt+Shift+D' });
    });
    expect(usePillStore.getState().session).toBe(2);
  });
});
