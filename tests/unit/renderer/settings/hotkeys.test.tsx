import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HotkeySetResult } from '@shared/ipc/types';
import { HotkeysSection } from '@renderer/settings/sections/HotkeysSection';
import {
  clearToasts,
  HOTKEY_STATUS,
  makeView,
  renderWithController,
  startController,
  toastTitles,
  type Handlers,
} from './support';

afterEach(clearToasts);

async function mount(handlers: Handlers = {}, configure?: Parameters<typeof makeView>[0]) {
  const h = await startController({ view: makeView(configure), handlers });
  await waitFor(() => expect(h.controller.store.getState().hotkeys).not.toBeNull());
  renderWithController(<HotkeysSection />, h.controller);
  return h;
}

const assistantChange = () => screen.getAllByRole('button', { name: 'Change' })[0]!;

describe('Hotkeys section', () => {
  it('shows both shortcuts as key caps with their registration status', async () => {
    const h = await mount();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
    expect(screen.getByText('Circle to Search')).toBeInTheDocument();
    expect(screen.getByText('Space')).toBeInTheDocument();
    expect(screen.getAllByText('Shift')).toHaveLength(2);
    expect(screen.getAllByText('Registered')).toHaveLength(2);
    h.stop();
  });

  it('explains a shortcut that another app has taken', async () => {
    const h = await startController({
      hotkeys: {
        assistant: {
          accelerator: 'Ctrl+Shift+Space',
          registered: false,
          error: 'Already in use by another application',
        },
        circle: HOTKEY_STATUS.circle,
        capture: HOTKEY_STATUS.capture,
        dictation: HOTKEY_STATUS.dictation,
      },
    });
    renderWithController(<HotkeysSection />, h.controller);
    expect(await screen.findByText('Taken by another app')).toBeInTheDocument();
    expect(screen.getByText(/Already in use by another application/)).toBeInTheDocument();
    h.stop();
  });

  it('records a new shortcut: prompt, live modifiers, then one hotkeys:set call', async () => {
    const user = userEvent.setup();
    const h = await mount({ 'hotkeys:set': () => ({ ok: true, accelerator: 'Ctrl+Alt+K' }) });

    await user.click(assistantChange());
    expect(screen.getByText(/Press the new shortcut/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await user.keyboard('{Control>}{Alt>}');
    expect(screen.queryByText(/Press the new shortcut/)).toBeNull();
    const live = within(screen.getByRole('status'));
    expect(live.getByText('Ctrl')).toBeInTheDocument();
    expect(live.getByText('Alt')).toBeInTheDocument();
    await user.keyboard('k{/Alt}{/Control}');

    await waitFor(() =>
      expect(h.inputsOf('hotkeys:set')).toEqual([{ id: 'assistant', accelerator: 'Ctrl+Alt+K' }]),
    );
    await waitFor(() => expect(toastTitles()).toEqual(['Shortcut changed']));
    expect(screen.queryByText(/Press the new shortcut/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Change' })).toHaveLength(2);
    h.stop();
  });

  it('Esc cancels without sending anything', async () => {
    const user = userEvent.setup();
    const h = await mount();
    await user.click(assistantChange());
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/Press the new shortcut/)).toBeNull();
    expect(h.inputsOf('hotkeys:set')).toHaveLength(0);
    h.stop();
  });

  it('requires a modifier and rejects typing combinations such as Shift+A', async () => {
    const user = userEvent.setup();
    const h = await mount();
    await user.click(assistantChange());

    await user.keyboard('k');
    expect(await screen.findByText(/Hold Ctrl, Alt, Shift or Win together/)).toBeInTheDocument();

    await user.keyboard('{Shift>}a{/Shift}');
    expect(
      await screen.findByText(/Shift with a letter or digit would get in the way/),
    ).toBeInTheDocument();

    expect(h.inputsOf('hotkeys:set')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    h.stop();
  });

  it('swallows the keystrokes while recording', async () => {
    const user = userEvent.setup();
    const h = await mount({ 'hotkeys:set': () => ({ ok: true, accelerator: 'Ctrl+Alt+K' }) });
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    document.addEventListener('keyup', seen);
    try {
      await user.click(assistantChange());
      await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
      await waitFor(() => expect(h.inputsOf('hotkeys:set')).toHaveLength(1));
      expect(seen).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', seen);
      document.removeEventListener('keyup', seen);
    }
    h.stop();
  });

  it('shows the exact conflict message and offers a one-click suggestion', async () => {
    const user = userEvent.setup();
    const results: HotkeySetResult[] = [
      {
        ok: false,
        reason: 'conflict',
        message: 'Ctrl+Alt+K is already in use by another application. Try Ctrl+Alt+Space.',
        suggestion: 'Ctrl+Alt+Space',
      },
      { ok: true, accelerator: 'Ctrl+Alt+Space' },
    ];
    const h = await mount({
      'hotkeys:set': () => results.shift() ?? { ok: true, accelerator: 'Ctrl+Alt+Space' },
    });

    await user.click(assistantChange());
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Ctrl+Alt+K is already in use by another application. Try Ctrl+Alt+Space.',
    );

    await user.click(screen.getByRole('button', { name: 'Use Ctrl+Alt+Space' }));
    await waitFor(() =>
      expect(h.inputsOf('hotkeys:set')).toEqual([
        { id: 'assistant', accelerator: 'Ctrl+Alt+K' },
        { id: 'assistant', accelerator: 'Ctrl+Alt+Space' },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    h.stop();
  });

  it('shows reserved/invalid answers and lets you try again or dismiss', async () => {
    const user = userEvent.setup();
    const h = await mount({
      'hotkeys:set': () => ({
        ok: false,
        reason: 'reserved',
        message: 'Windows keeps that one for itself.',
      }),
    });
    await user.click(assistantChange());
    await user.keyboard('{Control>}{Alt>}k{/Alt}{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Windows keeps that one for itself.',
    );
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText(/Press the new shortcut/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alert')).toBeNull();
    h.stop();
  });

  it('resets a changed shortcut to its default, and disables reset at the default', async () => {
    const user = userEvent.setup();
    const h = await mount(
      { 'hotkeys:set': () => ({ ok: true, accelerator: 'Ctrl+Shift+Space' }) },
      (view) => {
        view.hotkeys.assistant = 'Ctrl+Alt+K';
      },
    );
    const resets = screen.getAllByRole('button', { name: 'Reset to default' });
    expect(resets[0]).toBeEnabled();
    expect(resets[1]).toBeDisabled();

    await user.click(resets[0]!);
    await waitFor(() =>
      expect(h.inputsOf('hotkeys:set')).toEqual([
        { id: 'assistant', accelerator: 'Ctrl+Shift+Space' },
      ]),
    );
    h.stop();
  });
});
