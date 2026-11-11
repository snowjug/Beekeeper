import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@renderer/components/Toast';
import { makeSession, makeSettings, renderStudio } from './support';

afterEach(() => {
  vi.restoreAllMocks();
  act(() => useToastStore.getState().clear());
});

/** Queries scoped to the toast stack (the live region repeats what the toasts say). */
function inToasts() {
  return within(screen.getByRole('region', { name: 'Notifications' }));
}

describe('the preview', () => {
  it('shows nothing until a capture arrives', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const { render } = await import('@testing-library/react');
    const { createHarness } = await import('./support');
    const { App } = await import('@renderer/studio/App');
    const { ControllerContext } = await import('@renderer/studio/context');
    const harness = createHarness();
    render(
      <ControllerContext.Provider value={harness.controller}>
        <App />
      </ControllerContext.Provider>,
    );
    expect(screen.queryByRole('dialog', { name: 'Capture Studio' })).toBeNull();
    expect(screen.queryByTestId('studio-frame')).toBeNull();
  });

  it('is a modal dialog with the picture, the two pills, the more button and the toolbar', async () => {
    await renderStudio();
    const dialog = screen.getByRole('dialog', { name: 'Capture Studio' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('img', { name: 'Your screenshot' })).toHaveAttribute(
      'src',
      'beekeeper://app/capture/session-1.png',
    );
    expect(screen.getByRole('button', { name: 'Photo assist' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set as wallpaper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More options' })).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Screenshot actions' });
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Edit', 'Pin to screen', 'Copy', 'Share', 'Save']);
  });

  it('gives the picture a glowing frame with four corner brackets', async () => {
    await renderStudio();
    const frame = screen.getByTestId('studio-frame');
    expect(frame).toHaveAttribute('data-glow', 'on');
    expect(frame).toHaveAttribute('data-still', 'false');
    expect(frame.querySelectorAll('.bk-bracket')).toHaveLength(4);
    expect(frame.querySelector('.bk-studio-ring')).not.toBeNull();
    expect(frame.querySelector('.bk-studio-glow')).not.toBeNull();
  });

  it('draws a plain border without brackets when the glow frame is off', async () => {
    await renderStudio({ session: makeSession({ glowFrame: false }) });
    const frame = screen.getByTestId('studio-frame');
    expect(frame).toHaveAttribute('data-glow', 'off');
    expect(frame.querySelectorAll('.bk-bracket')).toHaveLength(0);
    expect(frame.querySelector('.bk-studio-plain')).not.toBeNull();
    expect(frame.querySelector('.bk-studio-ring')).toBeNull();
  });

  it('fits the picture inside the window and follows the theme of the capture', async () => {
    await renderStudio({ session: makeSession({ theme: 'light' }) });
    const frame = screen.getByTestId('studio-frame');
    const width = Number.parseFloat(frame.style.width);
    expect(width).toBeLessThanOrEqual(window.innerWidth * 0.78);
    expect(Number.parseFloat(frame.style.height)).toBeLessThanOrEqual(window.innerHeight * 0.72);
    expect(width / Number.parseFloat(frame.style.height)).toBeCloseTo(1920 / 1080, 1);
    expect(document.documentElement.dataset['theme']).toBe('light');
  });
});

describe('toolbar buttons', () => {
  it('Copy copies the capture and confirms', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(harness.inputsOf('studio:copy')).toEqual([{ sessionId: 'session-1' }]);
    expect(await inToasts().findByText('Copied to clipboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAttribute('data-status', 'done');
  });

  it('Save saves, and the toast offers to show the file', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Save' }));
    expect(harness.inputsOf('studio:save')).toEqual([{ sessionId: 'session-1' }]);
    await harness.user.click(await screen.findByRole('button', { name: 'Show in folder' }));
    await waitFor(() =>
      expect(harness.inputsOf('studio:share')).toEqual([
        { sessionId: 'session-1', target: 'reveal' },
      ]),
    );
  });

  it('Pin to screen pins the capture', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Pin to screen' }));
    expect(harness.inputsOf('studio:pin')).toEqual([{ sessionId: 'session-1' }]);
  });

  it('Edit opens the editor', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(harness.store.getState().mode).toBe('edit');
    expect(await screen.findByTestId('editor-stage')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Editing tools' })).toBeInTheDocument();
  });

  it('shows a busy button while a request runs, and cannot be pressed twice', async () => {
    const { gate } = await import('./support');
    const slow = gate();
    const harness = await renderStudio({
      handlers: {
        'studio:copy': async () => {
          await slow.promise;
          return { ok: true };
        },
      },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Copy' }));
    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      slow.open();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled());
  });

  it('shows an error state with the reason when an action fails', async () => {
    const harness = await renderStudio({
      handlers: { 'studio:copy': () => ({ ok: false, message: 'The clipboard is in use.' }) },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('The clipboard is in use.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toHaveAttribute('data-status', 'error');
  });

  it('moves between the toolbar buttons with the arrow keys', async () => {
    const harness = await renderStudio();
    screen.getByRole('button', { name: 'Edit' }).focus();
    await harness.user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Pin to screen' })).toHaveFocus();
    await harness.user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
    await harness.user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
    await harness.user.keyboard('{Home}');
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus();
  });
});

describe('Share menu', () => {
  it('lists the four share targets and runs the one that is chosen', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Share' }));
    const menu = screen.getByRole('menu', { name: 'Share' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Copy as file', 'Open with…', 'Show in folder', 'Email…']);
    await harness.user.click(within(menu).getByRole('menuitem', { name: 'Copy as file' }));
    expect(harness.inputsOf('studio:share')).toEqual([{ sessionId: 'session-1', target: 'file' }]);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it.each([
    ['Open with…', 'openWith'],
    ['Show in folder', 'reveal'],
    ['Email…', 'mail'],
  ])('"%s" shares with the target %s', async (label, target) => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Share' }));
    await harness.user.click(screen.getByRole('menuitem', { name: label }));
    expect(harness.inputsOf('studio:share')).toEqual([{ sessionId: 'session-1', target }]);
  });

  it('marks the button as a menu button and moves focus into the menu with the keyboard', async () => {
    const harness = await renderStudio();
    const button = screen.getByRole('button', { name: 'Share' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await harness.user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    await harness.user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await harness.user.keyboard('{ArrowUp}{ArrowUp}');
    expect(items[3]).toHaveFocus();
    await harness.user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
    await harness.user.keyboard('{End}');
    expect(items[3]).toHaveFocus();
  });

  it('closes on Escape and gives the focus back to its button, without closing the preview', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Share' }));
    await harness.user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.getByRole('button', { name: 'Share' })).toHaveFocus();
    expect(harness.store.getState().visible).toBe(true);
  });

  it('closes when the user clicks somewhere else', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.pointerDown(screen.getByRole('img', { name: 'Your screenshot' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('pills and the more menu', () => {
  it('Set as wallpaper sets the wallpaper and confirms with a toast', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Set as wallpaper' }));
    expect(harness.inputsOf('studio:wallpaper')).toEqual([{ sessionId: 'session-1' }]);
    expect(await inToasts().findByText('Wallpaper updated')).toBeInTheDocument();
  });

  it('the more menu offers Save as, the folder, Delete, Capture again and Settings', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'More options' }));
    const menu = screen.getByRole('menu', { name: 'More options' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Save as…',
      'Open screenshots folder',
      'Delete screenshot',
      'Capture again',
      'Settings',
    ]);

    await harness.user.click(within(menu).getByRole('menuitem', { name: 'Save as…' }));
    expect(harness.inputsOf('studio:save')).toEqual([{ sessionId: 'session-1', saveAs: true }]);
  });

  it.each([
    ['Capture again', 'capture:start', {}],
    ['Settings', 'window:openSettings', { section: 'capture' }],
    ['Delete screenshot', 'studio:delete', { sessionId: 'session-1' }],
  ] as const)('"%s" calls %s', async (label, channel, input) => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'More options' }));
    await harness.user.click(screen.getByRole('menuitem', { name: label }));
    expect(harness.inputsOf(channel)).toEqual([input]);
  });

  it('Open screenshots folder opens the folder', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'More options' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Open screenshots folder' }));
    expect(harness.inputsOf('studio:openFolder')).toHaveLength(1);
  });

  it('Photo assist offers Extract text and Hide sensitive info', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    const menu = screen.getByRole('menu', { name: 'Photo assist' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Extract text', 'Hide sensitive info']);
  });
});

describe('the text sheet', () => {
  it('shows the extracted text with Copy, Search web and Read aloud', async () => {
    const harness = await renderStudio({
      handlers: {
        'studio:assist': () => ({ ok: true, task: 'text', text: 'Hello from the picture' }),
      },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    expect(harness.inputsOf('studio:assist')).toEqual([{ sessionId: 'session-1', task: 'text' }]);

    const sheet = await screen.findByRole('dialog', { name: 'Text in this screenshot' });
    expect(await within(sheet).findByTestId('studio-text')).toHaveTextContent(
      'Hello from the picture',
    );
    expect(within(sheet).getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: 'Search web' })).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: 'Read aloud' })).toBeEnabled();

    await harness.user.click(within(sheet).getByRole('button', { name: 'Copy' }));
    expect(harness.inputsOf('studio:copyText')).toEqual([{ text: 'Hello from the picture' }]);
  });

  it('takes the toolbar out of the way while it is open and brings it back when it closes', async () => {
    const harness = await renderStudio({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'text', text: 'Hello' }) },
    });
    const toolbar = screen.getByRole('toolbar', { name: 'Screenshot actions' });
    expect(toolbar.parentElement).not.toHaveAttribute('inert');

    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    await screen.findByRole('dialog', { name: 'Text in this screenshot' });
    expect(toolbar.parentElement).toHaveAttribute('inert');

    await harness.user.keyboard('{Escape}');
    await waitFor(() => expect(toolbar.parentElement).not.toHaveAttribute('inert'));
  });

  it('shows a placeholder while the text is being read', async () => {
    const { gate } = await import('./support');
    const slow = gate();
    const harness = await renderStudio({
      handlers: {
        'studio:assist': async () => {
          await slow.promise;
          return { ok: true, task: 'text', text: 'x' };
        },
      },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    expect(await screen.findByTestId('studio-text-loading')).toBeInTheDocument();
    const sheet = await screen.findByRole('dialog', { name: 'Text in this screenshot' });
    expect(within(sheet).getByRole('button', { name: 'Copy' })).toBeDisabled();
    await act(async () => {
      slow.open();
      await Promise.resolve();
    });
  });

  it('says when no text was found, and lets the user try again after an error', async () => {
    const harness = await renderStudio({
      handlers: {
        'studio:assist': () => ({
          ok: true,
          task: 'text',
          text: '',
          message: 'No text found in this screenshot.',
        }),
      },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    expect(await screen.findByTestId('studio-no-text')).toHaveTextContent(
      'No text found in this screenshot.',
    );

    harness.handle('studio:assist', () => ({
      ok: false,
      task: 'text',
      message: 'Reading took too long.',
    }));
    await act(async () => {
      await harness.controller.extractText();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Reading took too long.');
    harness.handle('studio:assist', () => ({ ok: true, task: 'text', text: 'Second try' }));
    await harness.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('studio-text')).toHaveTextContent('Second try');
  });

  it('hides Read aloud after speech failed', async () => {
    const harness = await renderStudio({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'text', text: 'Some words' }) },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    await harness.user.click(await screen.findByRole('button', { name: 'Read aloud' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Read aloud' })).toBeNull());
    expect(harness.inputsOf('speech:synthesize')).toEqual([{ text: 'Some words' }]);
  });
});

describe('hiding sensitive info', () => {
  const regions = [
    { kind: 'email', label: 'Email address', rect: { x: 100, y: 100, width: 300, height: 40 } },
    { kind: 'card', label: 'Card number', rect: { x: 100, y: 200, width: 400, height: 40 } },
  ] as const;

  async function review() {
    const harness = await renderStudio({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'sensitive', regions: [...regions] }) },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Hide sensitive info' }));
    await screen.findByTestId('redaction-layer');
    return harness;
  }

  it('shows a box for every area that can be toggled or removed, and a bar with the count', async () => {
    const harness = await review();
    expect(harness.inputsOf('studio:assist')).toEqual([
      { sessionId: 'session-1', task: 'sensitive' },
    ]);
    expect(screen.getByTestId('redaction-bar')).toHaveTextContent('2 sensitive areas found');
    const email = screen.getByRole('button', { name: 'Email address: will be blurred' });
    expect(email).toHaveAttribute('aria-pressed', 'true');
    await harness.user.click(email);
    expect(
      screen.getByRole('button', { name: 'Email address: will stay visible' }),
    ).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Blur 1' })).toBeEnabled();

    await harness.user.click(screen.getByRole('button', { name: 'Remove Card number' }));
    expect(screen.getAllByTestId('redaction-box')).toHaveLength(1);
  });

  it('blurs the selected areas when the user confirms', async () => {
    const harness = await review();
    await harness.user.click(screen.getByRole('button', { name: 'Blur 2' }));
    await waitFor(() => expect(harness.flatten).toHaveBeenCalledOnce());
    await waitFor(() => expect(harness.store.getState().edited).toBe(true));
    expect(screen.queryByTestId('redaction-layer')).toBeNull();
    expect(await screen.findByText('Sensitive info hidden')).toBeInTheDocument();
  });

  it('puts the toolbar out of reach while the areas are being reviewed, and Cancel leaves the picture alone', async () => {
    const harness = await review();
    expect(screen.getByRole('toolbar', { name: 'Screenshot actions' }).className).toContain(
      'pointer-events-none',
    );
    await harness.user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('redaction-bar')).toBeNull();
    expect(harness.flatten).not.toHaveBeenCalled();
    expect(harness.store.getState().edited).toBe(false);
  });

  it('Esc leaves the review before it closes the preview', async () => {
    const harness = await review();
    await harness.user.keyboard('{Escape}');
    expect(harness.store.getState().redaction.status).toBe('idle');
    expect(harness.store.getState().visible).toBe(true);
  });
});

describe('keyboard', () => {
  it('Esc closes the menu, then the sheet, then the preview', async () => {
    const harness = await renderStudio({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'text', text: 'abc' }) },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    await screen.findByRole('dialog', { name: 'Text in this screenshot' });
    await harness.user.click(screen.getByRole('button', { name: 'More options' }));
    expect(harness.store.getState().menu).toBe('more');

    await harness.user.keyboard('{Escape}');
    expect(harness.store.getState().menu).toBeNull();
    expect(harness.store.getState().sheet.open).toBe(true);
    await harness.user.keyboard('{Escape}');
    expect(harness.store.getState().sheet.open).toBe(false);
    expect(harness.store.getState().visible).toBe(true);
    await harness.user.keyboard('{Escape}');
    expect(harness.store.getState().visible).toBe(false);
    await waitFor(() =>
      expect(harness.inputsOf('studio:close')).toEqual([{ sessionId: 'session-1' }]),
    );
  });

  it('Ctrl+C copies the screenshot and Ctrl+S saves it', async () => {
    const harness = await renderStudio();
    await harness.user.keyboard('{Control>}c{/Control}');
    expect(harness.inputsOf('studio:copy')).toHaveLength(1);
    await harness.user.keyboard('{Control>}s{/Control}');
    expect(harness.inputsOf('studio:save')).toEqual([{ sessionId: 'session-1' }]);
  });

  it('Ctrl+Shift+S opens Save as', async () => {
    const harness = await renderStudio();
    await harness.user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');
    expect(harness.inputsOf('studio:save')).toEqual([{ sessionId: 'session-1', saveAs: true }]);
  });

  it('Ctrl+C leaves selected text alone so it can be copied as text', async () => {
    const harness = await renderStudio({
      handlers: { 'studio:assist': () => ({ ok: true, task: 'text', text: 'select me' }) },
    });
    await harness.user.click(screen.getByRole('button', { name: 'Photo assist' }));
    await harness.user.click(screen.getByRole('menuitem', { name: 'Extract text' }));
    const text = await screen.findByTestId('studio-text');
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await harness.user.keyboard('{Control>}c{/Control}');
    expect(harness.inputsOf('studio:copy')).toEqual([]);
    window.getSelection()?.removeAllRanges();
  });

  it('a click on the dimmed backdrop closes the preview', async () => {
    const harness = await renderStudio();
    await harness.user.click(screen.getByTestId('studio-backdrop'));
    expect(harness.store.getState().visible).toBe(false);
  });

  it('keeps the shortcuts out of a text field', async () => {
    const harness = await renderStudio();
    harness.store.getState().setMode('edit');
    await harness.user.keyboard('{Control>}c{/Control}');
    expect(harness.inputsOf('studio:copy')).toEqual([]);
  });
});

describe('accessibility', () => {
  it('announces what happened for screen readers', async () => {
    const harness = await renderStudio();
    expect(screen.getByRole('status', { name: '' })).toBeInTheDocument();
    await harness.user.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(harness.store.getState().announcement).toBe('Copied to clipboard'));
  });

  it('gives every toolbar and pill button a name', async () => {
    await renderStudio();
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label') ?? button.textContent).toBeTruthy();
    }
  });
});

describe('settings', () => {
  it('keeps working when the settings say the shutter is off', async () => {
    const harness = await renderStudio({
      settings: makeSettings({ capture: { shutterSound: false } }),
    });
    expect(harness.shutter.play).not.toHaveBeenCalled();
    expect(screen.getByTestId('studio-frame')).toBeInTheDocument();
  });
});
