import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { button, goTo, heading, renderApp, stubCanvas, type RenderOptions } from './appHarness';
import { createFakeBridge, modelState, settingsView } from './testUtils';

stubCanvas();

async function openHotkeysScreen(options: RenderOptions = {}) {
  const rendered = renderApp(options);
  await goTo(rendered.user, 'hotkeys');
  return rendered;
}

const switchOf = (name: string) => screen.getByRole('switch', { name });

describe('hotkeys and wake word screen', () => {
  it('shows both hotkeys as key caps with their registration status', async () => {
    const fake = createFakeBridge();
    fake.handle('hotkeys:status', () => ({
      assistant: { accelerator: 'Ctrl+Shift+Space', registered: true },
      circle: {
        accelerator: 'Alt+Shift+C',
        registered: false,
        error: 'Already in use by another application',
      },
    }));
    await openHotkeysScreen({ fake });
    expect(screen.getByRole('img', { name: 'Ctrl + Shift + Space' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alt + Shift + C' })).toBeInTheDocument();
    expect(screen.getByText(/Opens the assistant bar and starts listening/)).toBeInTheDocument();
    expect(screen.getByText(/Draw around anything on your screen/)).toBeInTheDocument();
    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Not active')).toBeInTheDocument();
    expect(
      screen.getByText('Taken by another app — change it in Settings > Hotkeys'),
    ).toBeInTheDocument();
  });

  it('shows the configured hotkeys, not just the defaults, and refreshes their status', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () => ({
      ...settingsView(),
      hotkeys: { assistant: 'Ctrl+Alt+Space', circle: 'Ctrl+Shift+F9' },
    }));
    fake.handle('hotkeys:status', () => ({
      assistant: { accelerator: 'Ctrl+Alt+Space', registered: true },
      circle: { accelerator: 'Ctrl+Shift+F9', registered: true },
    }));
    await openHotkeysScreen({ fake });
    expect(await screen.findByRole('img', { name: 'Ctrl + Alt + Space' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ctrl + Shift + F9' })).toBeInTheDocument();
    await waitFor(() => expect(fake.inputsOf('hotkeys:status').length).toBeGreaterThanOrEqual(2));
  });

  it('shows the configured hotkeys when their registration status cannot be read', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () => ({
      ...settingsView(),
      hotkeys: { assistant: 'Ctrl+Alt+Space', circle: 'Ctrl+Shift+F9' },
    }));
    fake.handle('hotkeys:status', () => {
      throw new Error('ipc down');
    });
    await openHotkeysScreen({ fake });
    expect(await screen.findByRole('img', { name: 'Ctrl + Alt + Space' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ctrl + Shift + F9' })).toBeInTheDocument();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.queryByText('Not active')).toBeNull();
  });

  it('has the wake word off by default, replies on, and explains the privacy of the wake word', async () => {
    await openHotkeysScreen();
    expect(switchOf('Hey Beekeeper')).toHaveAttribute('aria-checked', 'false');
    expect(switchOf('Push to talk')).toHaveAttribute('aria-checked', 'false');
    expect(switchOf('Speak replies aloud')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/nothing is recorded or sent anywhere/)).toBeInTheDocument();
    expect(screen.getByText(/a tray indicator shows when the mic is active/)).toBeInTheDocument();
    expect(screen.getByText(/Needs the voice model/)).toBeInTheDocument();
  });

  it.each([
    ['Hey Beekeeper', { wakeWord: true }],
    ['Push to talk', { pushToTalk: true }],
    ['Speak replies aloud', { ttsEnabled: false }],
  ] as const)('saves the "%s" switch with settings:update', async (name, patch) => {
    const { fake, user } = await openHotkeysScreen();
    await user.click(switchOf(name));
    expect(fake.inputsOf('settings:update')).toEqual([{ voice: patch }]);
    const [expected] = Object.values(patch);
    await waitFor(() => expect(switchOf(name)).toHaveAttribute('aria-checked', String(expected)));
  });

  it('accepts the wake word before the model is ready and says it starts later', async () => {
    const { user } = await openHotkeysScreen();
    await user.click(switchOf('Hey Beekeeper'));
    expect(
      await screen.findByText('Saved. It starts listening as soon as the voice model is ready.'),
    ).toBeInTheDocument();
  });

  it('follows the status of the wake-word worker once the model is ready', async () => {
    const fake = createFakeBridge();
    fake.handle('voice:modelStatus', () => modelState({ state: 'ready' }));
    fake.handle('settings:get', () => settingsView({ voice: { wakeWord: true } }));
    const { user } = renderApp({ fake });
    await heading('Meet Beekeeper');
    await user.click(button('Get started'));
    await heading(/try your microphone/i);
    await user.click(button('Skip for now'));
    await heading(/voice model/i);
    await user.click(button('Continue'));
    await heading(/anywhere/i);
    expect(switchOf('Hey Beekeeper')).toHaveAttribute('aria-checked', 'true');
    act(() => fake.emit('voice:wakeStatus', { state: 'armed' }));
    expect(await screen.findByText('Listening for “Hey Beekeeper”.')).toBeInTheDocument();
    act(() =>
      fake.emit('voice:wakeStatus', { state: 'error', message: 'The model failed to load' }),
    );
    expect(await screen.findByText('The model failed to load')).toBeInTheDocument();
  });

  it('rolls a switch back and says so when saving fails', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:update', () => {
      throw new Error('disk is full');
    });
    const { user } = await openHotkeysScreen({ fake });
    await user.click(switchOf('Push to talk'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t save that setting');
    await waitFor(() => expect(switchOf('Push to talk')).toHaveAttribute('aria-checked', 'false'));
  });

  it('applies settings changed elsewhere', async () => {
    const { fake } = await openHotkeysScreen();
    act(() => fake.emit('settings:changed', settingsView({ voice: { pushToTalk: true } })));
    await waitFor(() => expect(switchOf('Push to talk')).toHaveAttribute('aria-checked', 'true'));
  });
});
