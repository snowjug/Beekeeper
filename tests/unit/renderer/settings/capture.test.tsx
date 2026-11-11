import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureSection } from '@renderer/settings/sections/CaptureSection';
import {
  clearToasts,
  makeView,
  renderWithController,
  startController,
  toastTitles,
  type StartOptions,
} from './support';

async function mount(options: StartOptions = {}) {
  const h = await startController(options);
  const ui = renderWithController(<CaptureSection />, h.controller);
  return { h, ...ui };
}

afterEach(clearToasts);

describe('Capture Studio section', () => {
  it('shows the defaults: preview, glow and saving on, copying off', async () => {
    const { h } = await mount();
    expect(screen.getByRole('switch', { name: 'Open the preview' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Glow frame' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Save automatically' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Copy automatically' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('switch', { name: 'Shutter sound' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByRole('combobox', { name: 'Close the preview by itself' }),
    ).toHaveDisplayValue('Never');
    h.stop();
  });

  it('every switch sends exactly one minimal patch', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    await user.click(screen.getByRole('switch', { name: 'Open the preview' }));
    await user.click(screen.getByRole('switch', { name: 'Save automatically' }));
    await user.click(screen.getByRole('switch', { name: 'Copy automatically' }));
    await user.click(screen.getByRole('switch', { name: 'Shutter sound' }));
    expect(h.inputsOf('settings:update')).toEqual([
      { capture: { openStudio: false } },
      { capture: { autoSave: false } },
      { capture: { autoCopy: true } },
      { capture: { shutterSound: false } },
    ]);
    h.stop();
  });

  it('the glow frame belongs to the preview: it is locked while the preview is off', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      view: makeView((view) => {
        view.capture.openStudio = false;
      }),
    });
    expect(screen.getByRole('switch', { name: 'Glow frame' })).toBeDisabled();
    await user.click(screen.getByRole('switch', { name: 'Open the preview' }));
    expect(screen.getByRole('switch', { name: 'Glow frame' })).toBeEnabled();
    expect(h.inputsOf('settings:update')).toEqual([{ capture: { openStudio: true } }]);
    h.stop();
  });

  it('warns when a screenshot would go nowhere, and stops warning once copying is on', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      view: makeView((view) => {
        view.capture.openStudio = false;
        view.capture.autoSave = false;
      }),
    });
    expect(screen.getByText(/a screenshot would be thrown away/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Copy automatically' }));
    await waitFor(() => expect(screen.queryByText(/a screenshot would be thrown away/)).toBeNull());
    h.stop();
  });

  it('offers Never and the fixed times for the close timer', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    const timer = screen.getByRole('combobox', { name: 'Close the preview by itself' });
    expect(
      within(timer)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Never', '5 seconds', '10 seconds', '20 seconds', '30 seconds', '60 seconds']);

    await user.selectOptions(timer, '20');
    await user.selectOptions(timer, '0');
    expect(h.inputsOf('settings:update')).toEqual([
      { capture: { dismissAfterSeconds: 20 } },
      { capture: { dismissAfterSeconds: 0 } },
    ]);
    h.stop();
  });

  it('keeps an unusual saved close time visible instead of showing the wrong one', async () => {
    const { h } = await mount({
      view: makeView((view) => {
        view.capture.dismissAfterSeconds = 15;
      }),
    });
    expect(
      screen.getByRole('combobox', { name: 'Close the preview by itself' }),
    ).toHaveDisplayValue('15 seconds');
    h.stop();
  });

  it('validates the screenshots folder and only saves a full path (or an empty one)', async () => {
    const user = userEvent.setup();
    const { h } = await mount();
    const folder = screen.getByRole('textbox', { name: 'Screenshots folder' });
    expect(folder).toHaveAttribute('placeholder', 'Pictures\\Beekeeper');
    expect(screen.getByText(/Leave it empty to use Pictures\\Beekeeper/)).toBeInTheDocument();

    await user.type(folder, 'Screenshots');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the full path');
    expect(h.inputsOf('settings:update')).toHaveLength(0);

    await user.clear(folder);
    await user.type(folder, 'D:\\Shots\\a|b');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent('cannot contain');
    expect(h.inputsOf('settings:update')).toHaveLength(0);

    await user.clear(folder);
    await user.type(folder, 'D:\\Shots');
    await user.tab();
    await waitFor(() =>
      expect(h.inputsOf('settings:update')).toEqual([{ capture: { saveFolder: 'D:\\Shots' } }]),
    );
    expect(screen.queryByRole('alert')).toBeNull();

    await user.clear(folder);
    await user.tab();
    await waitFor(() =>
      expect(h.inputsOf('settings:update').at(-1)).toEqual({ capture: { saveFolder: '' } }),
    );
    h.stop();
  });

  it('shows the shortcut, links to the Hotkeys page and starts a capture on request', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      view: makeView((view) => {
        view.hotkeys.capture = 'Ctrl+Alt+P';
      }),
      handlers: { 'capture:start': () => undefined },
    });
    expect(screen.getByText('P')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Change shortcut/ }));
    expect(h.controller.store.getState().section).toBe('hotkeys');

    await user.click(screen.getByRole('button', { name: 'Take a screenshot now' }));
    await waitFor(() => expect(h.inputsOf('capture:start')).toHaveLength(1));
    h.stop();
  });

  it('says so, with a toast, when the capture cannot start', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      handlers: {
        'capture:start': () => {
          throw new Error('Capture Studio is not available yet');
        },
      },
    });
    await user.click(screen.getByRole('button', { name: 'Take a screenshot now' }));
    await waitFor(() => expect(toastTitles()).toEqual(['Could not take the screenshot']));
    h.stop();
  });

  it('explains what Capture Studio can do', async () => {
    const { h } = await mount();
    const steps = screen.getByRole('group', { name: 'How it works' });
    for (const title of ['Edit', 'Pin to screen', 'Copy', 'Share', 'Save', 'Photo assist']) {
      expect(within(steps).getByText(title)).toBeInTheDocument();
    }
    expect(within(steps).getByText(/hide sensitive information/)).toBeInTheDocument();
    h.stop();
  });

  it('points to the Voice page when the shutter sound cannot be heard', async () => {
    const user = userEvent.setup();
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.earcons = false;
      }),
    });
    expect(screen.getByText(/Sound effects are off, so you will not hear it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Voice' }));
    expect(h.controller.store.getState().section).toBe('voice');
    h.stop();
  });
});
