import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MIC_ERROR_HELP, MicError } from '@renderer/lib/voice/mic';
import {
  button,
  heading,
  liveRegion,
  renderApp,
  stubCanvas,
  type RenderOptions,
} from './appHarness';
import { createFakeBridge, settingsView } from './testUtils';

stubCanvas();

async function openMicScreen(options: RenderOptions = {}) {
  const rendered = renderApp(options);
  await heading('Meet Beekeeper');
  await rendered.user.click(button('Get started'));
  await heading(/try your microphone/i);
  return rendered;
}

describe('microphone screen', () => {
  it('explains the privacy rules and offers a skip', async () => {
    await openMicScreen();
    expect(screen.getByText(/only listens while you’re talking to it/)).toBeInTheDocument();
    expect(screen.getByText(/never leaves this PC unless you enable Azure/)).toBeInTheDocument();
    expect(screen.getByText(/works with typed commands/)).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Input level' })).toBeInTheDocument();
    expect(button('Skip for now')).toBeInTheDocument();
    expect(screen.queryByText('Microphone on')).toBeNull();
  });

  it('tests the microphone: shows the meter, hears the user, then releases the microphone', async () => {
    const { user, mic, openMic, container } = await openMicScreen();
    const orb = () => container.querySelector('[data-orb-state]')?.getAttribute('data-orb-state');
    expect(orb()).toBe('idle');
    await user.click(button('Allow & test microphone'));
    expect(openMic).toHaveBeenCalledWith('default');
    expect(await screen.findByText('Say something…')).toBeInTheDocument();
    expect(screen.getByText('Microphone on')).toBeInTheDocument();
    expect(orb()).toBe('listening');

    mic.level.value = 0.25;
    expect(await screen.findByText('I can hear you', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(button('Continue')).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('I can hear you.');

    await waitFor(() => expect(mic.stop).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(screen.queryByText('Microphone on')).toBeNull());
    expect(screen.getByText('I can hear you')).toBeInTheDocument();
  }, 15_000);

  it('uses the saved microphone from the settings', async () => {
    const fake = createFakeBridge();
    fake.handle('settings:get', () => settingsView({ voice: { micDeviceId: 'usb-mic-42' } }));
    const { user, openMic } = await openMicScreen({ fake });
    await user.click(button('Allow & test microphone'));
    await waitFor(() => expect(openMic).toHaveBeenCalledWith('usb-mic-42'));
  });

  it('explains a blocked microphone and links to the Windows settings', async () => {
    const { user, fake, openMic, container } = await openMicScreen({
      openMic: () => Promise.reject(new MicError('denied', 'blocked')),
    });
    await user.click(button('Allow & test microphone'));
    await screen.findByRole('button', { name: 'Open Windows microphone settings' });
    expect(container.querySelector('[data-orb-state]')).toHaveAttribute('data-orb-state', 'error');
    expect(screen.getAllByText(MIC_ERROR_HELP.denied).length).toBeGreaterThan(0);
    expect(button('Try again')).toBeInTheDocument();
    expect(button('Skip for now')).toBeInTheDocument();

    await user.click(button('Open Windows microphone settings'));
    expect(fake.inputsOf('os:openMicSettings')).toHaveLength(1);

    await user.click(button('Try again'));
    await waitFor(() => expect(openMic).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['declines', () => false],
    [
      'fails',
      () => {
        throw new Error('ipc down');
      },
    ],
  ])('says so when Windows %s to open its settings', async (_name, handler) => {
    const fake = createFakeBridge();
    fake.handle('os:openMicSettings', handler);
    const { user } = await openMicScreen({
      fake,
      openMic: () => Promise.reject(new MicError('denied', 'blocked')),
    });
    await user.click(button('Allow & test microphone'));
    await user.click(
      await screen.findByRole('button', { name: 'Open Windows microphone settings' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open Windows Settings');
  });

  it.each([
    ['no-device', /cannot find a microphone/],
    ['busy', /Another app is using the microphone/],
  ] as const)('shows the %s help without the settings button', async (kind, text) => {
    const { user } = await openMicScreen({
      openMic: () => Promise.reject(new MicError(kind, 'x')),
    });
    await user.click(button('Allow & test microphone'));
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Open Windows microphone settings' })).toBeNull();
  });

  it('releases the microphone when the user leaves the screen', async () => {
    const { user, mic } = await openMicScreen();
    await user.click(button('Allow & test microphone'));
    await screen.findByText('Say something…');
    await user.click(button('Continue'));
    await heading(/voice model/i);
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Microphone on')).toBeNull();
  });

  it('releases the microphone when the window unloads', async () => {
    const { user, mic } = await openMicScreen();
    await user.click(button('Allow & test microphone'));
    await screen.findByText('Say something…');
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });
});
