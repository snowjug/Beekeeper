import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIC_ERROR_HELP, MicError } from '@renderer/lib/voice/mic';
import { VoiceSection } from '@renderer/settings/sections/VoiceSection';
import {
  clearToasts,
  makeView,
  renderWithController,
  startController,
  type StartOptions,
} from './support';

const mic = vi.hoisted(() => ({ openMic: vi.fn() }));

vi.mock('@renderer/lib/voice/mic', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, openMic: mic.openMic };
});

function fakeMicSession(level = 0.2) {
  const stop = vi.fn();
  return {
    stop,
    session: { sampleRate: 16_000, readLevel: vi.fn(() => level), onSamples: vi.fn(), stop },
  };
}

interface DeviceInfo {
  deviceId: string;
  kind: string;
  label: string;
}

function stubMediaDevices(initial: DeviceInfo[], getUserMedia = vi.fn()) {
  let list = initial;
  const listeners = new Set<() => void>();
  const devices = {
    enumerateDevices: vi.fn(() => Promise.resolve(list)),
    getUserMedia,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
  return {
    devices,
    plug(next: DeviceInfo[]) {
      list = next;
      act(() => listeners.forEach((listener) => listener()));
    },
    reveal(next: DeviceInfo[]) {
      list = next;
    },
  };
}

async function mount(options: StartOptions = {}) {
  const h = await startController(options);
  const ui = renderWithController(<VoiceSection />, h.controller);
  return { h, ...ui };
}

beforeEach(() => {
  mic.openMic.mockReset();
});

afterEach(() => {
  clearToasts();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  vi.useRealTimers();
});

describe('Voice section: microphone test', () => {
  it('opens the chosen microphone, shows a live test and stops it when asked', async () => {
    const user = userEvent.setup();
    const { session, stop } = fakeMicSession();
    mic.openMic.mockResolvedValue(session);
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.micDeviceId = 'usb9';
      }),
    });

    await user.click(screen.getByRole('button', { name: 'Test microphone' }));
    expect(mic.openMic).toHaveBeenCalledWith('usb9');
    expect(await screen.findByRole('button', { name: 'Stop test' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Microphone level' })).toBeInTheDocument();
    await waitFor(() => expect(session.readLevel).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Stop test' }));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Test microphone' })).toBeInTheDocument();
    h.stop();
  });

  it('releases the microphone when the section unmounts mid-test', async () => {
    const user = userEvent.setup();
    const { session, stop } = fakeMicSession();
    mic.openMic.mockResolvedValue(session);
    const { h, unmount } = await mount();

    await user.click(screen.getByRole('button', { name: 'Test microphone' }));
    await screen.findByRole('button', { name: 'Stop test' });
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('releases the microphone when the window is hidden or closed', async () => {
    const user = userEvent.setup();
    const { session, stop } = fakeMicSession();
    mic.openMic.mockResolvedValue(session);
    const { h } = await mount();

    await user.click(screen.getByRole('button', { name: 'Test microphone' }));
    await screen.findByRole('button', { name: 'Stop test' });
    fireEvent(window, new Event('pagehide'));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Test microphone' })).toBeInTheDocument();
    h.stop();
  });

  it('stops the test when another device is chosen', async () => {
    const user = userEvent.setup();
    const { session, stop } = fakeMicSession();
    mic.openMic.mockResolvedValue(session);
    stubMediaDevices([
      { deviceId: 'default', kind: 'audioinput', label: 'Default - Mic A' },
      { deviceId: 'a', kind: 'audioinput', label: 'Mic A' },
      { deviceId: 'b', kind: 'audioinput', label: 'Mic B' },
    ]);
    const { h } = await mount();

    await screen.findByRole('option', { name: 'Mic B' });
    await user.click(screen.getByRole('button', { name: 'Test microphone' }));
    await screen.findByRole('button', { name: 'Stop test' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Microphone' }), 'b');

    expect(stop).toHaveBeenCalledTimes(1);
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { micDeviceId: 'b' } }]);
    h.stop();
  });

  it('ends by itself after the time limit and never leaves the microphone on', async () => {
    const { session, stop } = fakeMicSession();
    mic.openMic.mockResolvedValue(session);
    const { h } = await mount();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(screen.getByRole('button', { name: 'Test microphone' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Stop test' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Test microphone' })).toBeInTheDocument();
    expect(screen.getByText(/Your microphone works|could not hear anything/)).toBeInTheDocument();
    vi.useRealTimers();
    h.stop();
  });

  it('explains a blocked microphone and links to the Windows privacy settings', async () => {
    const user = userEvent.setup();
    mic.openMic.mockRejectedValue(new MicError('denied', 'Microphone access is blocked.'));
    const { h } = await mount({ handlers: { 'os:openMicSettings': () => true } });

    await user.click(screen.getByRole('button', { name: 'Test microphone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MIC_ERROR_HELP.denied);

    await user.click(screen.getByRole('button', { name: 'Open Windows microphone settings' }));
    await waitFor(() => expect(h.inputsOf('os:openMicSettings')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Test microphone' })).toBeEnabled();
    h.stop();
  });

  it('turns unknown errors into the generic help text', async () => {
    const user = userEvent.setup();
    mic.openMic.mockRejectedValue(new Error('weird'));
    const { h } = await mount();
    await user.click(screen.getByRole('button', { name: 'Test microphone' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MIC_ERROR_HELP.unknown);
    h.stop();
  });
});

describe('Voice section: microphone devices', () => {
  const named = [
    { deviceId: 'default', kind: 'audioinput', label: 'Default - Headset (USB)' },
    { deviceId: 'usb9', kind: 'audioinput', label: 'Headset (USB)' },
  ];

  it('lists the devices and reacts to a device being plugged in', async () => {
    const media = stubMediaDevices(named);
    const { h } = await mount();

    expect(
      await screen.findByRole('option', { name: 'System default (Headset (USB))' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Headset (USB)' })).toBeInTheDocument();

    media.plug([...named, { deviceId: 'bt1', kind: 'audioinput', label: 'Bluetooth Mic' }]);
    expect(await screen.findByRole('option', { name: 'Bluetooth Mic' })).toBeInTheDocument();
    h.stop();
  });

  it('asks for permission only on request, shows the names, and closes the stream at once', async () => {
    const user = userEvent.setup();
    const track = { stop: vi.fn() };
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    const media = stubMediaDevices(
      [
        { deviceId: 'default', kind: 'audioinput', label: '' },
        { deviceId: 'usb9', kind: 'audioinput', label: '' },
      ],
      getUserMedia,
    );
    const { h } = await mount();

    expect(await screen.findByRole('option', { name: 'Microphone 1' })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();

    media.reveal(named);
    await user.click(screen.getByRole('button', { name: 'Allow microphone to show device names' }));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(await screen.findByRole('option', { name: 'Headset (USB)' })).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: 'Allow microphone to show device names' }),
    ).toBeNull();
    h.stop();
  });

  it('shows the permission problem when access is refused', async () => {
    const user = userEvent.setup();
    const denied = Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
    stubMediaDevices(
      [{ deviceId: 'default', kind: 'audioinput', label: '' }],
      vi.fn().mockRejectedValue(denied),
    );
    const { h } = await mount();

    await user.click(
      await screen.findByRole('button', { name: 'Allow microphone to show device names' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(MIC_ERROR_HELP.denied);
    h.stop();
  });

  it('flags a saved microphone that is no longer connected and offers the system default', async () => {
    const user = userEvent.setup();
    stubMediaDevices(named);
    const { h } = await mount({
      view: makeView((view) => {
        view.voice.micDeviceId = 'gone';
      }),
    });

    expect(
      await screen.findByText('Your saved microphone is not connected right now.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'Saved microphone (not connected)' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use the system default' }));
    expect(h.inputsOf('settings:update')).toEqual([{ voice: { micDeviceId: 'default' } }]);
    h.stop();
  });

  it('says so when there is no microphone at all', async () => {
    stubMediaDevices([]);
    const { h } = await mount();
    expect(await screen.findByText(MIC_ERROR_HELP['no-device'])).toBeInTheDocument();
    h.stop();
  });
});
